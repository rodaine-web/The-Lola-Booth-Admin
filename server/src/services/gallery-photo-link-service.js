import crypto from 'node:crypto';
import {query} from '../db/pool.js';
import {env} from '../config/env.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {resolveGalleryToken,allowedMedia,publicGalleryView} from './private-gallery-service.js';
import {openCredentials,unavailable} from './gallery-policy.js';

// A photo token grants access to one image, never the parent gallery's token.
export async function photoLink(albumId,mediaId){
 const key=(await query(`SELECT k.* FROM gallery_access_keys k JOIN gallery_albums a ON a.id=k.album_id
 WHERE k.album_id=$1 AND k.type='ALBUM' AND k.status='ACTIVE'
 AND (k.expires_at IS NULL OR k.expires_at>now())
 AND EXISTS(SELECT 1 FROM gallery_media m WHERE m.id=$2 AND m.album_id=$1 AND m.status='VISIBLE' AND m.media_type='IMAGE')
 ORDER BY k.created_at DESC LIMIT 1`,[albumId,mediaId])).rows[0];
 if(!key)throw unavailable();
 const token=crypto.randomBytes(32).toString('base64url');
 await query(`INSERT INTO gallery_photo_links(album_id,media_id,access_key_id,token_hash,credentials_ciphertext)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(media_id,access_key_id) DO NOTHING`,[albumId,mediaId,key.id,crypto.createHash('sha256').update(token).digest('hex'),encryptSecretJson({token})]);
 const row=(await query('SELECT credentials_ciphertext FROM gallery_photo_links WHERE media_id=$1 AND access_key_id=$2',[mediaId,key.id])).rows[0];
 const origin=process.env.GALLERY_PUBLIC_ORIGIN||process.env.DOCUMENT_PUBLIC_ORIGIN||env.clientOrigin;
 return {url:`${origin.replace(/\/$/,'')}/gallery/photo/${decryptSecretJson(row.credentials_ciphertext).token}`};
}
export async function resolvePhotoLink(token){
 if(!/^[-_A-Za-z0-9]{43}$/.test(token||''))throw unavailable();
 const row=(await query(`SELECT l.media_id,k.type,k.encrypted_credentials FROM gallery_photo_links l
 JOIN gallery_access_keys k ON k.id=l.access_key_id WHERE l.token_hash=$1`,[crypto.createHash('sha256').update(token).digest('hex')])).rows[0];
 if(!row)throw unavailable();
 const credentials=openCredentials(row.encrypted_credentials,process.env.GALLERY_SIGNING_SECRET||env.jwtSecret,process.env.APP_ENV||process.env.NODE_ENV);
 const grant=await resolveGalleryToken(row.type,credentials.token);
 if(!(await allowedMedia(grant)).some(m=>m.id===row.media_id))throw unavailable();
 return {grant,mediaId:row.media_id};
}
export async function photoLinkView(token){
 const {grant,mediaId}=await resolvePhotoLink(token);
 const view=await publicGalleryView(grant,false);
 return {...view,type:'PHOTO',allowZip:false,cover:mediaId,media:view.media.filter(m=>m.id===mediaId)};
}
