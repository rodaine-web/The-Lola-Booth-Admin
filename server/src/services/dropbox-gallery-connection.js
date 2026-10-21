import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {checkedRedirect,digest,sameSecret,providerRequest} from './external-provider-security.js';
import {connectDropboxGallery} from './dropbox-gallery-adapter.js';
import {dropboxGalleryActor} from './dropbox-gallery-permissions.js';
import {assertGalleryEnvironment} from './gallery-policy.js';
import {writeAudit} from './audit-service.js';
const provider='DROPBOX_GALLERY';
export const dropboxGalleryScopes=['account_info.read','files.metadata.read','files.content.read'];
export function dropboxOAuthConfig(config=process.env) {
 const key=config.DROPBOX_GALLERY_APP_KEY,secret=config.DROPBOX_GALLERY_APP_SECRET;
 const origin=config.APP_ENV==='staging'?'https://stagingapi.thelolabooth.com':config.APP_ENV==='production'?'https://api.thelolabooth.com':'http://localhost:8080';
 const redirect=checkedRedirect(config.DROPBOX_GALLERY_REDIRECT_URI||origin+'/api/integrations/dropbox-gallery/callback','dropbox-gallery');
 if(!key||!secret||env.integrationSecretKey.length<32)throw new AppError('Configure the Dropbox app key and secret in the API and worker environment.',503,'DROPBOX_CONFIGURATION_REQUIRED');
 return {key,secret,redirect};
}
async function connection(lock=false){const row=(await query("SELECT * FROM integration_connections WHERE category='STORAGE' AND provider=$1 AND deleted_at IS NULL"+(lock?' FOR UPDATE':''),[provider])).rows[0];if(!row)throw new AppError('Dropbox connection is not installed.',503,'DROPBOX_CONFIGURATION_REQUIRED');return row;}
export async function dropboxConnectionStatus() {
 const row=await connection();let appConfigured=true;try{dropboxOAuthConfig();}catch{appConfigured=false;}
 return {appConfigured,connected:appConfigured&&row.status==='CONNECTED'&&Boolean(row.encrypted_credentials),account:row.connected_account||null};
}
export async function connectedDropboxGallery() {
 const c=dropboxOAuthConfig(),row=await connection();if(row.status!=='CONNECTED'||!row.encrypted_credentials)throw new AppError('Connect Dropbox before importing.',503,'DROPBOX_CONFIGURATION_REQUIRED');
 return connectDropboxGallery({config:{DROPBOX_GALLERY_APP_KEY:c.key,DROPBOX_GALLERY_APP_SECRET:c.secret,DROPBOX_GALLERY_REFRESH_TOKEN:decryptSecretJson(row.encrypted_credentials).refresh_token,DROPBOX_GALLERY_ACCOUNT_ID:row.provider_account_id}});
}
export async function startDropboxGalleryOAuth(albumId,req) {
 assertGalleryEnvironment();await dropboxGalleryActor(req.user.id);const c=dropboxOAuthConfig(),row=await connection();
 if(!(await query('SELECT 1 FROM gallery_albums WHERE id=$1',[albumId])).rowCount)throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
 const state=crypto.randomBytes(32).toString('hex'),browser=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
 await query(`INSERT INTO integration_oauth_states(state_hash,provider,actor_id,browser_hash,verifier_encrypted,redirect_uri,generation,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,[digest(state),provider,req.user.id,digest(browser),encryptSecretJson({verifier,albumId}),c.redirect,row.connection_generation]);
 const url=new URL('https://www.dropbox.com/oauth2/authorize');for(const [key,value]of Object.entries({client_id:c.key,response_type:'code',redirect_uri:c.redirect,state,token_access_type:'offline',scope:dropboxGalleryScopes.join(' '),code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')}))url.searchParams.set(key,value);
 return {url:url.toString(),browser,redirect:c.redirect};
}
export async function finishDropboxGalleryOAuth(input,req,{fetcher=fetch}={}) {
 assertGalleryEnvironment();const c=dropboxOAuthConfig();
 if(!/^[a-f0-9]{64}$/.test(input.state||'')||!input.browser)throw new AppError('Authorization expired. Connect again. ',400,'OAUTH_STATE_INVALID');
 const saved=await transaction(async()=>{
  const s=(await query("SELECT * FROM integration_oauth_states WHERE state_hash=$1 AND provider=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",[digest(input.state),provider])).rows[0];
  if(!s||!sameSecret(s.browser_hash,digest(input.browser))||s.redirect_uri!==c.redirect)throw new AppError('Authorization expired. Connect again.',400,'OAUTH_STATE_INVALID');
  await dropboxGalleryActor(s.actor_id);await query('UPDATE integration_oauth_states SET consumed_at=now() WHERE state_hash=$1',[s.state_hash]);return s;
 });
 if(input.error||typeof input.code!=='string'||!input.code||input.code.length>4000)throw new AppError('Dropbox authorization was not granted.',400,'DROPBOX_AUTH_DENIED');
 const state=decryptSecretJson(saved.verifier_encrypted),tokens=await providerRequest('https://api.dropboxapi.com/oauth2/token',{fetcher,method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code:input.code,client_id:c.key,client_secret:c.secret,redirect_uri:c.redirect,code_verifier:state.verifier})});
 const scopes=String(tokens.scope||'').split(' ').filter(Boolean);
 if(!tokens.refresh_token||!tokens.account_id||dropboxGalleryScopes.some(scope=>!scopes.includes(scope))||scopes.some(scope=>!dropboxGalleryScopes.includes(scope)))throw new AppError('Grant only the required read permissions and offline access.',403,'DROPBOX_SCOPE_INVALID');
 await connectDropboxGallery({config:{DROPBOX_GALLERY_APP_KEY:c.key,DROPBOX_GALLERY_APP_SECRET:c.secret,DROPBOX_GALLERY_REFRESH_TOKEN:tokens.refresh_token,DROPBOX_GALLERY_ACCOUNT_ID:tokens.account_id},fetcher});
 await transaction(async()=>{
  const row=await connection(true);await dropboxGalleryActor(saved.actor_id);
  if(row.connection_generation!==saved.generation||row.provider_account_id&&row.provider_account_id!==tokens.account_id)throw new AppError('The Dropbox account changed. Review the existing folder bindings.',409,'DROPBOX_ACCOUNT_MISMATCH');
  await query("UPDATE integration_connections SET status='CONNECTED',encrypted_credentials=$2,provider_account_id=$3,connected_account='info@thelolabooth.com',scopes=$4,created_by=$5,connection_generation=gen_random_uuid(),updated_at=now(),last_error=NULL,last_error_code=NULL WHERE id=$1",[row.id,encryptSecretJson({refresh_token:tokens.refresh_token}),tokens.account_id,scopes,saved.actor_id]);
  await writeAudit({req:{...req,user:{id:saved.actor_id}},action:'gallery_dropbox_connected',entity:'integration_connection',entityId:row.id,after:{scopes:dropboxGalleryScopes}});
 });return {albumId:state.albumId};
}
export async function disconnectDropboxGallery(req) {
 assertGalleryEnvironment();await dropboxGalleryActor(req.user.id);
 await transaction(async()=>{await query("UPDATE integration_connections SET status='DISCONNECTED',encrypted_credentials=NULL,connection_generation=gen_random_uuid(),updated_at=now() WHERE category='STORAGE' AND provider=$1",[provider]);await query('UPDATE gallery_dropbox_sources SET enabled=false,lease_token=NULL,lease_until=NULL');});
 await writeAudit({req,action:'gallery_dropbox_disconnected',entity:'integration_connection',after:{provider}});return {disconnected:true};
}
