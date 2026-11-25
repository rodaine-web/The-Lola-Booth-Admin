import {keepsakesPublicOrigin} from '../../../shared/keepsakes-host.js';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {writeAudit} from './audit-service.js';
import {createCommunicationDraft} from './automation-service.js';
import {customerGalleryAccess} from './customer-gallery-service.js';
import {verifiedGalleryBytes} from './gallery-media-delivery.js';
import {assertKeepsakes,keepsakesScope} from './keepsakes-service.js';
import {normalizePhotoLookup} from '../../../shared/keepsakes-photo-access.js';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const contactHash=(channel,value)=>crypto.createHmac('sha256',env.integrationSecretKey).update(channel+':'+value).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
const unavailable=()=>new AppError('This photo access has expired or is unavailable. Request a new link.',404,'PHOTO_ACCESS_UNAVAILABLE');
const neutral={accepted:true,message:'If your request can be processed, a secure photo-access link will be emailed to you.'};
// Revalidate grants, gallery publication, retention and person assignments on every read.
async function scopeAnchors(scope){
 const key=(await query(`SELECT k.id,k.type,k.person_id FROM gallery_access_keys k
 JOIN gallery_albums a ON a.id=k.album_id JOIN events e ON e.id=a.event_id
 JOIN gallery_people p ON p.id=$3 AND p.album_id=a.id
 WHERE k.id=$1 AND k.album_id=$2 AND k.status='ACTIVE'
 AND (k.type='ALBUM' OR k.person_id=p.id) AND p.status='ACTIVE'
 AND a.status IN('PUBLISHED','DELIVERED') AND e.deleted_at IS NULL
 AND (k.expires_at IS NULL OR k.expires_at>now()) AND (a.expires_at IS NULL OR a.expires_at>now())`,[scope.keyId,scope.albumId,scope.personId])).rows[0];
 if(!key)return [];
 return (await query(`SELECT m.* FROM gallery_media m JOIN gallery_media_people mp ON mp.media_id=m.id AND mp.album_id=m.album_id
 WHERE m.album_id=$1 AND mp.person_id=$2 AND m.status='VISIBLE' AND m.media_type='IMAGE'`,[scope.albumId,scope.personId])).rows;
}
async function contactScopes(channel,recipient,includeAssociations=true){
 const fingerprint=contactHash(channel,recipient);
 const people=(await query(`SELECT DISTINCT p.id,p.album_id,p.external_ref,s.channel,s.recipient_ciphertext
 FROM gallery_people p JOIN fiesta_gallery_shares s ON s.person_id=p.id AND s.album_id=p.album_id
 WHERE p.status='ACTIVE' AND s.channel=$1 AND (p.external_ref=$2 OR p.external_ref LIKE 'fiesta-reviewed:%')`,[channel,'fiesta:'+fingerprint])).rows;
 const unique=new Map();
 for(const p of people){if(normalizePhotoLookup(channel,decryptSecretJson(p.recipient_ciphertext).recipient)!==recipient)continue;unique.set(p.id,p);}
 const scopes=[];
 for(const p of unique.values()){
  // A revoked personal grant is never bypassed with an album grant.
  const key=(await query(`SELECT id,status,expires_at FROM gallery_access_keys WHERE album_id=$1 AND (person_id=$2 OR type='ALBUM') ORDER BY COALESCE(person_id=$2,false) DESC,created_at DESC,id DESC LIMIT 1`,[p.album_id,p.id])).rows[0];
  if(!key)continue;
  const scope={keyId:key.id,personId:p.id,albumId:p.album_id};
  if((await scopeAnchors(scope)).length)scopes.push(scope);
 }
 return scopes;
}
export async function requestPhotoAccess(input){
 assertKeepsakes();
 const channel=input.channel==='PHONE'?'SMS':input.channel==='EMAIL'?'EMAIL':null;
 const recipient=normalizePhotoLookup(channel,input.value),email=normalizePhotoLookup('EMAIL',channel==='EMAIL'?input.value:input.email);
 if(!recipient||!email)throw new AppError('Enter a valid email and, for phone lookup, a phone number including country code.',422,'PHOTO_LOOKUP_INVALID');
 const targetHash=contactHash(channel,recipient);
 return transaction(async()=>{
  // Serializing each target prevents concurrent requests bypassing the cooldown.
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[targetHash]);
  if((await query("SELECT 1 FROM keepsakes_photo_requests WHERE target_hash=$1 AND created_at>now()-interval '2 minutes' LIMIT 1",[targetHash])).rowCount)return neutral;
  let scopes=await contactScopes(channel,recipient);const code=token();
  if(channel==='SMS'){
   const trustedEmail=await contactScopes('EMAIL',email,false),authorized=[];
   for(const scope of trustedEmail){const emailPhotos=await scopeAnchors(scope);for(const phoneScope of scopes.filter(s=>s.albumId===scope.albumId)){const phonePhotos=await scopeAnchors(phoneScope);if(emailPhotos.some(p=>phonePhotos.some(q=>q.id===p.id))&&!authorized.some(s=>s.keyId===scope.keyId&&s.personId===scope.personId))authorized.push(scope);}}
   scopes=authorized;
  }
  const request=(await query(`INSERT INTO keepsakes_photo_requests(target_hash,token_hash,scopes,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes') RETURNING id`,[targetHash,hash(code),JSON.stringify(scopes)])).rows[0];
  if(channel==='SMS'&&scopes.length)await query(`INSERT INTO keepsakes_unverified_contacts(phone_hash,email_hash,contact_ciphertext,request_id) VALUES($1,$2,$3,$4)`,[targetHash,contactHash('EMAIL',email),encryptSecretJson({phone:recipient,email}),request.id]);
  if(scopes.length){
   const origin=keepsakesPublicOrigin(process.env);
   const link=`${origin.replace(/\/$/,'')}/photos/access#code=${code}`;
   const communication=await createCommunicationDraft({channel:'EMAIL',recipient:email,subject:'Your Lola Booth photos are waiting',body:`Your Lola Booth memories are ready to explore.\n\nOpen your secure photo collection:\n${link}\n\nThis link expires in 30 minutes and can be opened once. Your photo session lasts up to 7 days, subject to your gallery access.\n\nGood people. Better photos.`,status:'SCHEDULED',scheduled_at:new Date(),trigger_key:'KEEPSAKES_PHOTO_ACCESS'});
   await query('UPDATE keepsakes_photo_requests SET communication_id=$2 WHERE id=$1',[request.id,communication.id]);
  }
  await writeAudit({req:{},action:'keepsakes_photo_access_requested',entity:'keepsakes_photo_request',entityId:request.id,after:{channel,scopeCount:scopes.length,verificationStatus:channel==='SMS'?'UNVERIFIED':'EMAIL_LINK'}});
  return neutral;
 });
}
export async function redeemPhotoAccess(code){
 assertKeepsakes();if(!/^[\w-]{43}$/.test(code||''))throw unavailable();
 return transaction(async()=>{
  const request=(await query(`UPDATE keepsakes_photo_requests SET redeemed_at=now() WHERE token_hash=$1 AND redeemed_at IS NULL AND expires_at>now() RETURNING *`,[hash(code)])).rows[0];
  if(!request)throw unavailable();
  const scopes=[];for(const scope of request.scopes)if((await scopeAnchors(scope)).length)scopes.push(scope);
  if(!scopes.length)throw unavailable();
  const sessionToken=token();
  const row=(await query(`INSERT INTO keepsakes_photo_sessions(token_hash,scopes,expires_at,request_id) VALUES($1,$2,now()+interval '7 days',$3) RETURNING expires_at`,[hash(sessionToken),JSON.stringify(scopes),request.id])).rows[0];
  await writeAudit({req:{},action:'keepsakes_photo_access_redeemed',entity:'keepsakes_photo_request',entityId:request.id,after:{scopeCount:scopes.length}});
  return {token:sessionToken,expiresAt:row.expires_at};
 });
}
export async function directPhotoAccess(type,code){
 const scope=await keepsakesScope(type,code),sessionToken=token();
 // Keep the original capability encrypted so all of its existing checks continue to apply.
 await query(`INSERT INTO keepsakes_photo_sessions(token_hash,scopes,expires_at) VALUES($1,$2,now()+interval '7 days')`,[hash(sessionToken),JSON.stringify([{direct:encryptSecretJson({type,token:code})}])]);
 if(!scope.assets.length)throw unavailable();
 return {token:sessionToken};
}
export async function sessionAssets(sessionToken){
 assertKeepsakes();if(!/^[\w-]{43}$/.test(sessionToken||''))throw unavailable();
 const session=(await query('SELECT * FROM keepsakes_photo_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',[hash(sessionToken)])).rows[0];
 if(!session)throw unavailable();
 const assets=[],albums=[];
 for(const scope of session.scopes){
  let anchors,albumId,mapped;
  if(scope.client){const owner=await validClientPhotoScope(scope.client);const album=await customerGalleryAccess(owner,scope.client.eventId);albumId=album.id;anchors=(await query("SELECT * FROM gallery_media WHERE album_id=$1 AND status='VISIBLE' AND media_type='IMAGE' ORDER BY sort_order,created_at",[albumId])).rows;}
  else if(scope.direct){const ref=decryptSecretJson(scope.direct),resolved=await keepsakesScope(ref.type,ref.token);albumId=resolved.albumId;mapped=resolved.assets;}
  else{albumId=scope.albumId;anchors=await scopeAnchors(scope);}
  if(anchors){if(!anchors.length)continue;
   mapped=(await query(`SELECT x.*,m.filename,m.width,m.height,m.checksum,m.mime_type,m.storage_key,m.storage_provider,m.size_bytes
    FROM gallery_photo_sessions s JOIN gallery_session_assets x ON x.session_id=s.id AND x.album_id=s.album_id
    JOIN gallery_media m ON m.id=x.media_id AND m.album_id=x.album_id
    WHERE s.album_id=$1 AND s.anchor_media_id=ANY($2::uuid[]) AND m.status<>'ARCHIVED'`,[albumId,anchors.map(a=>a.id)])).rows;
   const represented=new Set(mapped.map(a=>a.media_id));for(const a of anchors)if(!represented.has(a.id))mapped.push({...a,media_id:a.id,kind:'COMPOSITE',branded:true,label:'Event photo',included:true});
  }
  const album=(await query('SELECT id,title FROM gallery_albums WHERE id=$1',[albumId])).rows[0];
  if(!mapped.length)continue;
  if(!albums.some(a=>a.id===albumId))albums.push(album);
  for(const a of mapped)if(!assets.some(row=>row.id===a.id))assets.push({...a,albumId});
 }
 return {session,assets,albums};
}
export async function photoCollection(sessionToken){
 const {session,assets,albums}=await sessionAssets(sessionToken);
 return {expiresAt:session.expires_at,audience:session.scopes.some(s=>s.client)?'CLIENT':'GUEST',albums,assets:assets.map(a=>({id:a.id,albumId:a.albumId,sessionId:a.session_id||null,label:a.label||'Event photo',kind:a.kind,branded:a.branded===true,width:a.width,height:a.height,included:a.included===true,url:`/api/keepsakes/photos/assets/${a.id}`}))};
}
export async function collectionPhoto(sessionToken,id){
 const {assets}=await sessionAssets(sessionToken),asset=assets.find(a=>a.id===id);if(!asset)throw unavailable();
 const bytes=await verifiedGalleryBytes(asset,async()=>{if(!(await sessionAssets(sessionToken)).assets.some(a=>a.id===id))throw unavailable();});
 return sharp(bytes,{limitInputPixels:60_000_000}).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
}

