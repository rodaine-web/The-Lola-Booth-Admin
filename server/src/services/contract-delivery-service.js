import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {sendEmail} from './email-service.js';
import {brandedEmailHtml} from './automation-service.js';
import {stagingEmailPolicy} from '../config/staging-safety.js';
import {getContract,contractSigningUrl} from './contract-service.js';
import {writeAudit} from './audit-service.js';
import {contractDeliveryDecision,contractDeliveryFailure} from '../../../shared/contract-delivery.js';

export function contractEmailMessage(contract, signingUrl) {
 const signed=contract.status==='SIGNED';
 const subject=`${signed?'Your signed agreement':'Your agreement is ready'} — ${contract.snapshot.event_name||contract.snapshot.proposal_number}`;
 const body=`Hi ${contract.snapshot.client_name||'there'},\n\n${signed?'Thank you for signing your event service agreement. You can review it and download your signed copy below.':'Your event service agreement is ready. Please review the terms and sign online.'}\n\n${signingUrl}\n\nBooking confirmation follows your proposal’s deposit requirements. Signing does not process a payment.\n\nThe Lola Booth`;
 return {to:contract.snapshot.client_email,subject,body,html:brandedEmailHtml(body,{firstName:contract.snapshot.client_name||'there',kicker:signed?'Your signed agreement':'Your agreement is ready',ctaLabel:signed?'View Signed Agreement':'Review & Sign Agreement',ctaUrl:signingUrl,secondaryCta:{label:'Download PDF',url:`${signingUrl}?download=pdf`,copyLabel:'Download your agreement PDF:'}}),attachments:[]};
}
export async function sendContract(id,req,{send=sendEmail,policy=stagingEmailPolicy}={}) {
 const contract=await getContract(id);
 const signingUrl=await contractSigningUrl(id);
 const purpose=contract.status==='SIGNED'?'SIGNED_COPY':'INVITATION';
 const message=contractEmailMessage(contract,signingUrl);
 // Check recipient policy before reserving a delivery. A blocked QA recipient
 // must not consume an attempt or leave a stuck delivery.
 policy(message);
 const claim=await transaction(async()=>{
  const current=(await query('SELECT status,expires_at FROM contracts WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(current.status!==contract.status) throw new AppError('Agreement changed. Reload before sending.',409,'CONTRACT_CHANGED');
  if(current.status==='ISSUED'&&new Date(current.expires_at)<=new Date()) throw new AppError('Agreement link expired.',410,'CONTRACT_EXPIRED');
  const old=(await query('SELECT * FROM contract_deliveries WHERE contract_id=$1 AND purpose=$2 FOR UPDATE',[id,purpose])).rows[0];
  const decision=contractDeliveryDecision(old);
  if(decision==='COMPLETE')return {...old,replayed:true};
  if(decision!=='SEND')throw new AppError(decision==='EXHAUSTED'?'Email retry limit reached.':'Sending is in progress or its outcome is uncertain. Review provider history before retrying.',409,'CONTRACT_DELIVERY_REVIEW');
  const communication=(await query(`INSERT INTO communications(proposal_id,type,channel,direction,recipient,subject,rendered_subject,rendered_body,rendered_html,message_summary,status,send_mode,trigger_key,user_id,created_by,sent_by)
    VALUES($1,'EMAIL','EMAIL','OUTBOUND',$2,$3,$3,$4,$5,$6,'PROCESSING','SEND_NOW',$7,$8,$8,$8) RETURNING id`,[contract.proposal_id,message.to,message.subject,message.body,message.html,'Agreement email',`CONTRACT_${purpose}`,req.user.id])).rows[0];
  const delivery=(await query(`INSERT INTO contract_deliveries(contract_id,purpose,recipient,status,communication_id)
    VALUES($1,$2,$3,'PROCESSING',$4) ON CONFLICT(contract_id,purpose) DO UPDATE SET status='PROCESSING',
    attempt_count=CASE WHEN contract_deliveries.status='DEVELOPMENT_ONLY' THEN 1 ELSE contract_deliveries.attempt_count+1 END,
    communication_id=EXCLUDED.communication_id,failure_code=NULL,started_at=now(),completed_at=NULL RETURNING *`,[id,purpose,message.to,communication.id])).rows[0];
  return delivery;
 });
 if(claim.replayed)return {status:claim.status,replayed:true};
 // Hold the agreement lock through dispatch: revocation cannot race a send.
 // The durable claim above survives a provider timeout or process interruption.
 return transaction(async()=>{
  const current=(await query('SELECT status,expires_at FROM contracts WHERE id=$1 FOR UPDATE',[id])).rows[0];
  let outcome;
  try {
   if(current.status!==contract.status||(current.status==='ISSUED'&&new Date(current.expires_at)<=new Date()))throw new AppError('Agreement is no longer available for sending.',409,'CONTRACT_CHANGED');
   policy(message);
   const result=await send(message);
   if(result?.status!=='SENT'||!result.provider)throw new AppError('Email provider acceptance was not confirmed.',502,'EMAIL_PROVIDER_RESPONSE_INVALID');
   outcome={status:result.deliveredExternally===false?'DEVELOPMENT_ONLY':'SENT_TO_PROVIDER',provider:result.provider,providerMessageId:result.providerMessageId};
  }catch(error){outcome=contractDeliveryFailure(error);}
  await query(`UPDATE contract_deliveries SET status=$2,provider=$3,provider_message_id=$4,failure_code=$5,completed_at=now() WHERE id=$1`,[claim.id,outcome.status,outcome.provider||null,outcome.providerMessageId||null,outcome.code||null]);
  const commStatus=outcome.status==='SENT_TO_PROVIDER'?'SENT_TO_PROVIDER':outcome.status==='DEVELOPMENT_ONLY'?'DRAFT':'FAILED';
  await query(`UPDATE communications SET status=$2,provider=$3,provider_message_id=$4,failure_code=$5,
    failure_message=$6,sent_at=CASE WHEN $2='SENT_TO_PROVIDER' THEN now() ELSE NULL END WHERE id=$1`,
    [claim.communication_id,commStatus,outcome.provider||null,outcome.providerMessageId||null,outcome.status==='UNKNOWN'?'DELIVERY_OUTCOME_UNKNOWN':outcome.code||null,outcome.status==='UNKNOWN'?'Review provider history before retrying.':outcome.status==='DEVELOPMENT_ONLY'?'Development preview; no external email sent.':outcome.code||null]);
  await writeAudit({req,action:'contract_email_attempt',entity:'contract',entityId:id,after:{purpose,status:outcome.status,attempt:claim.attempt_count}});
  return outcome;
 });
}
