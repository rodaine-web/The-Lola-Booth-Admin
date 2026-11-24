import crypto from 'node:crypto';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {availabilityCalendar} from './lead-availability-service.js';
import {nextNumber,createProposalVersion} from './proposal-service.js';
import {queuePaidAgreement,AGREEMENT_HANDOFF_JOB,agreementHandoffEnabled} from './booking-agreement-handoff-service.js';
import {INVOICE_HANDOFF_JOB,invoiceHandoffEnabled} from './proposal-acceptance-service.js';
const fail=(message,code='OPPORTUNITY_CHANGED')=>new AppError(message,409,code);
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reviewInput=z.object({fingerprint:z.string().length(64),reason:z.string().trim().min(10).max(2000),availabilityReviewed:z.boolean().optional(),calendarRevision:z.string().optional(),createDraft:z.boolean().default(true)}).strict();
export async function clientOpportunities(clientId){return (await query(`SELECT DISTINCT l.id,l.first_name,l.last_name,l.event_type,l.event_date,l.status,l.converted_event_id FROM leads l LEFT JOIN proposals p ON p.lead_id=l.id WHERE l.deleted_at IS NULL AND (l.converted_client_id=$1 OR p.client_id=$1) ORDER BY l.event_date DESC NULLS LAST,l.id`,[clientId])).rows;}
export async function opportunityPreview(id){
 const lead=(await query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];if(!lead)throw fail('Opportunity not found.','NOT_FOUND');
 const proposals=(await query('SELECT id,proposal_number,status,event_id,updated_at,accepted_version_id FROM proposals WHERE lead_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id',[id])).rows;
 const ids=[...new Set([lead.converted_event_id,...proposals.map(p=>p.event_id)].filter(Boolean))];
 const events=(await query('SELECT id,event_name,status,sales_closed_at,updated_at FROM events WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id',[ids])).rows;
 const protectedBooking=(await query('SELECT sales_lead_protected($1) AS protected',[id])).rows[0].protected;
 const calendar=await availabilityCalendar(lead);
 return {lead:{id:lead.id,name:[lead.first_name,lead.last_name].filter(Boolean).join(' '),status:lead.status,eventDate:lead.event_date},events,proposals,protected:protectedBooking,calendar,canRestore:lead.status==='LOST'||events.some(e=>e.sales_closed_at),fingerprint:digest([lead.updated_at,lead.status,events,proposals,protectedBooking,calendar.revision])};
}
async function reviewed(id,raw){const input=reviewInput.parse(raw);await query('SELECT pg_advisory_xact_lock(7811051)');await query('SELECT id FROM leads WHERE id=$1 FOR UPDATE',[id]);await query('SELECT id FROM proposals WHERE lead_id=$1 ORDER BY id FOR UPDATE',[id]);const preview=await opportunityPreview(id);if(input.fingerprint!==preview.fingerprint)throw fail('The opportunity changed. Refresh and review it again.');return {input,preview};}
export async function closeOpportunity(id,raw,req){return transaction(async()=>{const {input,preview}=await reviewed(id,raw);if(preview.protected)throw fail('A paid, signed or confirmed booking needs a reviewed cancellation. No records were changed.','CANCELLATION_REVIEW_REQUIRED');if(preview.lead.status==='LOST')return {closed:true,alreadyClosed:true};await query("UPDATE leads SET status='LOST',notes=concat_ws(E'\n',NULLIF(notes,''),$2::text),updated_at=now() WHERE id=$1",[id,'Opportunity closed: '+input.reason]);await writeAudit({req,action:'opportunity_closed',entity:'lead',entityId:id,before:preview,after:{reason:input.reason}});return {closed:true};});}
async function replacementDraft(sourceId,user){
 const source=(await query('SELECT * FROM proposals WHERE id=$1',[sourceId])).rows[0];if(!source)return null;
 const number=await nextNumber({query},'next_proposal_number','proposal_prefix','PROP');
 const fields=['lead_id','client_id','event_id','package_id','experience_id','notes','total','content','pricing_snapshot','line_items_snapshot','document_template_key','editable_sections','proposal_source','proposal_title','external_document_storage_key','external_document_filename','external_document_mime_type','external_document_size_bytes','proposal_type','selected_experiences','proposal_visuals','visual_sections'];
 const json=new Set(['content','pricing_snapshot','line_items_snapshot','editable_sections','selected_experiences','proposal_visuals','visual_sections']);
 const values=fields.map(k=>json.has(k)?JSON.stringify(source[k]??(k.endsWith('sections')||k==='selected_experiences'||k==='line_items_snapshot'?[]:{})):source[k]);
 values.push(number,user.id);
 const row=(await query(`INSERT INTO proposals (${fields.join(',')},proposal_number,owner_user_id,status,secure_token,proposal_date,valid_through) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')},$${values.length-1},$${values.length},'DRAFT',encode(gen_random_bytes(24),'hex'),business_today(),business_today()+14) RETURNING *`,values)).rows[0];
 await createProposalVersion({query},row,user.id);return {id:row.id,proposal_number:number};
}
export async function reopenOpportunity(id,raw,req){return transaction(async()=>{
 const {input,preview}=await reviewed(id,raw);if(!preview.canRestore)throw fail('This opportunity is already active.');if(preview.protected)throw fail('Review the existing signed, paid or confirmed booking before reopening.','CANCELLATION_REVIEW_REQUIRED');
 if(input.availabilityReviewed!==true||input.calendarRevision!==preview.calendar.revision)throw fail('Review current calendar commitments and confirm availability before restoring this opportunity.','AVAILABILITY_REVIEW_REQUIRED');
 const other=(await query(`SELECT 1 FROM proposals WHERE event_id=ANY($1::uuid[]) AND lead_id IS DISTINCT FROM $2 AND deleted_at IS NULL AND status NOT IN ('DECLINED','EXPIRED','ARCHIVED') LIMIT 1`,[preview.events.map(e=>e.id),id])).rowCount;if(other)throw fail('A linked event has another active opportunity. Review its relationships before restoring it.');
 await query("UPDATE leads SET status=CASE WHEN status='LOST' THEN 'QUALIFIED' ELSE status END,availability_confirmed_at=NULL,availability_confirmed_by=NULL,availability_fingerprint=NULL,updated_at=now() WHERE id=$1",[id]);
 const restored=(await query("UPDATE events SET status='TENTATIVE',sales_closed_at=NULL,updated_at=now() WHERE id=ANY($1::uuid[]) AND status='CANCELLED' AND sales_closed_at IS NOT NULL RETURNING id",[preview.events.map(e=>e.id)])).rows;
 await query('UPDATE bookings SET sales_closed_at=NULL,updated_at=now() WHERE event_id=ANY($1::uuid[])',[restored.map(e=>e.id)]);
 const accepted=preview.proposals.find(p=>['ACCEPTED','CONVERTED'].includes(p.status));
 const draft=input.createDraft&&!accepted&&preview.proposals.length?await replacementDraft(preview.proposals[0].id,req.user):null;
 await writeAudit({req,action:'opportunity_reopened',entity:'lead',entityId:id,before:preview,after:{reason:input.reason,events:restored,draft}});
 return {reopened:true,draft,acceptedProposalId:accepted?.id||null,message:'Opportunity restored. Previous proposals, messages and assignments remain historical. Review the draft before sending.'};
 });}
