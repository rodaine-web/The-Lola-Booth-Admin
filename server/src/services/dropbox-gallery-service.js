import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {connectDropboxGallery,dropboxGalleryConfig,dropboxFolderPath,dropboxCapture} from './dropbox-gallery-adapter.js';
import {dropboxGalleryActor as actorAllowed} from './dropbox-gallery-permissions.js';
import {connectedDropboxGallery,dropboxConnectionStatus} from './dropbox-gallery-connection.js';
import {assertGalleryEnvironment} from './gallery-policy.js';
import {uploadGalleryMedia} from './private-gallery-service.js';
const fail=(message,code='DROPBOX_SYNC_UNAVAILABLE')=>new AppError(message,409,code);
const editable=album=>album&&!album.published_at&&['DRAFT','PROCESSING','READY'].includes(album.status)&&album.event_status!=='CANCELLED'&&!album.event_deleted_at&&!album.sales_closed_at;
const albumQuery='SELECT a.*,e.status AS event_status,e.deleted_at AS event_deleted_at,e.sales_closed_at FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.id=$1 FOR UPDATE OF a';
function gate(){assertGalleryEnvironment();if(process.env.GALLERY_DROPBOX_SYNC_ENABLED!=='true'||process.env.APP_ENV==='staging'&&process.env.STAGING_EXTERNAL_INTEGRATIONS_ENABLED!=='true')throw fail('Dropbox gallery imports are paused.','DROPBOX_SYNC_PAUSED');}
export async function dropboxGalleryStatus(albumId) {
 assertGalleryEnvironment();const connection=await dropboxConnectionStatus();const configured=connection.connected;
 const source=(await query(`SELECT album_id,folder_path,enabled,last_sync_at,next_sync_at,last_error_code,lease_until,
 (SELECT count(*)::int FROM gallery_dropbox_imports i WHERE i.album_id=s.album_id) imported FROM gallery_dropbox_sources s WHERE album_id=$1`,[albumId])).rows[0]||null;
 return {configured,connection,active:process.env.GALLERY_DROPBOX_SYNC_ENABLED==='true',source};
}
export async function saveDropboxGallerySource(albumId,input,user,{connect=connectedDropboxGallery}={}) {
 assertGalleryEnvironment();await actorAllowed(user.id);dropboxFolderPath(input.folderPath);
 const client=await connect(),folder=await client.folder(input.folderPath);
 return transaction(async()=>{
  const album=(await query(albumQuery,[albumId])).rows[0];
  if(!editable(album))throw fail('Dropbox imports require an unpublished gallery. Published galleries are never modified by sync.','DROPBOX_GALLERY_PUBLISHED');
  if(album.source_provider!=='FIESTA'||!album.external_event_id)throw fail('Import the Fiesta sharing CSV before linking its delivery folder.','DROPBOX_FIESTA_MAPPING_REQUIRED');
  const prior=(await query('SELECT * FROM gallery_dropbox_sources WHERE album_id=$1 FOR UPDATE',[albumId])).rows[0];
  if(prior?.lease_until&&new Date(prior.lease_until)>new Date())throw fail('Wait for the running import before changing this folder.','DROPBOX_SYNC_BUSY');
  if(prior&&(prior.folder_id!==folder.id||prior.account_id!==client.accountId))throw fail('This gallery is already bound to a different Dropbox folder. Review its imports before changing the source.','DROPBOX_FOLDER_CONFLICT');
  const conflict=(await query('SELECT 1 FROM gallery_dropbox_sources WHERE account_id=$1 AND folder_id=$2 AND album_id<>$3',[client.accountId,folder.id,albumId])).rowCount;
  if(conflict)throw fail('This Dropbox folder is already linked to another event.','DROPBOX_FOLDER_CONFLICT');
  await query(`INSERT INTO gallery_dropbox_sources(album_id,account_id,folder_id,folder_path,created_by,enabled) VALUES($1,$2,$3,$4,$5,$6)
  ON CONFLICT(album_id) DO UPDATE SET folder_path=EXCLUDED.folder_path,enabled=EXCLUDED.enabled,created_by=EXCLUDED.created_by,next_sync_at=now(),updated_at=now()`,[albumId,client.accountId,folder.id,folder.path_lower,user.id,input.enabled===true]);
  await writeAudit({req:{user},action:'gallery_dropbox_source_saved',entity:'gallery_album',entityId:albumId,after:{enabled:input.enabled===true}});
  return dropboxGalleryStatus(albumId);
 });
}
export async function pauseDropboxGallerySource(albumId,user) {
 await actorAllowed(user.id);await query('UPDATE gallery_dropbox_sources SET enabled=false,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE album_id=$1',[albumId]);
 await writeAudit({req:{user},action:'gallery_dropbox_paused',entity:'gallery_album',entityId:albumId});return dropboxGalleryStatus(albumId);
}
export async function syncDropboxGallerySource(albumId,{connect=connectedDropboxGallery,user,periodic=false}={}) {
 gate();
 const source=await transaction(async()=>{
  const album=(await query(albumQuery,[albumId])).rows[0];
  if(!editable(album))throw fail('Publish only after imports finish. Sync stops once a gallery has been published.','DROPBOX_GALLERY_PUBLISHED');
  const source=(await query('SELECT * FROM gallery_dropbox_sources WHERE album_id=$1 FOR UPDATE',[albumId])).rows[0];
  if(!source||periodic&&!source.enabled)throw fail('Dropbox source is not enabled.');
  await actorAllowed(user?.id||source.created_by);
  if(periodic&&source.created_by!==user?.id&&user)throw fail('Dropbox source owner changed.');
  if(source.lease_until&&new Date(source.lease_until)>new Date())throw fail('An import is already running.','DROPBOX_SYNC_BUSY');
  const token=crypto.randomUUID();await query("UPDATE gallery_dropbox_sources SET lease_token=$2,lease_until=now()+interval '5 minutes',last_error_code=NULL WHERE album_id=$1",[albumId,token]);
  return {...source,lease_token:token,actor_id:user?.id||source.created_by};
 });
 let imported=0,replayed=0,ignored=0;
 try {
  const client=await connect();if(client.accountId!==source.account_id)throw fail('Dropbox account changed. Recheck the connection.','DROPBOX_ACCOUNT_MISMATCH');
  const folder=await client.folder(source.folder_path);if(folder.id!==source.folder_id)throw fail('The selected folder was moved or replaced. Review its mapping.','DROPBOX_FOLDER_CONFLICT');
  const cursor=source.cursor_ciphertext?decryptSecretJson(source.cursor_ciphertext).cursor:null,page=await client.page(source.folder_id,cursor);
  if(page.entries.length>20)throw fail('Dropbox returned too many entries for one bounded import.','DROPBOX_PAGE_TOO_LARGE');
  for(const entry of page.entries) {
   const capture=dropboxCapture(entry,source.folder_path);if(!capture){ignored++;continue;}
   if((await query('SELECT 1 FROM gallery_dropbox_imports WHERE album_id=$1 AND file_id=$2 AND revision=$3',[albumId,capture.id,capture.rev])).rowCount){replayed++;continue;}
   const bytes=await client.download(capture,source.folder_path);
   await transaction(async()=>{
    gate();
    const album=(await query(albumQuery,[albumId])).rows[0];
    const current=(await query('SELECT * FROM gallery_dropbox_sources WHERE album_id=$1 FOR UPDATE',[albumId])).rows[0];
    if(!editable(album)||current?.lease_token!==source.lease_token||new Date(current.lease_until)<=new Date())throw fail('The gallery or source changed during import.','DROPBOX_IMPORT_STOPPED');
    await actorAllowed(source.actor_id);
    if(periodic&&!current.enabled)throw fail('Dropbox imports were paused.','DROPBOX_IMPORT_STOPPED');
    const media=await uploadGalleryMedia(albumId,{filename:capture.name,mime_type:capture.mime,base64:bytes.toString('base64'),source_provider:'DROPBOX',external_capture_id:capture.id,source_metadata:{revision:capture.rev,content_hash:capture.content_hash}});
    await query('INSERT INTO gallery_dropbox_imports(album_id,file_id,revision,content_hash,media_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[albumId,capture.id,capture.rev,capture.content_hash,media.id]);
   });imported++;
  }
  gate();
  const updated=await query(`UPDATE gallery_dropbox_sources SET cursor_ciphertext=$3,last_sync_at=now(),last_error_code=NULL,lease_token=NULL,lease_until=NULL,next_sync_at=now()+($4::int*interval '1 second'),updated_at=now() WHERE album_id=$1 AND lease_token=$2 AND lease_until>now()`,[albumId,source.lease_token,encryptSecretJson({cursor:page.cursor}),page.has_more?30:300]);
  if(!updated.rowCount)throw fail('Dropbox import was stopped before its checkpoint committed.','DROPBOX_IMPORT_STOPPED');
  return {imported,replayed,ignored,hasMore:page.has_more,messagesSent:0};
 }catch(error){
  const code=/^(DROPBOX_|GALLERY_|FORBIDDEN)/.test(error.code||'')?error.code:'DROPBOX_SYNC_FAILED';
  await query("UPDATE gallery_dropbox_sources SET last_error_code=$3,lease_token=NULL,lease_until=NULL,next_sync_at=now()+interval '5 minutes',updated_at=now() WHERE album_id=$1 AND lease_token=$2",[albumId,source.lease_token,code]);
  if(code==='FORBIDDEN'||code==='DROPBOX_ACCOUNT_MISMATCH'||code==='DROPBOX_AUTH_EXPIRED')await query('UPDATE gallery_dropbox_sources SET enabled=false WHERE album_id=$1',[albumId]);
  throw new AppError('Dropbox import stopped. Review its status before retrying.',502,code);
 }
}
export async function processDropboxGallerySources({limit=2}={}) {
 if(process.env.GALLERY_DROPBOX_SYNC_ENABLED!=='true'||process.env.APP_ENV==='production'||process.env.APP_ENV==='staging'&&process.env.STAGING_EXTERNAL_INTEGRATIONS_ENABLED!=='true')return [];
 const sources=(await query(`SELECT s.album_id FROM gallery_dropbox_sources s JOIN gallery_albums a ON a.id=s.album_id JOIN events e ON e.id=a.event_id
 WHERE s.enabled AND s.next_sync_at<=now() AND (s.lease_until IS NULL OR s.lease_until<now()) AND a.published_at IS NULL AND a.status IN ('DRAFT','PROCESSING','READY') AND e.deleted_at IS NULL AND e.status<>'CANCELLED' ORDER BY s.next_sync_at LIMIT $1`,[Math.min(2,Math.max(1,limit))])).rows;
 const results=[];for(const row of sources){try{results.push({albumId:row.album_id,...await syncDropboxGallerySource(row.album_id,{periodic:true})});}catch(error){if(error.code==='FORBIDDEN')await query("UPDATE gallery_dropbox_sources SET enabled=false,last_error_code='FORBIDDEN' WHERE album_id=$1",[row.album_id]);results.push({albumId:row.album_id,errorCode:error.code||'DROPBOX_SYNC_FAILED'});}}return results;
}
