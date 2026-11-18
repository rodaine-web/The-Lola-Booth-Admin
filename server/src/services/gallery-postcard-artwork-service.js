import {postcardPreparationEnabled} from '../../../shared/postcard-print-policy.js';
import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { galleryStorage } from './gallery-storage.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit-service.js';
import { encryptSecretJson, decryptSecretJson } from './integration-secrets.js';

const bad=(m,s=422)=>{throw new AppError(m,s,'GALLERY_POSTCARD_ARTWORK');};
const preparationAllowed=()=>postcardPreparationEnabled(process.env);
const label=(r)=>`${(r.name||'?').slice(0,1)}*** · ${r.address_state||'??'} ${(r.address_zip||'').slice(0,3)}**`;
function dimensions(bytes,mime){
 if(mime==='image/png'){
  if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))bad('Invalid PNG file.');
  return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 }
 if(mime==='image/jpeg'){
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)bad('Invalid JPEG file.');
  let at=2;
  while(at+10<bytes.length){if(bytes[at]!==255)break;const marker=bytes[at+1];if(marker===0xDA||marker===0xD9)break;const size=bytes.readUInt16BE(at+2);if(size<2||at+2+size>bytes.length)break;if([0xC0,0xC1,0xC2,0xC3].includes(marker))return [bytes.readUInt16BE(at+7),bytes.readUInt16BE(at+5)];at+=size+2;}
  bad('Could not read JPEG dimensions.');
 }
 bad('Upload JPG or PNG artwork.');
}
export async function listBackArtworks(albumId){
 const r=await query('SELECT id,version,original_filename,mime_type,width_px,height_px,sha256,status,created_at,approved_at FROM gallery_postcard_back_artworks WHERE album_id=$1 ORDER BY version DESC LIMIT 100',[albumId]);
 return {data:r.rows};
}
export async function uploadBackArtwork(albumId,input,user){
 if(!preparationAllowed())bad('Artwork uploads are disabled in production.',403);
 const album=(await query('SELECT id FROM gallery_albums WHERE id=$1',[albumId])).rows[0];if(!album)bad('Gallery not found.',404);
 const mime=input.mime_type;const file=Buffer.from(input.base64,'base64');
 if(file.length<100||file.length>6*1024*1024||Buffer.from(file.toString('base64'),'base64').length!==file.length)bad('Artwork must be a JPG/PNG file up to 6 MB.');
 const [w,h]=dimensions(file,mime);
 // 4x6 inches at 300 DPI plus 0.125 inch bleed on each side => 1875x1275 pixels.
 if(!((w===1875&&h===1275)||(w===1275&&h===1875)))bad('4×6 back artwork must be 1875×1275 px (or portrait rotation), including 0.125-inch bleed at 300 DPI.');
 const sha=crypto.createHash('sha256').update(file).digest('hex');
 const store=galleryStorage();const key=await store.put(file,mime);
 const r=await query(`INSERT INTO gallery_postcard_back_artworks(album_id,version,original_filename,mime_type,width_px,height_px,sha256,storage_provider,storage_key,created_by)
 SELECT $1,COALESCE(MAX(version),0)+1,$2,$3,$4,$5,$6,$7,$8,$9 FROM gallery_postcard_back_artworks WHERE album_id=$1 RETURNING id,version,status`,[albumId,input.filename,mime,w,h,sha,store.provider,key,user.id]);
 await writeAudit({req:{user},action:'gallery_postcard_back_uploaded',entity:'gallery_album',entityId:albumId,after:{artworkId:r.rows[0].id,version:r.rows[0].version}});
 return r.rows[0];
}
export async function approveBackArtwork(albumId,artId,user){
 if(!preparationAllowed())bad('Artwork approvals are disabled in production.',403);
 const r=await query(`UPDATE gallery_postcard_back_artworks SET status='APPROVED',approved_at=now(),approved_by=$3 WHERE album_id=$1 AND id=$2 AND status='DRAFT' RETURNING id,version,status`,[albumId,artId,user.id]);if(!r.rowCount)bad('Only draft artwork can be approved.');
 await writeAudit({req:{user},action:'gallery_postcard_back_approved',entity:'gallery_album',entityId:albumId,after:{artworkId:artId}});return r.rows[0];
}
export async function artworkMedia(albumId,artId){
 const r=await query(`SELECT storage_provider,storage_key,mime_type FROM gallery_postcard_back_artworks WHERE album_id=$1 AND id=$2`,[albumId,artId]);if(!r.rowCount)bad('Artwork not found.',404);
 const item=r.rows[0],storage=galleryStorage();if(storage.provider!==item.storage_provider)bad('Artwork storage provider is unavailable.',503);
 return {mime:item.mime_type,stream:await storage.get(item.storage_key)};
}
// Refresh legacy Fiesta postal rows after the media upload, while never overwriting prepared records.
// A shared filename is insufficient: insist on the exact album, exact Fiesta share identity and a single ACTIVE guest assignment.
export async function reconcileFiestaPostcardRecipients(albumId){
 const r=await query(`SELECT pr.id,pr.filename,pr.consent,pr.person_id,pr.status,pr.postcard_id,pr.consent_source,
 (SELECT count(DISTINCT m.id)::int FROM gallery_media m JOIN gallery_media_people mp ON mp.album_id=m.album_id AND mp.media_id=m.id AND mp.person_id=pr.person_id JOIN fiesta_gallery_shares fs ON fs.album_id=pr.album_id AND fs.person_id=pr.person_id AND fs.filename=pr.filename WHERE m.album_id=pr.album_id AND m.filename=pr.filename AND m.status='VISIBLE' AND m.media_type='IMAGE') AS matches,
 (SELECT m.id FROM gallery_media m JOIN gallery_media_people mp ON mp.album_id=m.album_id AND mp.media_id=m.id AND mp.person_id=pr.person_id JOIN fiesta_gallery_shares fs ON fs.album_id=pr.album_id AND fs.person_id=pr.person_id AND fs.filename=pr.filename WHERE m.album_id=pr.album_id AND m.filename=pr.filename AND m.status='VISIBLE' AND m.media_type='IMAGE' ORDER BY m.id LIMIT 1) AS matched_id
 FROM gallery_postcard_recipients pr WHERE pr.album_id=$1 AND pr.postcard_id IS NULL AND pr.status IN ('UNMATCHED','AMBIGUOUS','MATCHED')`,[albumId]);
 for(const row of r.rows){
  const status=!row.consent?'NO_CONSENT':row.matches===1?'MATCHED':row.matches>1?'AMBIGUOUS':'UNMATCHED';
  await query(`UPDATE gallery_postcard_recipients SET status=$3,media_id=$4,updated_at=now() WHERE album_id=$1 AND id=$2 AND postcard_id IS NULL AND status IN ('UNMATCHED','AMBIGUOUS','MATCHED')`,[albumId,row.id,status,status==='MATCHED'?row.matched_id:null]);
 }
 return r.rowCount;
}
export async function prepareBulkPostcards(albumId,artId,recipientIds,user){
 if(!preparationAllowed())bad('Postcard preparation is disabled in production.',403);
 if(!Array.isArray(recipientIds)||recipientIds.length<1||recipientIds.length>100||new Set(recipientIds).size!==recipientIds.length)bad('Select 1–100 unique eligible recipients.');
 await reconcileFiestaPostcardRecipients(albumId);
 const art=(await query(`SELECT id FROM gallery_postcard_back_artworks WHERE album_id=$1 AND id=$2 AND status='APPROVED'`,[albumId,artId])).rows[0];if(!art)bad('Approve this event\'s postcard back before preparing drafts.');
 const rows=await query(`SELECT * FROM gallery_postcard_recipients WHERE album_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,[albumId,recipientIds]);
 if(rows.rowCount!==recipientIds.length)bad('Some selected recipients are missing.');
 const prepared=[];const errors=[];
 for(const row of rows.rows){
  if(row.status!=='MATCHED'||!row.consent||row.postcard_id||!row.person_id||!row.media_id){errors.push({id:row.id,reason:'Recipient is not eligible or is already prepared.'});continue;}
  const to=decryptSecretJson(row.recipient_ciphertext);
  if(!to?.name||!to.address_line1||!to.address_city||!to.address_state||!/^\d{5}(-\d{4})?$/.test(to.address_zip||'')||to.address_country!=='US'){errors.push({id:row.id,reason:'Incomplete US mailing address.'});continue;}
  const valid=(await query(`SELECT 1 FROM gallery_media m JOIN gallery_media_people mp ON mp.album_id=m.album_id AND mp.media_id=m.id AND mp.person_id=$3 JOIN fiesta_gallery_shares fs ON fs.album_id=m.album_id AND fs.person_id=$3 AND fs.filename=m.filename WHERE m.album_id=$1 AND m.id=$2 AND m.status='VISIBLE' AND m.media_type='IMAGE'`,[albumId,row.media_id,row.person_id])).rowCount;
  if(!valid){errors.push({id:row.id,reason:'Photo ownership requires review.'});continue;}
  // Internal references are NOT Lob-accessible URLs. Submission must fail closed until rendered artwork has a verified delivery path.
  const created=await query(`INSERT INTO gallery_postcards(album_id,person_id,media_id,recipient_ciphertext,recipient_label,consent_at,consent_source,front_url,back_url,created_by)
  VALUES($1,$2,$3,$4,$5,now(),$6,$7,$8,$9) ON CONFLICT(album_id,person_id,media_id) DO NOTHING RETURNING id`,[albumId,row.person_id,row.media_id,encryptSecretJson(to),label(to),row.consent_source,`gallery-media:${row.media_id}`,`gallery-artwork:${artId}`,user.id]);
  if(!created.rowCount){errors.push({id:row.id,reason:'Postcard for this photo already exists.'});continue;}
  await query(`UPDATE gallery_postcard_recipients SET postcard_id=$3,status='PREPARED',updated_at=now() WHERE album_id=$1 AND id=$2 AND postcard_id IS NULL`,[albumId,row.id,created.rows[0].id]);
  prepared.push(created.rows[0].id);
 }
 await writeAudit({req:{user},action:'gallery_postcard_bulk_prepared',entity:'gallery_album',entityId:albumId,after:{artId,prepared:prepared.length,skipped:errors.length}});
 return {prepared:prepared.length,skipped:errors.length,errors};
}
