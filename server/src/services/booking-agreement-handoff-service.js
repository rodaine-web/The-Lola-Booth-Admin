import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {createContract,issueContract} from './contract-service.js';
import {sendContract} from './contract-delivery-service.js';
import {BOOKING_AGREEMENT_TITLE,BOOKING_AGREEMENT_TERMS,BOOKING_AGREEMENT_VERSION} from '../../../shared/booking-agreement-terms.js';
import {bookingNextAction} from '../../../shared/booking-lifecycle.js';
export const AGREEMENT_HANDOFF_JOB='BOOKING_SEND_PAID_AGREEMENT';
export const agreementHandoffEnabled=()=>process.env.BOOKING_AGREEMENT_HANDOFF_ENABLED==='true';

export async function queuePaidAgreement(client,invoice) {
  if(!agreementHandoffEnabled() || !invoice.proposal_id || ['VOID','REFUNDED'].includes(invoice.status))return;
  const proposal=(await client.query(`SELECT p.accepted_version_id FROM proposals p WHERE p.id=$1 AND p.deleted_at IS NULL
    AND p.status IN ('ACCEPTED','CONVERTED') AND EXISTS(SELECT 1 FROM automation_jobs j WHERE j.related_entity_id=p.id AND j.job_type='BOOKING_SEND_ACCEPTED_INVOICE')`,[invoice.proposal_id])).rows[0];
  if(!proposal?.accepted_version_id)return;
  if(bookingNextAction({commercialAccepted:true,total:invoice.total,netPaid:invoice.amount_paid,invoice})!=='PREPARE_SEND_AGREEMENT')return;
  const key=`paid-agreement:${invoice.proposal_id}:${proposal.accepted_version_id}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
  const existing=await client.query('SELECT 1 FROM automation_jobs WHERE job_type=$1 AND related_entity_id=$2 AND payload->>\'acceptedVersionId\'=$3 LIMIT 1',[AGREEMENT_HANDOFF_JOB,invoice.proposal_id,proposal.accepted_version_id]);
  if(existing.rowCount)return;
  await client.query(`INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_for)
    VALUES($1,'proposal',$2,$3,now())`,[AGREEMENT_HANDOFF_JOB,invoice.proposal_id,{invoiceId:invoice.id,acceptedVersionId:proposal.accepted_version_id,termsVersion:BOOKING_AGREEMENT_VERSION}]);
}

export async function deliverPaidAgreement(job,{sendEmail}={}) {
  const req={user:{},headers:{}};
  const contract=await transaction(async client=>{
    const proposal=(await client.query('SELECT * FROM proposals WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[job.related_entity_id])).rows[0];
    if(!proposal || !['ACCEPTED','CONVERTED'].includes(proposal.status) || proposal.accepted_version_id!==job.payload.acceptedVersionId)return null;
    const invoice=(await client.query('SELECT * FROM invoices WHERE id=$1 AND proposal_id=$2 AND deleted_at IS NULL FOR SHARE',[job.payload.invoiceId,proposal.id])).rows[0];
    if(!invoice || bookingNextAction({commercialAccepted:true,total:invoice.total,netPaid:invoice.amount_paid,invoice})!=='PREPARE_SEND_AGREEMENT')return null;
    if(proposal.event_id){
      const event=(await client.query('SELECT status,deleted_at FROM events WHERE id=$1',[proposal.event_id])).rows[0];
      if(!event || event.deleted_at || event.status==='CANCELLED')return null;
    }
    if(job.payload.termsVersion!==BOOKING_AGREEMENT_VERSION)throw new AppError('Agreement terms changed. Review this handoff before sending.',409,'AGREEMENT_TERMS_REVIEW',{retryable:false});
    let latest=(await client.query('SELECT * FROM contracts WHERE proposal_id=$1 ORDER BY revision DESC LIMIT 1',[proposal.id])).rows[0];
    if(latest?.status==='SIGNED')return null;
    if(latest?.status==='REVOKED')throw new AppError('The agreement was revoked. Review it before any automatic replacement.',409,'AGREEMENT_REVOKED',{retryable:false});
    if(!latest)latest=await createContract(proposal.id,{title:BOOKING_AGREEMENT_TITLE,terms:BOOKING_AGREEMENT_TERMS},req);
    if(latest.title!==BOOKING_AGREEMENT_TITLE || latest.terms!==BOOKING_AGREEMENT_TERMS)throw new AppError('An existing agreement has different terms. Review it before automatic sending.',409,'AGREEMENT_TERMS_REVIEW',{retryable:false});
    if(latest.status==='DRAFT')latest=await issueContract(latest.id,req);
    return latest;
  });
  if(!contract)return {cancelled:true};
  const result=await sendContract(contract.id,req,{send:sendEmail,paymentRequirement:{invoiceId:job.payload.invoiceId,proposalId:job.related_entity_id,acceptedVersionId:job.payload.acceptedVersionId}});
  if(result.status==='CANCELLED')return {cancelled:true};
  if(!['SENT_TO_PROVIDER','SENT','DELIVERED'].includes(result.status))throw new AppError('Agreement delivery was not confirmed. Review the saved communication.',409,'AGREEMENT_DELIVERY_NOT_CONFIRMED',{retryable:result.status==='FAILED'});
  return result;
}