export async function createPhotoHandoff(sessionToken,selection,target){
 const {session,assets}=await sessionAssets(sessionToken);
 if(!['SHOP','GALLERY'].includes(target)||!Array.isArray(selection)||!selection.length||selection.length>1000||new Set(selection).size!==selection.length||selection.some(id=>!assets.some(a=>a.id===id)))throw unavailable();
 const code=token();await query(`INSERT INTO keepsakes_photo_handoffs(token_hash,session_id,selected_asset_ids,target,expires_at) VALUES($1,$2,$3,$4,LEAST($5::timestamptz,now()+interval '2 minutes'))`,[hash(code),session.id,JSON.stringify(selection),target,session.expires_at]);
 return {code};
}
export async function redeemPhotoHandoff(code,target){
 if(!/^[\w-]{43}$/.test(code||'')||!['SHOP','GALLERY'].includes(target))throw unavailable();
 return transaction(async()=>{
  const h=(await query(`UPDATE keepsakes_photo_handoffs SET consumed_at=now() WHERE token_hash=$1 AND target=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING *`,[hash(code),target])).rows[0];if(!h)throw unavailable();
  const original=(await query('SELECT * FROM keepsakes_photo_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[h.session_id])).rows[0];if(!original)throw unavailable();
  const sessionToken=token();await query('INSERT INTO keepsakes_photo_sessions(token_hash,scopes,expires_at,request_id) VALUES($1,$2,$3,$4)',[hash(sessionToken),JSON.stringify(original.scopes),original.expires_at,original.request_id]);
  const {assets}=await sessionAssets(sessionToken);if(h.selected_asset_ids.some(id=>!assets.some(a=>a.id===id)))throw unavailable();
  return {token:sessionToken,selected:h.selected_asset_ids};
 });
}

async function validClientPhotoScope(scope){
 const session=(await query(`SELECT s.* FROM client_workspace_sessions s JOIN client_workspace_invitations i ON i.id=s.invitation_id JOIN client_workspace_grants g ON g.id=i.grant_id JOIN clients c ON c.id=s.client_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes' AND i.revoked_at IS NULL AND g.revoked_at IS NULL AND c.deleted_at IS NULL AND lower(c.email)=s.email`,[scope.sessionId])).rows[0];if(!session)throw unavailable();return session;
}
export async function clientPhotoAccess(session,eventId){
 await customerGalleryAccess(session,eventId);const sessionToken=token();await query(`INSERT INTO keepsakes_photo_sessions(token_hash,scopes,expires_at) VALUES($1,$2,$3)`,[hash(sessionToken),JSON.stringify([{client:{sessionId:session.id,clientId:session.client_id,eventId}}]),session.expires_at]);return {token:sessionToken};
}
