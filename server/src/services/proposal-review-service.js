import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {buildProposalSnapshot,createProposalVersion,publicProposalUrl} from './proposal-service.js';
import {proposalEditInput} from './proposal-edit-input.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {sendEmail} from './email-service.js';
import {brandedEmailHtml} from './automation-service.js';
import {writeAudit} from './audit-service.js';
import {recordActivity} from './activity-service.js';
import {stagingEmailPolicy} from '../config/staging-safety.js';

const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const jsonFields=new Set(['content','pricing_snapshot','line_items_snapshot','editable_sections','selected_experiences','proposal_visuals','visual_sections']);
const publishFields=['package_id','experience_id','notes','total','valid_through','content','pricing_snapshot','line_items_snapshot','document_template_key','editable_sections','proposal_title','proposal_date','proposal_type','selected_experiences','proposal_visuals','visual_sections'];
const failure=(message,code='PROPOSAL_STATE_CHANGED')=>new AppError(message,409,code);
async function assertEditable(proposal,client){
 if(!proposal||!['DRAFT','READY','SENT','VIEWED','EXPIRED'].includes(proposal.status))throw failure('Accepted, rejected or invoiced proposals cannot be changed here. Use a controlled amendment.','PROPOSAL_NOT_EDITABLE');
 if(proposal.proposal_source==='UPLOADED')throw failure('Upload a replacement proposal as a separate reviewed document.','PROPOSAL_NOT_EDITABLE');
 if((await client.query("SELECT 1 FROM invoices WHERE proposal_id=$1 AND deleted_at IS NULL AND status<>'VOID' UNION ALL SELECT 1 FROM contracts WHERE proposal_id=$1 AND status='SIGNED' LIMIT 1",[proposal.id])).rowCount)throw failure('This proposal has a linked invoice or signed agreement. Use a controlled amendment.','PROPOSAL_NOT_EDITABLE');
 if((await client.query("SELECT 1 FROM proposal_send_batches WHERE proposal_id=$1 AND status IN ('PROCESSING','UNKNOWN') LIMIT 1",[proposal.id])).rowCount)throw failure('An email delivery is processing or uncertain. Resolve its delivery status before editing or sending again.','PROPOSAL_DELIVERY_UNCERTAIN');
}
export async function saveSentProposalRevision(req,before){
 return transaction(async client=>{
  const current=(await client.query('SELECT * FROM proposals WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[before.id])).rows[0];await assertEditable(current,client);
  if(!['SENT','VIEWED','EXPIRED'].includes(current.status))throw failure('The proposal changed. Reload before editing.');
  const pending=current.draft_version_id?(await client.query('SELECT snapshot FROM proposal_versions WHERE id=$1 AND proposal_id=$2',[current.draft_version_id,current.id])).rows[0]?.snapshot:null;
  const merged={...proposalEditInput({...before,...(pending||{})}),...req.body};
  for(const field of ['lead_id','client_id','event_id'])if((merged[field]||null)!==(current[field]||null))throw failure('Keep the same client, lead and event when revising a sent proposal.');
  const snapshot=await buildProposalSnapshot(merged);
  const candidate={...current,package_id:merged.package_id||null,experience_id:merged.experience_id||null,notes:merged.notes||null,total:snapshot.pricing.total,valid_through:snapshot.validThrough,content:snapshot.content,pricing_snapshot:snapshot.pricing,line_items_snapshot:snapshot.lineItems,document_template_key:snapshot.documentTemplateKey,editable_sections:snapshot.editableSections,proposal_title:snapshot.proposalTitle,proposal_date:snapshot.proposalDate,proposal_type:snapshot.proposalType,selected_experiences:snapshot.selectedExperiences,proposal_visuals:snapshot.proposalVisuals,visual_sections:snapshot.visualSections};
  const version=await createProposalVersion(client,candidate,req.user.id);
  await client.query('UPDATE proposals SET draft_version_id=$2,updated_at=now() WHERE id=$1',[current.id,version.id]);
  await writeAudit({req,action:'proposal_revision_saved',entity:'proposal',entityId:current.id,after:{version_id:version.id,published_unchanged:true}});
  return {...candidate,draft_version_id:version.id};
 });
}
export function proposalReviewEmail(proposal,{copy=false,url='[Secure proposal link included when sent]'}={}){
 const updated=Boolean(proposal.sent_at);
 const subject=updated?'There is an update to your Proposal from The Lola Booth.':'Your Proposal from The Lola Booth';
 const body=`Hi ${proposal.client_name||'there'},\n\n${updated?'There is an update to your Proposal from The Lola Booth. Please review the latest event details, services and pricing.':'Your proposal from The Lola Booth is ready. Please review your event details, services and pricing.'}\n\n${copy?'This is an information-only copy. The primary client receives the link to accept or decline.':'You can review and accept your proposal using the secure link below.'}\n\n${url}\n\nQuestions or changes? Reply to this email.\n\nThe Lola Booth\nGood people. Better photos.`;
 return {subject,body,html:brandedEmailHtml(body,{firstName:proposal.client_name,kicker:updated?'Your proposal has been updated':'Your proposal is ready',ctaLabel:copy?'View proposal copy':'Review Your Proposal',ctaUrl:url})};
}
export async function latestProposalDelivery(proposalId){
 const batch=(await query('SELECT id,version_id,request_id,status FROM proposal_send_batches WHERE proposal_id=$1 ORDER BY created_at DESC LIMIT 1',[proposalId])).rows[0];
 if(!batch)return null;
 return {...batch,recipients:(await query('SELECT email,is_primary,status,error_code FROM proposal_send_recipients WHERE batch_id=$1 ORDER BY is_primary DESC,email',[batch.id])).rows};
}
async function batchResult(batchId){
 const batch=(await query('SELECT id,version_id,request_id,status FROM proposal_send_batches WHERE id=$1',[batchId])).rows[0];
 return {...batch,recipients:(await query('SELECT email,is_primary,status,error_code FROM proposal_send_recipients WHERE batch_id=$1 ORDER BY is_primary DESC,email',[batchId])).rows};
}
export async function sendReviewedProposal(req,proposalId,{deliver=sendEmail}={}){
 const input=req.body,recipients=[...new Set(input.recipients.map(value=>value.trim().toLowerCase()))].sort();
 // Validate the complete recipient scope before any external delivery occurs.
 for(const to of recipients)stagingEmailPolicy({to,subject:'Proposal review delivery'},process.env);
 const claimed=await transaction(async client=>{
  const proposal=(await client.query('SELECT p.*,c.email AS client_email,c.name AS client_name FROM proposals p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p',[proposalId])).rows[0];
  if(!proposal)throw notFound('Proposal');
  const previous=(await client.query('SELECT * FROM proposal_send_batches WHERE proposal_id=$1 AND request_id=$2 FOR UPDATE',[proposalId,input.requestId])).rows[0];
  if(previous){
   if(previous.version_id!==input.versionId||JSON.stringify(previous.recipients)!==JSON.stringify(recipients))throw failure('This send request was used for different content or recipients. Refresh the review.','PROPOSAL_REQUEST_REUSED');
   if(['COMPLETE','PROCESSING','UNKNOWN'].includes(previous.status))return {batch:previous,replayed:true};
  }
  const retryingPublishedCopies=previous&&proposal.published_version_id===previous.version_id&&(await client.query("SELECT 1 FROM proposal_send_recipients WHERE batch_id=$1 AND is_primary AND status='ACCEPTED'",[previous.id])).rowCount>0;
  if(!retryingPublishedCopies)await assertEditable(proposal,client);
  else if((await client.query("SELECT 1 FROM proposal_send_batches WHERE proposal_id=$1 AND id<>$2 AND status IN ('PROCESSING','UNKNOWN') LIMIT 1",[proposalId,previous.id])).rowCount)throw failure('Another delivery is processing or uncertain.','PROPOSAL_DELIVERY_UNCERTAIN');
  if(!previous&&!recipients.includes(proposal.client_email.toLowerCase()))throw new AppError('Include the primary client email. Additional recipients receive information-only copies.',422,'PRIMARY_RECIPIENT_REQUIRED');
  if(proposal.lead_id&&(await client.query("SELECT 1 FROM leads WHERE id=$1 AND status IN ('LOST','ARCHIVED')",[proposal.lead_id])).rowCount)throw failure('Reopen and review the lead before sending a proposal.','LEAD_LOST');
  const version=(await client.query('SELECT * FROM proposal_versions WHERE proposal_id=$1 AND id=$2',[proposalId,input.versionId])).rows[0];
  const expected=proposal.draft_version_id||proposal.published_version_id||(await client.query('SELECT id FROM proposal_versions WHERE proposal_id=$1 ORDER BY version_number DESC LIMIT 1',[proposalId])).rows[0]?.id;
  if(!version||(!previous&&version.id!==expected)||(previous&&proposal.published_version_id!==version.id&&proposal.draft_version_id!==version.id&&expected!==version.id))throw failure('The proposal changed after review. Refresh and review the latest version.','PROPOSAL_REVIEW_STALE');
  if(version.snapshot.valid_through&&version.snapshot.valid_through<new Date().toISOString().slice(0,10))throw failure('Update the validity date before sending an expired proposal.','PROPOSAL_EXPIRED');
  const token=proposal.draft_version_id?crypto.randomBytes(24).toString('hex'):proposal.secure_token||crypto.randomBytes(24).toString('hex');
  if(!previous&&!publicProposalUrl({...proposal,secure_token:token}))throw failure("Generate fresh secure proposal access before sending.","DOCUMENT_ACCESS_UNAVAILABLE");
  let batch=previous;
  if(!batch){
   const frozen={...proposal,...version.snapshot,client_email:proposal.client_email,client_name:proposal.client_name,secure_token:token};
   batch=(await client.query('INSERT INTO proposal_send_batches(proposal_id,version_id,request_id,snapshot,primary_token,recipients,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[proposalId,version.id,input.requestId,JSON.stringify(frozen),encryptSecretJson({token}),JSON.stringify(recipients),req.user.id])).rows[0];
   for(const email of recipients){const primary=email===proposal.client_email.toLowerCase(),recipientToken=primary?token:crypto.randomBytes(24).toString('hex');await client.query('INSERT INTO proposal_send_recipients(batch_id,email,is_primary,token_hash,token_ciphertext) VALUES($1,$2,$3,$4,$5)',[batch.id,email,primary,primary?null:hash(recipientToken),encryptSecretJson({token:recipientToken})]);}
  }
  await client.query("UPDATE proposal_send_batches SET status='PROCESSING',updated_at=now() WHERE id=$1",[batch.id]);
  return {batch,replayed:false};
 });
 if(claimed.replayed)return batchResult(claimed.batch.id);
 const batch=claimed.batch;
 try{
  const rows=(await query('SELECT * FROM proposal_send_recipients WHERE batch_id=$1 ORDER BY is_primary DESC,email',[batch.id])).rows;
  for(const row of rows){
   if(row.status==='ACCEPTED')continue;
   const locked=await query("UPDATE proposal_send_recipients SET status='PROCESSING',error_code=NULL,updated_at=now() WHERE id=$1 AND status IN ('PENDING','FAILED') RETURNING id",[row.id]);
   if(!locked.rowCount)throw failure('Delivery status is uncertain. Do not resend without operator review.','PROPOSAL_DELIVERY_UNCERTAIN');
   const token=decryptSecretJson(row.token_ciphertext).token;
   const message=proposalReviewEmail(batch.snapshot,{copy:!row.is_primary,url:publicProposalUrl({...batch.snapshot,secure_token:token})});
   let email;
   try{email=await deliver({to:row.email,...message,attachments:[]});}
   catch(error){
    const knownRejection=error.details?.outcomeUnknown===false||error.details?.status&&error.details.status<500&&error.details.status!==408||error.code?.startsWith('STAGING_')||error.code==='EMAIL_RECIPIENT_REQUIRED';
    await query('UPDATE proposal_send_recipients SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[row.id,knownRejection?'FAILED':'UNKNOWN',error.code||'DELIVERY_UNCERTAIN']);
    if(row.is_primary||!knownRejection)break;continue;
   }
   // Provider acceptance and publication commit together. A lost acknowledgement
   // leaves a durable PROCESSING claim; subsequent clicks never resend it blindly.
   await transaction(async client=>{
    const current=(await client.query('SELECT * FROM proposals WHERE id=$1 FOR UPDATE',[proposalId])).rows[0];
    if(row.is_primary){
     if(!['DRAFT','READY','SENT','VIEWED','EXPIRED'].includes(current.status))throw failure('Proposal changed during sending. Operator review is required.');
     const candidate=batch.snapshot,values=publishFields.map(key=>jsonFields.has(key)?JSON.stringify(candidate[key]??null):candidate[key]??null);
     await client.query(`UPDATE proposals SET ${publishFields.map((key,index)=>`${key}=$${index+1}`).join(',')},status='SENT',sent_at=now(),secure_token=$${values.length+1},published_version_id=$${values.length+2},draft_version_id=NULL,proposal_snapshot=$${values.length+3},updated_at=now() WHERE id=$${values.length+4}`,[...values,decryptSecretJson(batch.primary_token).token,batch.version_id,JSON.stringify(Object.fromEntries(publishFields.map(key=>[key,candidate[key]]))),proposalId]);
    }
    await client.query("UPDATE proposal_send_recipients SET status='ACCEPTED',provider=$2,provider_message_id=$3,sent_at=now(),updated_at=now() WHERE id=$1",[row.id,email.provider,email.providerMessageId]);
    await client.query("INSERT INTO proposal_deliveries(proposal_id,recipient_email,delivery_method,status,sent_at) VALUES($1,$2,'EMAIL','SENT',now()) ON CONFLICT(proposal_id,recipient_email,delivery_method) DO UPDATE SET status='SENT',sent_at=now()",[proposalId,row.email]);
    const communication=await client.query("INSERT INTO communications(client_id,event_id,proposal_id,type,channel,direction,recipient,subject,rendered_subject,rendered_body,rendered_html,merge_data,send_mode,status,sent_at,provider,provider_message_id,created_by) VALUES($1,$2,$3,'EMAIL','EMAIL','OUTBOUND',$4,$5,$5,$6,$7,$8,'SEND_NOW','SENT_TO_PROVIDER',now(),$9,$10,$11) RETURNING id",[current.client_id,current.event_id,proposalId,row.email,message.subject,message.body,message.html,{proposalVersionId:batch.version_id,copyOnly:!row.is_primary},email.provider,email.providerMessageId,req.user.id]);
    await client.query("INSERT INTO email_messages(communication_id,provider,provider_message_id,to_email,subject,status,body_preview,sent_at) VALUES($1,$2,$3,$4,$5,'SENT_TO_PROVIDER',$6,now())",[communication.rows[0].id,email.provider,email.providerMessageId,row.email,message.subject,message.body.slice(0,500)]);
    if(row.is_primary&&current.lead_id)await client.query("UPDATE leads SET status='PROPOSAL_SENT',updated_at=now() WHERE id=$1 AND status IN ('NEW','CONTACTED','QUALIFIED','PROPOSAL_DRAFT','FOLLOW_UP')",[current.lead_id]);
   });
  }
 }catch(error){
  await query("UPDATE proposal_send_batches SET status='UNKNOWN',updated_at=now() WHERE id=$1",[batch.id]);throw error;
 }
 const result=await batchResult(batch.id),statuses=result.recipients.map(row=>row.status);
 const status=statuses.some(value=>['UNKNOWN','PROCESSING'].includes(value))?'UNKNOWN':statuses.every(value=>value==='ACCEPTED')?'COMPLETE':statuses.includes('ACCEPTED')?'PARTIAL':'FAILED';
 await query('UPDATE proposal_send_batches SET status=$2,updated_at=now() WHERE id=$1',[batch.id,status]);
 await writeAudit({req,action:'proposal_review_delivery',entity:'proposal',entityId:proposalId,after:{batch_id:batch.id,version_id:batch.version_id,status}});
 await recordActivity({actorUserId:req.user.id,entityType:'proposal',entityId:proposalId,action:'proposal_review_delivery',summary:`Proposal delivery ${status.toLowerCase()}`});
 return {...result,status};
}
