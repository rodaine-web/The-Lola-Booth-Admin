import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {writeAudit} from './audit-service.js';
import {AppError} from '../utils/errors.js';
import {createPostcard} from './gallery-postcards-service.js';
import * as galleryArtwork from './gallery-postcard-artwork-service.js';

const fail=(message,status=422)=>{throw new AppError(message,status,'POSTCARD_WORKFLOW_ERROR');};
const enabled=()=>['staging','development','test'].includes(process.env.APP_ENV)||(!process.env.APP_ENV&&process.env.NODE_ENV!=='production')||process.env.APP_ENV==='production'&&process.env.LOB_PRODUCTION_TEST_ENABLED==='true';
const idPattern=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const csvHeaders=['File Name','Recipient Name','Address Line 1','Address Line 2','City','State','ZIP','Country','Mail Consent','Consent Source'];
function parseCsv(text){
 if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>512*1024)fail('Use a CSV up to 512 KB.');
 const grid=[];let row=[],cell='',inQuotes=false,closed=false;const field=()=>{row.push(cell);cell='';closed=false};const record=()=>{field();if(row.some(v=>v.trim()))grid.push(row);row=[];if(grid.length>501)fail('Use at most 500 recipient rows.');};
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(inQuotes){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{inQuotes=false;closed=true;}}else{cell+=c;}}else if(c==='"'){if(cell||closed)fail('Malformed CSV quotation.');inQuotes=true;}else if(c===',')field();else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;record();}else{if(closed)fail('Malformed CSV quotation.');cell+=c;}}
 if(inQuotes)fail('Unclosed CSV quote.');if(cell||row.length||closed)record();
 if(!grid.length||grid[0].length!==csvHeaders.length||csvHeaders.some((h,i)=>grid[0][i].trim()!==h))fail('Invalid header. Use the provided postcard recipient CSV template.');
 if(grid.length===1)fail('CSV has no recipient rows.');
 const seen=new Set();return grid.slice(1).map((r,i)=>{
  if(r.length!==csvHeaders.length)fail(`Row ${i+2}: expected ${csvHeaders.length} columns.`);
  const [filename,name,line1,line2,city,state,zip,country,consent,source]=r.map(v=>v.trim());
  if(!/^[A-Za-z0-9_. -]{1,180}\.(jpe?g|png)$/i.test(filename)||filename.includes('..'))fail(`Row ${i+2}: invalid photo filename.`);
  if(!name||name.length>120||!line1||line1.length>200||line2.length>200||!city||city.length>100||!/^[A-Za-z]{2}$/.test(state)||!/^\d{5}(-\d{4})?$/.test(zip)||country.toUpperCase()!=='US')fail(`Row ${i+2}: invalid US mailing address.`);
  if(source.length>250)fail(`Row ${i+2}: consent source too long.`);
  const optedIn=/^(yes|true|1)$/i.test(consent),optedOut=/^(no|false|0)$/i.test(consent);
  if(!optedIn&&!optedOut)fail(`Row ${i+2}: Mail Consent must be YES or NO.`);
  if(optedIn&&source.length<3)fail(`Row ${i+2}: documented mail-consent source required.`);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify([filename.toLowerCase(),name.toLowerCase(),line1.toLowerCase(),zip])).digest('hex');
  if(seen.has(fingerprint))fail(`Row ${i+2}: duplicate recipient/photo.`);seen.add(fingerprint);
  return {filename,consent:optedIn,consentSource:source||'No consent',recipient:{name,address_line1:line1,address_line2:line2,address_city:city,address_state:state.toUpperCase(),address_zip:zip,address_country:'US'},fingerprint};
 });
}
async function findPhoto(albumId,filename){
 const result=await query(`SELECT m.id AS media_id, mp.person_id FROM gallery_media m JOIN gallery_media_people mp ON mp.album_id=m.album_id AND mp.media_id=m.id JOIN gallery_people p ON p.album_id=mp.album_id AND p.id=mp.person_id AND p.status='ACTIVE' WHERE m.album_id=$1 AND m.filename=$2 AND m.status='VISIBLE' AND m.media_type='IMAGE'`,[albumId,filename]);
 const mediaIds=new Set(result.rows.map(r=>r.media_id)), personIds=new Set(result.rows.map(r=>r.person_id));
 return result.rows.length===1&&mediaIds.size===1&&personIds.size===1?{status:'MATCHED',...result.rows[0]}:{status:result.rows.length===0?'UNMATCHED':'AMBIGUOUS',media_id:null,person_id:null};
}
const publicRow='id,filename,status,consent,recipient_label,consent_source,person_id,media_id,postcard_id,created_at';
export async function listRecipientImports(albumId){
 await galleryArtwork.reconcileFiestaPostcardRecipients(albumId);
 const rows=await query(`SELECT ${publicRow} FROM gallery_postcard_recipients WHERE album_id=$1 ORDER BY created_at DESC LIMIT 500`,[albumId]);
 const summary={total:rows.rows.length,matched:0,unmatched:0,ambiguous:0,noConsent:0,prepared:0};
 for(const r of rows.rows){if(r.postcard_id)summary.prepared++;else if(!r.consent)summary.noConsent++;else if(r.status==='MATCHED')summary.matched++;else if(r.status==='AMBIGUOUS')summary.ambiguous++;else summary.unmatched++;}
 return {data:rows.rows,summary};
}
export async function importRecipients(albumId,csv,user){
 if(!enabled())fail('Recipient import is not enabled in production.',403);
 const parsed=parseCsv(csv);
 const album=(await query('SELECT id FROM gallery_albums WHERE id=$1',[albumId])).rows[0];if(!album)fail('Gallery not found.',404);
 const resolved=[];
 for(const row of parsed){const photo=await findPhoto(albumId,row.filename);resolved.push({...row,...photo,status:row.consent?photo.status:'NO_CONSENT'});}
 const imported=await transaction(async()=>{
  let created=0,duplicates=0;
  for(const r of resolved){const label=`${r.recipient.name.slice(0,1)}*** · ${r.recipient.address_state} ${r.recipient.address_zip.slice(0,3)}**`;
   const result=await query(`INSERT INTO gallery_postcard_recipients(album_id,filename,fingerprint,recipient_ciphertext,recipient_label,consent,consent_source,status,person_id,media_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(album_id,fingerprint) DO NOTHING RETURNING id`,[albumId,r.filename,r.fingerprint,encryptSecretJson(r.recipient),label,r.consent,r.consentSource,r.status,r.person_id,r.media_id,user.id]);
   if(result.rowCount)created++;else duplicates++;
  }
  return {created,duplicates};
 });
 await writeAudit({req:{user},action:'gallery_postcard_recipients_imported',entity:'gallery_album',entityId:albumId,after:{...imported,total:parsed.length}});
 return {...imported,...(await listRecipientImports(albumId)).summary};
}
export async function resolveRecipient(albumId,rowId,personId,mediaId,user){
 if(!enabled())fail('Recipient review disabled.',403);
 const verified=await query(`SELECT 1 FROM gallery_media m JOIN gallery_media_people mp ON mp.album_id=m.album_id AND mp.media_id=m.id AND mp.person_id=$3 JOIN gallery_people p ON p.id=mp.person_id AND p.album_id=m.album_id AND p.status='ACTIVE' WHERE m.album_id=$1 AND m.id=$2 AND m.status='VISIBLE' AND m.media_type='IMAGE'`,[albumId,mediaId,personId]);
 if(!verified.rowCount)fail('Select a visible photo already assigned to this guest.');
 const changed=await query(`UPDATE gallery_postcard_recipients SET status='MATCHED',person_id=$3,media_id=$4,updated_at=now() WHERE album_id=$1 AND id=$2 AND consent=true AND postcard_id IS NULL RETURNING id`,[albumId,rowId,personId,mediaId]);if(!changed.rowCount)fail('Recipient must be an unprepared consenting import row.');
 await writeAudit({req:{user},action:'gallery_postcard_recipient_resolved',entity:'gallery_album',entityId:albumId,after:{rowId,personId,mediaId}});return {id:rowId,status:'MATCHED'};
}
export async function prepareImportedPostcard(albumId,rowId,art,user){
 if(!enabled())fail('Postcard preparation disabled.',403);
 const row=(await query(`SELECT * FROM gallery_postcard_recipients WHERE album_id=$1 AND id=$2`,[albumId,rowId])).rows[0];
 if(!row||row.status!=='MATCHED'||!row.consent||row.postcard_id||!row.person_id||!row.media_id)fail('Only a matched, consenting, unprepared recipient can be prepared.');
 const result=await createPostcard(albumId,{person_id:row.person_id,media_id:row.media_id,recipient:decryptSecretJson(row.recipient_ciphertext),front_url:art.front_url,back_url:art.back_url,consent:true,consent_source:row.consent_source},user);
 await query(`UPDATE gallery_postcard_recipients SET postcard_id=$3,status='PREPARED',updated_at=now() WHERE album_id=$1 AND id=$2 AND postcard_id IS NULL`,[albumId,rowId,result.id]);
 return result;
}
export async function batchApprove(albumId,postcardIds,user){
 if(!enabled())fail('Batch approval disabled.',403);
 if(postcardIds.length<1||postcardIds.length>50||new Set(postcardIds).size!==postcardIds.length||postcardIds.some(id=>!idPattern.test(id)))fail('Choose 1–50 unique draft postcards.');
 const count=await transaction(async()=>{
  const found=await query(`SELECT id,status FROM gallery_postcards WHERE album_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE`,[albumId,postcardIds]);
  if(found.rowCount!==postcardIds.length||found.rows.some(r=>r.status!=='DRAFT'))fail('Every selected postcard must be an existing draft; no changes applied.');
  const updated=await query(`UPDATE gallery_postcards SET status='APPROVED',approved_at=now(),approved_by=$3,updated_at=now() WHERE album_id=$1 AND id=ANY($2::uuid[]) AND status='DRAFT' RETURNING id`,[albumId,postcardIds,user.id]);
  if(updated.rowCount!==postcardIds.length)fail('Batch approval conflict. No changes applied.',409);return updated.rowCount;
 });
 await writeAudit({req:{user},action:'gallery_postcard_batch_approved',entity:'gallery_album',entityId:albumId,after:{postcardIds,count}});return {approved:count};
}
export async function refreshTestStatus(albumId,postcardId,user){
 if(!enabled())fail('Lob test tracking disabled.',403);
 const key=process.env.LOB_TEST_API_KEY||'';if(!key.startsWith('test_'))fail('Lob TEST key is not configured.',503);
 const result=await query(`SELECT lob_postcard_id,status FROM gallery_postcards WHERE album_id=$1 AND id=$2`,[albumId,postcardId]);const row=result.rows[0];if(!row||row.status!=='SUBMITTED_TEST'||!/^psc_[A-Za-z0-9]+$/.test(row.lob_postcard_id||''))fail('Only previously submitted Lob TEST postcards can be refreshed.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response;
 try{response=await fetch(`https://api.lob.com/v1/postcards/${encodeURIComponent(row.lob_postcard_id)}`,{headers:{Authorization:`Basic ${Buffer.from(key+':').toString('base64')}`},signal:controller.signal});}catch{fail('Unable to retrieve Lob test status.',502)}finally{clearTimeout(timer)}
 if(!response.ok)fail(`Lob status request failed (${response.status}).`,502);
 const payload=await response.json();if(payload.id!==row.lob_postcard_id)fail('Unexpected Lob identifier.',502);
 const status=String(payload.status||'unknown').slice(0,80);
 await query(`UPDATE gallery_postcards SET provider_render_status=$3,lob_status=CASE WHEN provider_updated_at IS NULL THEN $3 ELSE lob_status END,last_status_checked_at=now(),updated_at=now() WHERE album_id=$1 AND id=$2 AND status='SUBMITTED_TEST'`,[albumId,postcardId,status]);
 await (await import('./gallery-mailing-service.js')).mailingHistory(albumId,postcardId,'PROVIDER_STATUS_REFRESHED',user,{status});
 await writeAudit({req:{user},action:'gallery_postcard_test_status_refreshed',entity:'gallery_album',entityId:albumId,after:{postcardId,lob_status:status}});
 return {id:postcardId,lob_status:status};
}
export async function eventPostcardSummary(eventId){
 const r=await query(`SELECT a.id AS album_id, a.status AS gallery_status, count(p.id)::int AS total, count(p.id) FILTER(WHERE p.status='DRAFT')::int AS drafts,count(p.id) FILTER(WHERE p.status='APPROVED')::int AS approved,count(p.id) FILTER(WHERE p.status='SUBMITTED_TEST')::int AS submitted_test FROM gallery_albums a LEFT JOIN gallery_postcards p ON p.album_id=a.id WHERE a.event_id=$1 GROUP BY a.id,a.status ORDER BY a.created_at DESC LIMIT 1`,[eventId]);
 return r.rows[0]||{album_id:null,total:0,drafts:0,approved:0,submitted_test:0};
}
