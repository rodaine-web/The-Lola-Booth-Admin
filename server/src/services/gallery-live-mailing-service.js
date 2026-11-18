import {lobProofReady} from '../../../shared/lob-proof-policy.js';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {assertFiestaReviewAccess} from './fiesta-survey-review-service.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {renderPostcardProof} from './lob-print-ready-service.js';
import {mailingHistory} from './gallery-mailing-service.js';
import {mailingRecipientKey,verifyLobSignature} from '../../../shared/gallery-mailing-policy.js';
import {liveLobReady,liveBatchBudget} from '../../../shared/gallery-live-policy.js';
const fail=(message,status=409)=>{throw new AppError(message,status,'GALLERY_LIVE_MAILING');};
const enabled=(statusChannel='WEBHOOK')=>liveLobReady(process.env,{statusChannel});
async function scope(albumId){
 const album=(await query("SELECT a.*,e.deleted_at,e.sales_closed_at,e.status AS event_status FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.id=$1",[albumId])).rows[0];
 if(!album||album.deleted_at||album.sales_closed_at||album.event_status==='CANCELLED'||['ARCHIVED','EXPIRED'].includes(album.status))fail('Live mailing is unavailable for this event/gallery.');
 const proposal=(await query("SELECT p.id,p.accepted_version_id FROM proposals p WHERE event_id=$1 AND p.deleted_at IS NULL AND p.status IN('ACCEPTED','CONVERTED') ORDER BY p.created_at DESC LIMIT 1",[album.event_id])).rows[0];
 return {album,proposal};
}
async function freshProof(albumId,postcardId){
 const proof=await renderPostcardProof(albumId,postcardId),p=proof.postcard;
 if(p.status!=='SUBMITTED_TEST'||p.provider_render_status!=='rendered'||!p.lob_postcard_id||!p.proof_approved_at||p.proof_hash!==proof.hash)fail('Only successfully rendered, unchanged and reviewed test postcards can enter a live batch.');
 const survey=await query(`SELECT 1 FROM (SELECT DISTINCT ON(fingerprint) person_id,status FROM gallery_fiesta_survey_rows WHERE album_id=$1 ORDER BY fingerprint,sequence DESC) r WHERE person_id=$2 AND status IN('NEEDS_REVIEW','NO_CONSENT','PREPARED_LOCKED')`,[albumId,p.person_id]);
 if(survey.rowCount||!p.consent_at||!p.consent_source)fail('Resolve guest mailing consent and survey review before live mailing.');
 const request=(await query("SELECT * FROM gallery_mailing_requests WHERE album_id=$1 ORDER BY updated_at DESC LIMIT 1",[albumId])).rows[0];
 if(!request||request.status!=='APPROVED'||!request.return_address_ciphertext||!proof.sender)fail('Approve the current client return address first.');
 return {proof,p,request,address:decryptSecretJson(p.recipient_ciphertext)};
}
export async function liveMailingSummary(albumId,user){
 await assertFiestaReviewAccess(albumId,user);
 const [batches,jobs,hook]=await Promise.all([
  query('SELECT id,quantity,cost_limit_cents,unit_cost_cents,price_source,price_verified_at,status,authorization_note,created_at,authorized_at FROM gallery_live_mailing_batches WHERE album_id=$1 ORDER BY created_at DESC',[albumId]),
  query('SELECT id,batch_id,postcard_id,recipient_label,status,cost_cents,lob_postcard_id,lob_status,provider_render_status,last_error FROM gallery_live_mailing_jobs WHERE album_id=$1 ORDER BY created_at',[albumId]),
  query('SELECT last_verified_at FROM gallery_live_webhook_health WHERE singleton=true')]);
 return {batches:batches.rows,jobs:jobs.rows,connection:{production:process.env.APP_ENV==='production',liveEnabled:enabled(),worker:process.env.GALLERY_MAILING_LIVE_WORKER_ENABLED==='true',testKey:process.env.LOB_TEST_API_KEY?.startsWith('test_')||false,liveKey:process.env.LOB_LIVE_API_KEY?.startsWith('live_')||false,webhookConfigured:Boolean(process.env.LOB_LIVE_WEBHOOK_SECRET),webhookVerifiedAt:hook.rows[0]?.last_verified_at||null}};
}
export async function prepareLiveBatch(albumId,input,user){
 await assertFiestaReviewAccess(albumId,user);
 if(new Set(input.postcard_ids).size!==input.postcard_ids.length||!liveBatchBudget({quantity:input.postcard_ids.length,...input}))fail('Choose unique postcards and sufficient approved mailing limits.',422);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);const context=await scope(albumId);
  const batch=(await query(`INSERT INTO gallery_live_mailing_batches(album_id,proposal_id,version_id,quantity,cost_limit_cents,unit_cost_cents,price_source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[albumId,context.proposal?.id||null,context.proposal?.accepted_version_id||null,input.postcard_ids.length,input.cost_limit_cents,input.unit_cost_cents,input.price_source,user.id])).rows[0];
  for(const id of input.postcard_ids){
   const {proof,p,request,address}=await freshProof(albumId,id);
   if(request.quantity<input.postcard_ids.length)fail('Client mailing quantity is lower than this live batch.');
   const reserved=(await query("SELECT count(*)::int n FROM gallery_live_mailing_jobs WHERE album_id=$1 AND status<>'CANCELLED'",[albumId])).rows[0].n;
   if(reserved>=request.quantity)fail('Client mailing quantity is already reserved.');
   const key=mailingRecipientKey(address,env.integrationSecretKey);
   if((await query("SELECT 1 FROM gallery_live_mailing_jobs WHERE postcard_id=$1 AND revision=$2 AND status<>'CANCELLED'",[id,p.revision])).rowCount)fail('This exact photo revision already has a live mailing reservation.');
   const duplicate=(await query("SELECT 1 FROM gallery_live_mailing_jobs WHERE album_id=$1 AND recipient_key=$2 AND status<>'CANCELLED'",[albumId,key])).rowCount;
   const extraReason=duplicate?String(input.extra_copy_reason||'').trim():'';
   if(duplicate&&extraReason.length<10)fail('This recipient already has a live mailing reservation. Document approval for the additional photo copy.');
   await query(`INSERT INTO gallery_live_mailing_jobs(batch_id,album_id,postcard_id,revision,recipient_label,recipient_key,recipient_ciphertext,sender_ciphertext,sender_hash,proof_hash,test_postcard_id,cost_cents,extra_copy_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[batch.id,albumId,id,p.revision,p.recipient_label,key,p.recipient_ciphertext,request.return_address_ciphertext,request.return_address_hash,proof.hash,p.lob_postcard_id,input.unit_cost_cents,extraReason]);
  }
  await mailingHistory(albumId,null,'LIVE_BATCH_PREPARED',user,{batchId:batch.id,quantity:input.postcard_ids.length,costLimitCents:input.cost_limit_cents,priceSource:input.price_source,additionalPhotoReason:input.extra_copy_reason||null});return {id:batch.id};
 });
}
async function assertFreshBatch(batch,{onlyPostcardId=null}={}){
 const context=await scope(batch.album_id);
 if(batch.status_channel==='POLLING'&&(!batch.status_channel_verified_at||Date.now()-new Date(batch.status_channel_verified_at).getTime()>24*60*60*1000))fail('Reverify the authenticated provider status connection before release.');
 if(batch.proposal_id!==(context.proposal?.id||null)||batch.version_id!==(context.proposal?.accepted_version_id||null))fail('Accepted proposal changed. Rebuild the live batch.');
 if(Date.now()-new Date(batch.price_verified_at).getTime()>24*60*60*1000)fail('Reconfirm current all-in provider pricing before release.');
 const jobs=(await query('SELECT * FROM gallery_live_mailing_jobs WHERE batch_id=$1',[batch.id])).rows;
 if(jobs.length!==batch.quantity||!liveBatchBudget(batch)||jobs.some(j=>j.cost_cents!==batch.unit_cost_cents))fail('Live batch limits do not match its reservations.');
 if(onlyPostcardId&&!jobs.some(j=>j.postcard_id===onlyPostcardId))fail('The postcard is outside this live batch.');
 for(const job of jobs.filter(j=>!onlyPostcardId||j.postcard_id===onlyPostcardId)){const {proof,p,request}=await freshProof(batch.album_id,job.postcard_id);
  const reserved=(await query("SELECT count(*)::int n FROM gallery_live_mailing_jobs WHERE album_id=$1 AND status<>'CANCELLED'",[batch.album_id])).rows[0].n;
  if(reserved>request.quantity)fail('Client mailing quantity is exceeded.');
  if(proof.hash!==job.proof_hash||p.revision!==job.revision||request.return_address_hash!==job.sender_hash||request.quantity<batch.quantity)fail('Live proof, return address or client quantity changed. Rebuild and reapprove the batch.');
 }
 return jobs;
}
export async function authorizeLiveBatch(albumId,id,input,user){
 await assertFiestaReviewAccess(albumId,user);
 const channel=input.status_channel||'WEBHOOK';if(!['WEBHOOK','POLLING'].includes(channel))fail('Choose a supported provider status channel.',422);
 if(!enabled(channel)||process.env.GALLERY_MAILING_LIVE_WORKER_ENABLED!=='true')fail('Live production mailing and its worker must be configured first.',503);
 if(input.confirmation!=='AUTHORIZE LIVE MAILING')fail('Explicit live mailing confirmation is required.',422);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const batch=(await query('SELECT * FROM gallery_live_mailing_batches WHERE album_id=$1 AND id=$2 FOR UPDATE',[albumId,id])).rows[0];if(!batch||batch.status!=='DRAFT')fail('Only a draft live batch can be authorized.');
  const hook=(await query("SELECT 1 FROM gallery_live_webhook_health WHERE singleton=true AND last_verified_at>now()-interval '7 days'")).rowCount;
  if(channel==='WEBHOOK'&&!hook)fail('Verify the signed production Lob webhook before live release.');
  if(channel==='POLLING'){
   const response=await fetch('https://api.lob.com/v1/postcards?limit=1',{headers:{Authorization:'Basic '+Buffer.from(process.env.LOB_LIVE_API_KEY+':').toString('base64')},signal:AbortSignal.timeout(15000)});
   if(!response.ok)fail('The authenticated live provider status connection could not be verified.',503);
   const value=await response.json();if(!Array.isArray(value.data))fail('The provider returned an invalid status response.',502);
   await mailingHistory(albumId,null,'LIVE_STATUS_POLLING_VERIFIED',user,{batchId:id,provider:'Lob',method:'Authenticated read-only provider API',webhookReceiptClaimed:false});
  }
  await assertFreshBatch(batch);
  await query("UPDATE gallery_live_mailing_batches SET status='AUTHORIZED',authorized_by=$2,authorized_at=now(),authorization_note=$3,status_channel=$4,status_channel_verified_at=now() WHERE id=$1",[id,user.id,input.note,channel]);
  await query("UPDATE gallery_live_mailing_jobs SET status='QUEUED' WHERE batch_id=$1 AND status='DRAFT'",[id]);
  await mailingHistory(albumId,null,'LIVE_MAILING_AUTHORIZED',user,{batchId:id,quantity:batch.quantity,costLimitCents:batch.cost_limit_cents,note:input.note,statusChannel:channel});return {authorized:true};
 });
}
export async function cancelLiveBatch(albumId,id,user){
 await assertFiestaReviewAccess(albumId,user);return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const batch=(await query('SELECT * FROM gallery_live_mailing_batches WHERE album_id=$1 AND id=$2 FOR UPDATE',[albumId,id])).rows[0];if(!batch||!['DRAFT','AUTHORIZED'].includes(batch.status))fail('This batch cannot be cancelled locally.');
  if((await query("SELECT 1 FROM gallery_live_mailing_jobs WHERE batch_id=$1 AND status NOT IN('DRAFT','QUEUED','CANCELLED')",[id])).rowCount)fail('A provider attempt has started; reconcile provider history first.');
  await query("UPDATE gallery_live_mailing_jobs SET status='CANCELLED' WHERE batch_id=$1",[id]);await query("UPDATE gallery_live_mailing_batches SET status='CANCELLED' WHERE id=$1",[id]);
  await mailingHistory(albumId,null,'LIVE_BATCH_CANCELLED',user,{batchId:id});return {cancelled:true};
 });
}
export async function processLiveMailingQueue({limit=5,transport=fetch,batchId=null}={}){
 if(!enabled('POLLING')||process.env.GALLERY_MAILING_LIVE_WORKER_ENABLED!=='true')return [];
 await query("UPDATE gallery_live_mailing_jobs SET status='NEEDS_REVIEW',last_error='Worker stopped during a provider attempt; reconcile before retrying.' WHERE status='PROCESSING' AND started_at<now()-interval '5 minutes'");
 await query("UPDATE gallery_live_mailing_batches b SET status='NEEDS_REVIEW' WHERE status='AUTHORIZED' AND EXISTS(SELECT 1 FROM gallery_live_mailing_jobs j WHERE j.batch_id=b.id AND j.status='NEEDS_REVIEW')");
 const results=[];
 for(let i=0;i<Math.min(limit,25);i++){
  const job=await transaction(async()=>{const row=(await query("SELECT j.* FROM gallery_live_mailing_jobs j JOIN gallery_live_mailing_batches b ON b.id=j.batch_id WHERE j.status='QUEUED' AND b.status='AUTHORIZED' AND ($1::uuid IS NULL OR j.batch_id=$1) ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1",[batchId])).rows[0];if(!row)return null;return (await query("UPDATE gallery_live_mailing_jobs SET status='PROCESSING',started_at=now() WHERE id=$1 RETURNING *",[row.id])).rows[0];});if(!job)break;
  try{
   const batch=(await query('SELECT * FROM gallery_live_mailing_batches WHERE id=$1',[job.batch_id])).rows[0];
   await assertFreshBatch(batch,{onlyPostcardId:job.postcard_id});
   const proof=await renderPostcardProof(job.album_id,job.postcard_id);
   const files=await Promise.all([proof.front,proof.back].map(b=>sharp(b).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer()));
   if(files[0].length+files[1].length>4800000)fail('Artwork exceeds the upload limit.');
   const form=new FormData();
   for(const [prefix,cipher] of [['to',job.recipient_ciphertext],['from',job.sender_ciphertext]])for(const [k,v]of Object.entries(decryptSecretJson(cipher)))if(v)form.append(`${prefix}[${k}]`,v);
   form.append('size','4x6');form.append('mail_type','usps_first_class');form.append('use_type','marketing');form.append('description','The Lola Booth event postcard');
   form.append('metadata[gallery_live_job_id]',job.id);form.append('metadata[gallery_live_batch_id]',job.batch_id);form.append('metadata[gallery_album_id]',job.album_id);
   form.append('front',new Blob([files[0]],{type:'image/png'}),'photo-front.png');form.append('back',new Blob([files[1]],{type:'image/png'}),'event-back.png');
   // Recheck the exact authorization immediately before the outbound request.
   const authorized=await transaction(async()=>{
    await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[job.album_id]);
    const current=(await query('SELECT * FROM gallery_live_mailing_batches WHERE id=$1 FOR UPDATE',[job.batch_id])).rows[0];
    if(!enabled(current.status_channel)||current.status!=='AUTHORIZED')return false;await assertFreshBatch(current,{onlyPostcardId:job.postcard_id});return true;
   });if(!authorized)fail('Live authorization changed before dispatch.');
   const response=await transport('https://api.lob.com/v1/postcards',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.LOB_LIVE_API_KEY+':').toString('base64'),'Idempotency-Key':'lola-live:'+job.id},body:form,signal:AbortSignal.timeout(45000)});
   const value=await response.json().catch(()=>({}));
   if(!response.ok||!/^psc_[A-Za-z0-9]+$/.test(value.id||''))fail('Provider did not confirm creation. Inspect Lob before any retry.');
   await query("UPDATE gallery_live_mailing_jobs SET status='SUBMITTED',lob_postcard_id=$2,lob_status=$3,provider_render_status=$3,finished_at=now(),last_error=NULL WHERE id=$1",[job.id,value.id,String(value.status||'processed')]);
   await mailingHistory(job.album_id,job.postcard_id,'LIVE_PROVIDER_ACCEPTED',null,{jobId:job.id,batchId:job.batch_id,lobId:value.id});results.push({id:job.id,status:'SUBMITTED'});
  }catch{
   await query("UPDATE gallery_live_mailing_jobs SET status='NEEDS_REVIEW',last_error='Live submission not confirmed. Reconcile Lob history before retrying.',finished_at=now() WHERE id=$1",[job.id]);
   await query("UPDATE gallery_live_mailing_batches SET status='NEEDS_REVIEW' WHERE id=$1",[job.batch_id]);results.push({id:job.id,status:'NEEDS_REVIEW'});
  }
 }
 await query("UPDATE gallery_live_mailing_batches b SET status='COMPLETE' WHERE status='AUTHORIZED' AND NOT EXISTS(SELECT 1 FROM gallery_live_mailing_jobs j WHERE j.batch_id=b.id AND j.status<>'SUBMITTED')");
 await applyLiveLobEvents();await refreshLiveMailings();return results;
}
export async function receiveLiveLobEvent(raw,headers){
 if(process.env.APP_ENV!=='production'||!verifyLobSignature(raw,headers,process.env.LOB_LIVE_WEBHOOK_SECRET))fail('Invalid production Lob webhook signature.',401);
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{fail('Invalid webhook.',422);}
 const reference=event.reference_id||event.body?.id,type=event.event_type?.id;
 if(!/^evt_[A-Za-z0-9]+$/.test(event.id||'')||!/^psc_[A-Za-z0-9]+$/.test(reference||'')||!/^postcard\.[a-z_-]+$/.test(type||'')||!Number.isFinite(Date.parse(event.date_created)))fail('Unsupported Lob event.',422);
 await transaction(async()=>{
  const inserted=await query('INSERT INTO gallery_live_lob_events(event_id,postcard_reference,event_type,provider_created_at,payload_ciphertext) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING event_id',[event.id,reference,type,event.date_created,encryptSecretJson(event)]);
  if(inserted.rowCount)await query('INSERT INTO gallery_live_webhook_health(singleton,last_verified_at,event_id) VALUES(true,now(),$1) ON CONFLICT(singleton) DO UPDATE SET last_verified_at=now(),event_id=EXCLUDED.event_id',[event.id]);
 });await applyLiveLobEvents();return {received:true};
}
export async function applyLiveLobEvents(){
 await transaction(async()=>{
  const rows=(await query('SELECT e.*,j.id AS job_id,j.album_id,j.postcard_id FROM gallery_live_lob_events e JOIN gallery_live_mailing_jobs j ON j.lob_postcard_id=e.postcard_reference WHERE e.processed_at IS NULL ORDER BY e.provider_created_at,e.event_id FOR UPDATE OF e SKIP LOCKED LIMIT 100')).rows;
  for(const e of rows){await query('UPDATE gallery_live_mailing_jobs SET lob_status=$2,provider_updated_at=$3 WHERE id=$1 AND (provider_updated_at IS NULL OR provider_updated_at<=$3)',[e.job_id,e.event_type.slice(9),e.provider_created_at]);await query('UPDATE gallery_live_lob_events SET processed_at=now() WHERE event_id=$1',[e.event_id]);await mailingHistory(e.album_id,e.postcard_id,'LIVE_LOB_'+e.event_type.toUpperCase(),null,{jobId:e.job_id,eventId:e.event_id});}
 });
}
export async function refreshLiveMailings(){
 if(!enabled('POLLING'))return;
 const jobs=(await query("SELECT id,lob_postcard_id FROM gallery_live_mailing_jobs WHERE status='SUBMITTED' AND (last_status_checked_at IS NULL OR last_status_checked_at<now()-interval '2 minutes') ORDER BY created_at LIMIT 25")).rows;
 for(const job of jobs){await query('UPDATE gallery_live_mailing_jobs SET last_status_checked_at=now() WHERE id=$1',[job.id]);try{
  const response=await fetch('https://api.lob.com/v1/postcards/'+job.lob_postcard_id,{headers:{Authorization:'Basic '+Buffer.from(process.env.LOB_LIVE_API_KEY+':').toString('base64')},signal:AbortSignal.timeout(15000)});if(!response.ok)continue;const value=await response.json();if(value.id!==job.lob_postcard_id)continue;
  await query('UPDATE gallery_live_mailing_jobs SET provider_render_status=$2,lob_status=CASE WHEN provider_updated_at IS NULL THEN $2 ELSE lob_status END WHERE id=$1',[job.id,String(value.status||'processed')]);
 }catch{/* A status polling failure never resubmits mail. */}}
}

export async function liveBatchTestProof(albumId,postcardId,user){
 await assertFiestaReviewAccess(albumId,user);const {p}=await freshProof(albumId,postcardId);
 const key=process.env.LOB_TEST_API_KEY||'';if(!key.startsWith('test_'))fail('The separate Lob test key is required to retrieve the approved test PDF.',503);
 const response=await fetch('https://api.lob.com/v1/postcards/'+p.lob_postcard_id,{headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64')},signal:AbortSignal.timeout(15000)});
 if(!response.ok)fail('The test proof could not be verified.',502);const value=await response.json();
 if(value.id!==p.lob_postcard_id||!lobProofReady(value,p.id))fail('Provider proof does not match this reviewed postcard.');
 return {id:value.id,status:'rendered',providerStatus:value.status,url:value.url};
}