export async function bookingHandoffPreview(id){
 const proposal=(await query('SELECT id,proposal_number,status,event_id,lead_id,accepted_version_id,updated_at FROM proposals WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];if(!proposal)throw fail('Proposal not found.','NOT_FOUND');
 const event=proposal.event_id?(await query('SELECT id,status,sales_closed_at,deleted_at FROM events WHERE id=$1',[proposal.event_id])).rows[0]:null;
 const invoices=(await query('SELECT id,invoice_number,status,amount_paid,pricing_snapshot FROM invoices WHERE proposal_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC',[id])).rows;
 const jobs=(await query('SELECT id,job_type,status,payload,last_error,updated_at FROM automation_jobs WHERE related_entity_id=$1 AND job_type=ANY($2::text[]) ORDER BY created_at DESC',[id,[INVOICE_HANDOFF_JOB,AGREEMENT_HANDOFF_JOB]])).rows;
 const messages=(await query('SELECT id,status,failure_code,provider_message_id,idempotency_key FROM communications WHERE proposal_id=$1 AND trigger_key=ANY($2::text[]) AND deleted_at IS NULL ORDER BY created_at DESC',[id,[INVOICE_HANDOFF_JOB,AGREEMENT_HANDOFF_JOB]])).rows;
 const agreementDeliveries=(await query('SELECT d.id,d.status,d.failure_code,d.provider_message_id FROM contract_deliveries d JOIN contracts c ON c.id=d.contract_id WHERE c.proposal_id=$1 ORDER BY d.id',[id])).rows;
 return {proposal,event,invoices,jobs,messages,agreementDeliveries,enabled:invoiceHandoffEnabled(),agreementEnabled:agreementHandoffEnabled(),fingerprint:digest([proposal,event,invoices,jobs,messages,agreementDeliveries])};
}
export async function repairBookingHandoff(id,raw,req){return transaction(async client=>{
 const input=z.object({fingerprint:z.string().length(64),reason:z.string().trim().min(10).max(2000)}).strict().parse(raw);
 await query('SELECT id FROM proposals WHERE id=$1 FOR UPDATE',[id]);const state=await bookingHandoffPreview(id);
 if(state.fingerprint!==input.fingerprint)throw fail('The booking handoff changed. Refresh and review again.');
 const p=state.proposal;if(!['ACCEPTED','CONVERTED'].includes(p.status)||!p.accepted_version_id)throw fail('A saved accepted proposal revision is required.');
 if(p.event_id&&(!state.event||state.event.deleted_at||state.event.status==='CANCELLED'||state.event.sales_closed_at))throw fail('Restore and review the opportunity before repairing its booking setup.','OPPORTUNITY_REOPEN_REQUIRED');
 if(!state.enabled)throw fail('Invoice handoff automation is disabled for this environment. Enable it through the approved environment configuration.','HANDOFF_DISABLED');
 if(state.agreementDeliveries.some(d=>d.status==='PROCESSING'||d.status==='UNKNOWN'||d.failure_code==='DELIVERY_OUTCOME_UNKNOWN')||state.jobs.some(j=>j.status==='PROCESSING')||state.messages.some(m=>m.status==='PROCESSING'||m.failure_code==='DELIVERY_OUTCOME_UNKNOWN'))throw fail('Delivery may already be in progress or uncertain. Review provider history before retrying.','DELIVERY_REVIEW_REQUIRED');
 if((await query("SELECT 1 FROM contracts WHERE proposal_id=$1 AND status='REVOKED' LIMIT 1",[id])).rowCount)throw fail('A revoked agreement requires explicit document review before replacement.','AGREEMENT_REVIEW_REQUIRED');
 const invoice=state.invoices.find(i=>!['VOID','REFUNDED'].includes(i.status));
 if(invoice&&invoice.pricing_snapshot?.accepted_version_id!==p.accepted_version_id)throw fail('The existing invoice does not match the accepted revision. Review it before repairing.','ACCEPTED_INVOICE_MISMATCH');
 const key=`booking-invoice:${id}:${p.accepted_version_id}`;
 const delivered=state.messages.some(m=>m.idempotency_key===key&&['SENT','SENT_TO_PROVIDER','DELIVERED'].includes(m.status));
 const jobTypes=delivered&&invoice?[AGREEMENT_HANDOFF_JOB]:[INVOICE_HANDOFF_JOB];
 if(delivered&&invoice){await query("UPDATE invoices SET status=CASE WHEN status='DRAFT' THEN 'SENT' ELSE status END,sent_at=COALESCE(sent_at,now()) WHERE id=$1",[invoice.id]);await queuePaidAgreement(client,(await query('SELECT * FROM invoices WHERE id=$1',[invoice.id])).rows[0]);}
 for(const type of jobTypes){
  if(type===AGREEMENT_HANDOFF_JOB&&!state.agreementEnabled)continue;
  const job=state.jobs.find(j=>j.job_type===type&&j.payload?.acceptedVersionId===p.accepted_version_id);
  if(job&&(['FAILED','CANCELLED'].includes(job.status)||(job.status==='COMPLETED'&&type===INVOICE_HANDOFF_JOB&&!delivered)))await query("UPDATE automation_jobs SET status='PENDING',attempt_count=0,started_at=NULL,completed_at=NULL,scheduled_for=now(),last_error=NULL,updated_at=now() WHERE id=$1",[job.id]);
  else if(!job&&type===INVOICE_HANDOFF_JOB)await query("INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_for) VALUES($1,'proposal',$2,$3,now())",[type,id,{acceptedVersionId:p.accepted_version_id}]);
 }
 // Only proven unsent cancelled messages release their key; history is never erased.
 await query("UPDATE communications SET idempotency_key=NULL WHERE proposal_id=$1 AND idempotency_key=$2 AND status='CANCELLED' AND provider_message_id IS NULL AND failure_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'",[id,key]);
 await writeAudit({req,action:'booking_handoff_repaired',entity:'proposal',entityId:id,before:state,after:{reason:input.reason,invoiceResend:!delivered,jobTypes}});
 return {queued:true,invoiceResend:!delivered,state:await bookingHandoffPreview(id)};
 });}
