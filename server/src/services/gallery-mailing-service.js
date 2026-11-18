import {lobProofReady} from '../../../shared/lob-proof-policy.js';
import {normalizeUsMailAddress} from '../../../shared/us-mail-address.js';
import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {assertFiestaReviewAccess,assertPostcardSurveyClear} from './fiesta-survey-review-service.js';
import {clientEventGrant} from './client-session-workspace-service.js';
import {acceptedMailingAllowance,mailingRecipientKey,verifyLobSignature} from '../../../shared/gallery-mailing-policy.js';
import {lobPrintTestEnabled} from '../../../shared/postcard-print-policy.js';
const fail=(message,status=409)=>{throw new AppError(message,status,'GALLERY_MAILING_REVIEW');};
export async function mailingHistory(albumId,postcardId,action,user,detail={}){
 await query('INSERT INTO gallery_mailing_history(album_id,postcard_id,action,actor_id,detail_ciphertext) VALUES($1,$2,$3,$4,$5)',[albumId,postcardId,action,user?.id||null,encryptSecretJson(detail)]);
}
async function context(albumId){
 const album=(await query('SELECT a.*,e.client_id,e.status AS event_status,e.deleted_at AS event_deleted_at,e.sales_closed_at FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.id=$1',[albumId])).rows[0];if(!album)fail('Gallery unavailable.',404);
 const proposal=(await query(`SELECT p.id,p.accepted_version_id,v.snapshot FROM proposals p JOIN proposal_versions v ON v.id=p.accepted_version_id AND v.proposal_id=p.id WHERE p.event_id=$1 AND p.deleted_at IS NULL AND p.status IN('ACCEPTED','CONVERTED') ORDER BY p.created_at DESC LIMIT 1`,[album.event_id])).rows[0];
 return {album,proposal,allowance:acceptedMailingAllowance(proposal?.snapshot)};
}
export async function configureMailing(albumId,input,user){
 await assertFiestaReviewAccess(albumId,user);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const scope=await context(albumId);
  if(input.quantity_limit>scope.allowance&&!input.override_reason.trim())fail('Document the authorization for quantity beyond the accepted proposal allowance.',422);
  const reserved=(await query("SELECT count(*)::int n,COALESCE(sum(cost_cents),0)::int cost FROM gallery_mailing_jobs WHERE album_id=$1 AND status<>'CANCELLED'",[albumId])).rows[0];
  if(reserved.n>input.quantity_limit||reserved.cost>input.cost_limit_cents)fail('The limits cannot be lower than already reserved mailing quantities or costs.');
  await query(`INSERT INTO gallery_mailing_policies(album_id,proposal_id,version_id,allowance_quantity,quantity_limit,cost_limit_cents,unit_cost_cents,override_reason,approved_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(album_id) DO UPDATE SET proposal_id=EXCLUDED.proposal_id,version_id=EXCLUDED.version_id,allowance_quantity=EXCLUDED.allowance_quantity,quantity_limit=EXCLUDED.quantity_limit,cost_limit_cents=EXCLUDED.cost_limit_cents,unit_cost_cents=EXCLUDED.unit_cost_cents,override_reason=EXCLUDED.override_reason,approved_by=EXCLUDED.approved_by,approved_at=now()`,[albumId,scope.proposal?.id||null,scope.proposal?.accepted_version_id||null,scope.allowance,input.quantity_limit,input.cost_limit_cents,input.unit_cost_cents,input.override_reason,user.id]);
  await mailingHistory(albumId,null,'MAILING_LIMITS_APPROVED',user,input);return mailingSummary(albumId,user);
 });
}
export async function mailingSummary(albumId,user){
 await assertFiestaReviewAccess(albumId,user);
 const scope=await context(albumId);
 const [policy,jobs,history,requests]=await Promise.all([
  query('SELECT * FROM gallery_mailing_policies WHERE album_id=$1',[albumId]),
  query(`SELECT j.id,j.postcard_id,j.revision,j.status,j.cost_cents,j.extra_copy_reason,j.created_at,j.last_error,p.recipient_label,p.lob_postcard_id,p.lob_status,p.proof_approved_at FROM gallery_mailing_jobs j JOIN gallery_postcards p ON p.id=j.postcard_id WHERE j.album_id=$1 ORDER BY j.created_at DESC LIMIT 1000`,[albumId]),
  query('SELECT id,postcard_id,action,created_at FROM gallery_mailing_history WHERE album_id=$1 ORDER BY id DESC LIMIT 100',[albumId]),
  query('SELECT id,quantity,notes,status,review_note,created_at,return_address_ciphertext FROM gallery_mailing_requests WHERE album_id=$1 ORDER BY created_at DESC',[albumId])]);
 return {connection:{testKey:process.env.LOB_TEST_API_KEY?.startsWith('test_')||false,sender:requests.rows.some(r=>r.status==='APPROVED'&&r.return_address_ciphertext),webhook:Boolean(process.env.LOB_TEST_WEBHOOK_SECRET&&process.env.LOB_TEST_WEBHOOK_SECRET!=='secret'),worker:process.env.GALLERY_MAILING_WORKER_ENABLED==='true'},allowance:scope.allowance,proposalId:scope.proposal?.id||null,policy:policy.rows[0]||null,jobs:jobs.rows,history:history.rows,requests:requests.rows.map(({return_address_ciphertext,...r})=>({...r,returnAddress:return_address_ciphertext?decryptSecretJson(return_address_ciphertext):null})),testOnly:true};
}
async function clientAlbum(session,eventId){
 await clientEventGrant(session,eventId);
 const row=(await query("SELECT a.id FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.event_id=$1 AND a.status NOT IN('ARCHIVED','EXPIRED') AND e.status<>'CANCELLED' AND e.deleted_at IS NULL AND e.sales_closed_at IS NULL",[eventId])).rows[0];
 if(!row)fail('Mailing is not configured for this event yet.',404);return row.id;
}
export async function clientMailingView(session,eventId){
 const albumId=await clientAlbum(session,eventId);
 const [requests,counts]=await Promise.all([query('SELECT id,quantity,notes,status,review_note,return_address_ciphertext FROM gallery_mailing_requests WHERE album_id=$1 AND client_id=$2',[albumId,session.client_id]),query("SELECT count(*) FILTER(WHERE status='SUBMITTED_TEST')::int submitted,count(*) FILTER(WHERE status IN('DRAFT','APPROVED'))::int drafts FROM gallery_postcards WHERE album_id=$1",[albumId])]);
 const r=requests.rows[0];const request=r?{id:r.id,quantity:r.quantity,notes:r.notes,status:r.status,review_note:r.review_note,returnAddress:r.return_address_ciphertext?decryptSecretJson(r.return_address_ciphertext):null}:null;
 return {request,summary:counts.rows[0],message:'US-only 4×6 postcards. Guest mailing permission and a valid US address are required. Requests are reviewed before any mailing.'};
}
export async function requestClientMailing(session,eventId,input){
 const albumId=await clientAlbum(session,eventId),sender=normalizeUsMailAddress(input.return_address);
 if(!sender)fail('Provide the client’s complete US return address, including name, street, city, state and ZIP.',422);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  await query(`INSERT INTO gallery_mailing_requests(album_id,client_id,quantity,notes,return_address_ciphertext,return_address_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(album_id,client_id) DO UPDATE SET quantity=EXCLUDED.quantity,notes=EXCLUDED.notes,return_address_ciphertext=EXCLUDED.return_address_ciphertext,return_address_hash=EXCLUDED.return_address_hash,status='REQUESTED',reviewed_by=NULL,review_note=NULL,updated_at=now()`,[albumId,session.client_id,input.quantity,input.notes,encryptSecretJson(sender),mailingRecipientKey(sender,env.integrationSecretKey)]);
  await mailingHistory(albumId,null,'CLIENT_MAILING_REQUESTED',null,{clientId:session.client_id,quantity:input.quantity});return clientMailingView(session,eventId);
 });
}
// Admin records a client-provided address without impersonating a client session.
export async function recordAdminMailingRequest(albumId,input,user){
 await assertFiestaReviewAccess(albumId,user);
 const sender=normalizeUsMailAddress(input.return_address);
 if(!sender)fail('Provide the client’s complete US return address.',422);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const scope=await context(albumId);
  if(!scope.album.client_id)fail('Link the gallery to its client before recording a mailing request.');
  if(['ARCHIVED','EXPIRED'].includes(scope.album.status)||scope.album.event_status==='CANCELLED'||scope.album.event_deleted_at||scope.album.sales_closed_at)fail('Mailing is unavailable for a closed event/gallery.');
  await query(`INSERT INTO gallery_mailing_requests(album_id,client_id,quantity,notes,return_address_ciphertext,return_address_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(album_id,client_id) DO UPDATE SET quantity=EXCLUDED.quantity,notes=EXCLUDED.notes,return_address_ciphertext=EXCLUDED.return_address_ciphertext,return_address_hash=EXCLUDED.return_address_hash,status='REQUESTED',reviewed_by=NULL,review_note=NULL,updated_at=now()`,[albumId,scope.album.client_id,input.quantity,input.notes,encryptSecretJson(sender),mailingRecipientKey(sender,env.integrationSecretKey)]);
  await mailingHistory(albumId,null,'ADMIN_RECORDED_CLIENT_MAILING_REQUEST',user,{clientId:scope.album.client_id,quantity:input.quantity,source:input.notes});
  return {recorded:true};
 });
}
export async function reviewClientMailing(albumId,id,input,user){
 await assertFiestaReviewAccess(albumId,user);
 const policy=(await query('SELECT quantity_limit FROM gallery_mailing_policies WHERE album_id=$1',[albumId])).rows[0];
 const result=await query('SELECT quantity,return_address_ciphertext FROM gallery_mailing_requests WHERE album_id=$1 AND id=$2',[albumId,id]);if(!result.rowCount)fail('Request unavailable.',404);
 if(input.status==='APPROVED'&&!result.rows[0].return_address_ciphertext)fail('The client must provide a return address before this request can be approved.');
 if(input.status==='APPROVED'&&(!policy||result.rows[0].quantity>policy.quantity_limit))fail('Approve sufficient event mailing limits first.');
 await query('UPDATE gallery_mailing_requests SET status=$3,review_note=$4,reviewed_by=$5,updated_at=now() WHERE album_id=$1 AND id=$2',[albumId,id,input.status,input.note,user.id]);
 await mailingHistory(albumId,null,'CLIENT_REQUEST_'+input.status,user,{requestId:id,note:input.note});return {updated:true};
}
export async function approvePersonalizedProof(albumId,id,user){
 await assertFiestaReviewAccess(albumId,user);
 return transaction(async()=>{
 await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
 await assertPostcardSurveyClear(albumId,[id]);
 if(!(await query("SELECT 1 FROM gallery_mailing_requests WHERE album_id=$1 AND status='APPROVED' AND return_address_ciphertext IS NOT NULL",[albumId])).rowCount)fail('Approve the client mailing request and return address before approving proofs.');
 const {renderProof}=await import('./lob-print-ready-service.js');const {hash}=await renderProof(albumId,id);
 const changed=await query("UPDATE gallery_postcards SET proof_hash=$3,proof_approved_by=$4,proof_approved_at=now() WHERE album_id=$1 AND id=$2 AND status IN('DRAFT','APPROVED') RETURNING id",[albumId,id,hash,user.id]);if(!changed.rowCount)fail('Only unsubmitted drafts can be proof-approved.');
 await mailingHistory(albumId,id,'PERSONALIZED_PROOF_APPROVED',user,{hash});return {approved:true};
 });
}
export async function enqueueMailing(albumId,id,user,extraReason=''){
 if(!lobPrintTestEnabled(process.env))fail('Lob tests are disabled in this environment.',403);
 await assertFiestaReviewAccess(albumId,user);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const scope=await context(albumId),policy=(await query('SELECT * FROM gallery_mailing_policies WHERE album_id=$1',[albumId])).rows[0];
  if(scope.album.event_status==='CANCELLED'||scope.album.event_deleted_at||scope.album.sales_closed_at||['ARCHIVED','EXPIRED'].includes(scope.album.status))fail('Mailing is unavailable for a closed or cancelled event/gallery.');
  if(!policy||policy.proposal_id!==(scope.proposal?.id||null)||policy.version_id!==(scope.proposal?.accepted_version_id||null))fail('Review mailing limits against the current accepted proposal first.');
  const p=(await query('SELECT * FROM gallery_postcards WHERE album_id=$1 AND id=$2',[albumId,id])).rows[0];
  if(!p||p.status!=='APPROVED'||!p.proof_hash)fail('Approve the draft and personalized proof before queueing.');
  const currentProof=await (await import('./lob-print-ready-service.js')).renderProof(albumId,id);if(currentProof.hash!==p.proof_hash)fail('The personalized proof changed. Approve it again.');
  const existing=(await query('SELECT id,status FROM gallery_mailing_jobs WHERE postcard_id=$1 AND revision=$2',[id,p.revision])).rows[0];
  if(existing)return {queued:existing.status==='PENDING',jobId:existing.id,status:existing.status};
  const used=(await query("SELECT count(*)::int n,COALESCE(sum(cost_cents),0)::int cost FROM gallery_mailing_jobs WHERE album_id=$1 AND status<>'CANCELLED'",[albumId])).rows[0];
  if(used.n>=policy.quantity_limit||used.cost+policy.unit_cost_cents>policy.cost_limit_cents)fail('Event quantity or spending limit reached.');
  const requested=(await query("SELECT quantity,status,return_address_ciphertext,return_address_hash FROM gallery_mailing_requests WHERE album_id=$1 ORDER BY updated_at DESC LIMIT 1",[albumId])).rows[0];
  if(!requested?.return_address_ciphertext||requested.status!=='APPROVED')fail('An approved client return address is required for this mailing run.');
  if(requested&&(requested.status!=='APPROVED'||used.n>=requested.quantity))fail('The client mailing request requires approval or its quantity has been reached.');
  const key=mailingRecipientKey(decryptSecretJson(p.recipient_ciphertext),env.integrationSecretKey);
  const prior=await query("SELECT 1 FROM gallery_mailing_jobs WHERE album_id=$1 AND recipient_key=$2 AND status<>'CANCELLED'",[albumId,key]);
  if(prior.rowCount&&extraReason.trim().length<10)fail('This recipient already has a reserved postcard. An Admin reason is required for an extra copy.');
  const job=(await query('INSERT INTO gallery_mailing_jobs(album_id,postcard_id,revision,recipient_key,proof_hash,cost_cents,created_by,extra_copy_reason,sender_ciphertext,sender_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[albumId,id,p.revision,key,p.proof_hash,policy.unit_cost_cents,user.id,extraReason.trim(),requested.return_address_ciphertext,requested.return_address_hash])).rows[0];
  await mailingHistory(albumId,id,'TEST_MAILING_QUEUED',user,{jobId:job.id,extraCopyReason:extraReason});return {queued:true,jobId:job.id,status:'PENDING'};
 });
}
export async function reconcilePostcard(albumId,id,input,user){
 await assertFiestaReviewAccess(albumId,user);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const p=(await query('SELECT * FROM gallery_postcards WHERE album_id=$1 AND id=$2 FOR UPDATE',[albumId,id])).rows[0];if(!p)fail('Postcard unavailable.',404);
  if(p.lob_postcard_id||p.status==='SUBMITTED_TEST')fail('A provider-created postcard cannot be replaced. Review the provider record first.');
  const jobs=(await query('SELECT status FROM gallery_mailing_jobs WHERE postcard_id=$1',[id])).rows;
  if(jobs.some(j=>j.status==='PROCESSING'))fail('Wait for the active attempt to finish or become uncertain before reconciling.');
  if((p.status==='FAILED'||p.status==='SUBMITTING'||jobs.some(j=>j.status==='NEEDS_REVIEW'))&&!input.confirm_not_created)fail('Confirm from provider records that no postcard was created before releasing an uncertain attempt.');
  await mailingHistory(albumId,id,'DRAFT_RECONCILED',user,{reason:input.reason,confirmNotCreated:input.confirm_not_created,previous:p});
  await query("UPDATE gallery_mailing_jobs SET status='CANCELLED',finished_at=now(),last_error='Admin reconciled: no provider postcard created' WHERE postcard_id=$1 AND status IN('PENDING','NEEDS_REVIEW')",[id]);
  const recipient=(await query('SELECT * FROM gallery_postcard_recipients WHERE album_id=$1 AND postcard_id=$2',[albumId,id])).rows[0];
  if(!recipient)fail('This draft has no current Fiesta recipient. Reimport its survey first.');
  const latest=(await query(`SELECT answers_ciphertext FROM gallery_fiesta_survey_rows WHERE album_id=$1 AND person_id=$2 AND filename=$3 ORDER BY sequence DESC LIMIT 1`,[albumId,p.person_id,recipient.filename])).rows[0];
  const postal=latest?decryptSecretJson(latest.answers_ciphertext).postal:null;
  await query("UPDATE gallery_postcards SET status='CANCELLED',proof_hash=NULL,proof_approved_at=NULL WHERE id=$1",[id]);
  await query('UPDATE gallery_postcard_recipients SET postcard_id=NULL,consent=$3,recipient_ciphertext=$4,consent_source=$5,status=$6,media_id=NULL,updated_at=now() WHERE id=$1 AND album_id=$2',[recipient.id,albumId,Boolean(postal?.complete&&postal?.consent&&postal?.consentRecorded),postal?encryptSecretJson(postal.recipient):recipient.recipient_ciphertext,postal?.consentSource||recipient.consent_source,postal?.complete&&postal?.consent&&postal?.consentRecorded?'UNMATCHED':'NO_CONSENT']);
  // Keep the same document identity, with an auditable new revision, when the corrected answers permit rebuilding.
  if(postal?.complete&&postal?.consent&&postal?.consentRecorded){
   const art=(await query("SELECT id FROM gallery_postcard_back_artworks WHERE album_id=$1 AND status='APPROVED' ORDER BY version DESC LIMIT 1",[albumId])).rows[0];
   if(!art)fail('Approve the current postcard back before rebuilding.');
   await query('UPDATE gallery_postcards SET back_url=$2 WHERE id=$1',[id,'gallery-artwork:'+art.id]);
   await query("UPDATE gallery_postcards SET status='DRAFT',revision=revision+1,recipient_ciphertext=$2,consent_source=$3,last_error=NULL,approved_by=NULL,approved_at=NULL,proof_hash=NULL,proof_approved_by=NULL,proof_approved_at=NULL WHERE id=$1",[id,encryptSecretJson(postal.recipient),postal.consentSource]);
   await query("UPDATE gallery_postcard_recipients SET postcard_id=$2,status='PREPARED',media_id=$3,consent=true WHERE id=$1",[recipient.id,id,p.media_id]);
   // A fresh source snapshot records that the correction was incorporated into this draft revision.
   await query("UPDATE gallery_fiesta_survey_rows SET status='IMPORTED',issues='{}' WHERE id=(SELECT id FROM gallery_fiesta_survey_rows WHERE album_id=$1 AND person_id=$2 AND filename=$3 ORDER BY sequence DESC LIMIT 1)",[albumId,p.person_id,recipient.filename]);
  }
  return {rebuilt:Boolean(postal?.complete&&postal?.consent&&postal?.consentRecorded)};
 });
}
export async function processMailingQueue({limit=5,execute}={}){
 if(process.env.GALLERY_MAILING_WORKER_ENABLED!=='true'||!lobPrintTestEnabled(process.env)||!process.env.LOB_TEST_API_KEY?.startsWith('test_'))return [];
 // A crashed HTTP attempt is uncertain, never automatically resent.
 await query("UPDATE gallery_mailing_jobs j SET status=CASE WHEN p.lob_postcard_id IS NULL THEN 'NEEDS_REVIEW' ELSE 'SUBMITTED' END,last_error=CASE WHEN p.lob_postcard_id IS NULL THEN 'Worker stopped during submission; reconcile provider history' ELSE NULL END FROM gallery_postcards p WHERE p.id=j.postcard_id AND j.status='PROCESSING' AND j.started_at<now()-interval '2 minutes'");
 await query("UPDATE gallery_postcards p SET status='FAILED',last_error='Submission requires provider reconciliation' WHERE p.status='SUBMITTING' AND EXISTS(SELECT 1 FROM gallery_mailing_jobs j WHERE j.postcard_id=p.id AND j.status='NEEDS_REVIEW')");
 const results=[];
 for(let i=0;i<Math.min(limit,25);i++){
  const job=await transaction(async()=>{
   const r=await query("SELECT * FROM gallery_mailing_jobs WHERE status='PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");if(!r.rowCount)return null;
   return (await query("UPDATE gallery_mailing_jobs SET status='PROCESSING',started_at=now() WHERE id=$1 RETURNING *",[r.rows[0].id])).rows[0];
  });if(!job)break;
  try{
   const scope=await context(job.album_id),policy=(await query('SELECT * FROM gallery_mailing_policies WHERE album_id=$1',[job.album_id])).rows[0];
   if(!policy||policy.proposal_id!==(scope.proposal?.id||null)||policy.version_id!==(scope.proposal?.accepted_version_id||null))fail('Mailing authorization changed; review the queue.');
   const dispatch=execute||(await import('./lob-print-ready-service.js')).executeLobPrintTest;
   const result=await dispatch(job.album_id,job.postcard_id,{id:job.created_by,permissions:['*']},job);
   await query("UPDATE gallery_mailing_jobs SET status='SUBMITTED',finished_at=now(),last_error=NULL WHERE id=$1",[job.id]);
   await mailingHistory(job.album_id,job.postcard_id,'PROVIDER_ACCEPTED_TEST',null,{jobId:job.id,lobId:result.lob_postcard_id});results.push({id:job.id,status:'SUBMITTED'});
  }catch{
   await query("UPDATE gallery_mailing_jobs SET status='NEEDS_REVIEW',finished_at=now(),last_error='Submission not confirmed. Reconcile before retrying.' WHERE id=$1",[job.id]);
   await mailingHistory(job.album_id,job.postcard_id,'PROVIDER_OUTCOME_NEEDS_REVIEW',null,{jobId:job.id});results.push({id:job.id,status:'NEEDS_REVIEW'});
  }
 }
 await applyLobEvents();await refreshSubmittedMailings();return results;
}
export async function receiveLobEvent(raw,headers){
 if(!lobPrintTestEnabled(process.env))fail('Lob webhook unavailable.',403);
 if(!verifyLobSignature(raw,headers,process.env.LOB_TEST_WEBHOOK_SECRET))fail('Invalid or expired Lob signature.',401);
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{fail('Invalid event.',422);}
 const type=event.event_type?.id,reference=event.reference_id||event.body?.id;
 if(!/^evt_[a-zA-Z0-9]+$/.test(event.id||'')||!/^psc_[a-zA-Z0-9]+$/.test(reference||'')||!/^postcard\.[a-z_]+$/.test(type||'')||!Number.isFinite(Date.parse(event.date_created)))fail('Unsupported Lob event.',422);
 await query('INSERT INTO gallery_lob_events(event_id,postcard_reference,event_type,provider_created_at,payload_ciphertext) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[event.id,reference,type,event.date_created,encryptSecretJson(event)]);
 await applyLobEvents();return {received:true};
}
export async function applyLobEvents(){
 return transaction(async()=>{
  const events=(await query(`SELECT e.*,p.id,p.album_id FROM gallery_lob_events e JOIN gallery_postcards p ON p.lob_postcard_id=e.postcard_reference WHERE e.processed_at IS NULL ORDER BY e.provider_created_at,e.event_id FOR UPDATE OF e SKIP LOCKED LIMIT 100`)).rows;
  for(const event of events){
   await query("UPDATE gallery_postcards SET lob_status=$2,provider_updated_at=$3 WHERE id=$1 AND (provider_updated_at IS NULL OR provider_updated_at<=$3)",[event.id,event.event_type.replace('postcard.',''),event.provider_created_at]);
   await mailingHistory(event.album_id,event.id,'LOB_'+event.event_type.toUpperCase(),null,{eventId:event.event_id});
   await query('UPDATE gallery_lob_events SET processed_at=now() WHERE event_id=$1',[event.event_id]);
  }
  return events.length;
 });
}

export async function linkProviderPostcard(albumId,id,providerId,user){
 if(!lobPrintTestEnabled(process.env))fail('Lob test reconciliation is disabled.',403);
 await assertFiestaReviewAccess(albumId,user);
 const key=process.env.LOB_TEST_API_KEY||'';if(!key.startsWith('test_'))fail('Lob TEST key required.',503);
 if(!/^psc_[A-Za-z0-9]+$/.test(providerId))fail('Invalid Lob postcard ID.',422);
 const job=(await query('SELECT * FROM gallery_mailing_jobs WHERE album_id=$1 AND postcard_id=$2 ORDER BY created_at DESC LIMIT 1',[albumId,id])).rows[0];
 if(!job)fail('No tracked submission exists for this draft.');
 const response=await fetch('https://api.lob.com/v1/postcards/'+providerId,{headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64')},signal:AbortSignal.timeout(15000)});
 if(!response.ok)fail('Provider record could not be verified.',502);const value=await response.json();
 if(value.id!==providerId||value.metadata?.postcard_id!==id||value.metadata?.mailing_job_id!==job.id)fail('The provider postcard does not match this exact submission.');
 await transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  await query("UPDATE gallery_postcards SET lob_postcard_id=$3,provider_render_status=$4,lob_status=CASE WHEN provider_updated_at IS NULL THEN $6 ELSE lob_status END,status='SUBMITTED_TEST',last_error=NULL,last_status_checked_at=now() WHERE album_id=$1 AND id=$2 AND revision=$5",[albumId,id,providerId,lobProofReady(value,id)?'rendered':String(value.status||'processed'),job.revision,String(value.status||'processed')]);
  await query("UPDATE gallery_mailing_jobs SET status='SUBMITTED',last_error=NULL,finished_at=now() WHERE id=$1",[job.id]);
  await mailingHistory(albumId,id,'PROVIDER_RECORD_VERIFIED',user,{jobId:job.id,providerId});
 });await applyLobEvents();return {linked:true};
}

export async function refreshSubmittedMailings(){
 if(!lobPrintTestEnabled(process.env)||!process.env.LOB_TEST_API_KEY?.startsWith('test_'))return;
 const rows=(await query("SELECT DISTINCT p.id,p.album_id,p.lob_postcard_id FROM gallery_postcards p JOIN gallery_mailing_jobs j ON j.postcard_id=p.id WHERE j.status='SUBMITTED' AND p.status='SUBMITTED_TEST' AND (p.last_status_checked_at IS NULL OR p.last_status_checked_at<now()-interval '2 minutes') ORDER BY p.id LIMIT 5")).rows;
 for(const row of rows){
  if(!/^psc_[A-Za-z0-9]+$/.test(row.lob_postcard_id||''))continue;
  await query('UPDATE gallery_postcards SET last_status_checked_at=now() WHERE id=$1',[row.id]);
  try{
   const response=await fetch('https://api.lob.com/v1/postcards/'+row.lob_postcard_id,{headers:{Authorization:'Basic '+Buffer.from(process.env.LOB_TEST_API_KEY+':').toString('base64')},signal:AbortSignal.timeout(15000)});
   if(!response.ok)continue;const value=await response.json();if(value.id!==row.lob_postcard_id||!['processed','rendered','failed'].includes(value.status))continue;
   await query('UPDATE gallery_postcards SET provider_render_status=$2,lob_status=CASE WHEN provider_updated_at IS NULL THEN $3 ELSE lob_status END WHERE id=$1',[row.id,lobProofReady(value,row.id)?'rendered':value.status,value.status]);
   await mailingHistory(row.album_id,row.id,'PROVIDER_STATUS_VERIFIED',null,{status:value.status});
  }catch{/* Status lookup failure never re-sends an order. */}
 }
}
