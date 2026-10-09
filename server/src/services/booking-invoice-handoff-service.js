import {WORKSPACE_HANDOFF_JOB,workspaceHandoffEnabled,deliverSignedWorkspace,deliverClientInvitation} from './client-session-service.js';
import {AGREEMENT_HANDOFF_JOB,agreementHandoffEnabled,deliverPaidAgreement} from './booking-agreement-handoff-service.js';
import { query, transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { stagingJobsPaused, stagingAutomationScope } from '../config/staging-safety.js';
import { createInvoice, getInvoice, publicInvoiceUrl } from './invoice-service.js';
import { createCommunicationDraft, sendCommunication, brandedEmailHtml } from './automation-service.js';
import { invoiceHandoffEnabled, INVOICE_HANDOFF_JOB } from './proposal-acceptance-service.js';

async function prepareInvoiceMessage(job) {
  return transaction(async client => {
    const proposal = (await client.query('SELECT * FROM proposals WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [job.related_entity_id])).rows[0];
    if (!proposal || !['ACCEPTED', 'CONVERTED'].includes(proposal.status) || proposal.accepted_version_id !== job.payload.acceptedVersionId) return null;
    if (proposal.event_id) {
      const event = (await client.query('SELECT status,deleted_at FROM events WHERE id=$1 FOR SHARE', [proposal.event_id])).rows[0];
      if (!event || event.deleted_at || event.status === 'CANCELLED') return null;
    }
    const invoiceRow = await createInvoice({ body: { proposal_id: proposal.id, depositOnly: true }, user: {}, headers: {} });
    const invoice = await getInvoice(invoiceRow.id);
    if (['PAID', 'VOID', 'REFUNDED'].includes(invoice.status) || Number(invoice.amount_paid) >= Number(invoice.pricing_snapshot?.amount_due_now)) return null;
    if (!invoice.client_email) throw new AppError('Add the booking contact email before sending the invoice.', 422, 'BOOKING_CONTACT_EMAIL_REQUIRED', {retryable:false});
    if (!(Number(invoice.pricing_snapshot?.amount_due_now) > 0)) throw new AppError('Review the booking retainer fee amount before sending the invoice.', 422, 'BOOKING_RETAINER_REQUIRED', {retryable:false});
    const key = `booking-invoice:${proposal.id}:${job.payload.acceptedVersionId}`;
    let communication = (await client.query('SELECT * FROM communications WHERE idempotency_key=$1', [key])).rows[0];
    if (!communication) {
      const url = publicInvoiceUrl(invoice);
      const body = `Hi ${invoice.client_name || 'there'},\n\nThank you for accepting your LOLA proposal.\n\nYour invoice total is $${Number(invoice.total).toFixed(2)}. Your booking retainer fee payment requested now is $${Number(invoice.pricing_snapshot.amount_due_now).toFixed(2)} and is credited toward your total.\n\nView your invoice and payment options:\n${url}\n\nPayment alone does not confirm your booking. We will send your agreement after the required minimum payment is verified.\n\nThe LOLA Booth`;
      communication = await createCommunicationDraft({ client_id: invoice.client_id, event_id: invoice.event_id, proposal_id: proposal.id,
        invoice_id: invoice.id, recipient: invoice.client_email, subject: `Your LOLA invoice ${invoice.invoice_number}`,
        body, html: brandedEmailHtml(body, {kicker:'Your booking invoice', ctaLabel:'View invoice and pay', ctaUrl:url}), trigger_key:INVOICE_HANDOFF_JOB });
      await client.query('UPDATE communications SET idempotency_key=$2 WHERE id=$1', [communication.id, key]);
    }
    return { communication, invoiceId: invoice.id };
  });
}

/** Uses the existing job/communication ledger. Unknown provider outcomes require review. */
export async function processBookingInvoiceHandoffs({limit=10}={}) {
  const types=[...(invoiceHandoffEnabled()?[INVOICE_HANDOFF_JOB]:[]),...(agreementHandoffEnabled()?[AGREEMENT_HANDOFF_JOB]:[]),...(workspaceHandoffEnabled()?[WORKSPACE_HANDOFF_JOB,'CLIENT_WORKSPACE_SIGN_IN']:[])];
  if (!types.length || stagingJobsPaused()) return {processed:[]};
  const scope=stagingAutomationScope();
  const jobs = await transaction(async client => {
    await client.query(`UPDATE automation_jobs SET status='FAILED',last_error='Worker stopped during invoice handoff. Review invoice and provider history before retrying.',updated_at=now()
      WHERE job_type=ANY($1::text[]) AND status='PROCESSING' AND started_at<now()-interval '10 minutes'
       AND ($2::timestamptz IS NULL OR (created_at>=$2 AND EXISTS(SELECT 1 FROM proposals p JOIN clients c ON c.id=p.client_id WHERE p.id=related_entity_id AND lower(c.email)=ANY($3::text[]))))`, [types,scope?.since||null,scope?.recipients||[]]);
    const rows = (await client.query(`SELECT * FROM automation_jobs WHERE job_type=ANY($1::text[]) AND status='PENDING' AND scheduled_for<=now()
      AND ($3::timestamptz IS NULL OR (created_at>=$3 AND EXISTS(SELECT 1 FROM proposals p JOIN clients c ON c.id=p.client_id
        WHERE p.id=related_entity_id AND lower(c.email)=ANY($4::text[]))))
      ORDER BY scheduled_for LIMIT $2 FOR UPDATE SKIP LOCKED`, [types, limit,scope?.since||null,scope?.recipients||[]])).rows;
    for (const job of rows) await client.query("UPDATE automation_jobs SET status='PROCESSING',started_at=now(),attempt_count=attempt_count+1,updated_at=now() WHERE id=$1", [job.id]);
    return rows;
  });
  const processed=[];
  for (const job of jobs) {
    try {
      if([AGREEMENT_HANDOFF_JOB,WORKSPACE_HANDOFF_JOB,'CLIENT_WORKSPACE_SIGN_IN'].includes(job.job_type)){
        const result=job.job_type===AGREEMENT_HANDOFF_JOB?await deliverPaidAgreement(job):job.job_type===WORKSPACE_HANDOFF_JOB?await deliverSignedWorkspace(job):await deliverClientInvitation(job.payload.invitationId);
        const status=result.cancelled?'CANCELLED':'COMPLETED';
        await query("UPDATE automation_jobs SET status=$2,completed_at=now(),last_error=NULL,updated_at=now() WHERE id=$1",[job.id,status]);
        processed.push({id:job.id,status});continue;
      }
      const prepared = await prepareInvoiceMessage(job);
      if (!prepared) {
        await query("UPDATE automation_jobs SET status='CANCELLED',completed_at=now(),last_error='Current booking state no longer needs this invoice handoff',updated_at=now() WHERE id=$1", [job.id]);
        processed.push({id:job.id,status:'CANCELLED'}); continue;
      }
      // Dispatch after invoice/message persistence commits; communication claims prevent duplicate delivery.
      const sent = await sendCommunication(prepared.communication.id);
      if (sent.communication.status === 'CANCELLED') {
        await query("UPDATE automation_jobs SET status='CANCELLED',completed_at=now(),last_error='Invoice handoff became ineligible before dispatch',updated_at=now() WHERE id=$1", [job.id]);
        processed.push({id:job.id,status:'CANCELLED'}); continue;
      }
      if (!['SENT','SENT_TO_PROVIDER','DELIVERED'].includes(sent.communication.status)) throw new AppError('Invoice delivery was not confirmed. Review its communication.', 409, 'INVOICE_DELIVERY_NOT_CONFIRMED', {retryable:false});
      await transaction(async client => {
        await client.query("UPDATE invoices SET status=CASE WHEN status='DRAFT' THEN 'SENT' ELSE status END,sent_at=COALESCE(sent_at,now()),updated_at=now() WHERE id=$1", [prepared.invoiceId]);
        await client.query("UPDATE automation_jobs SET status='COMPLETED',completed_at=now(),last_error=NULL,updated_at=now() WHERE id=$1", [job.id]);
      });
      processed.push({id:job.id,status:'COMPLETED'});
    } catch (error) {
      const retry = error.details?.retryable !== false && job.attempt_count+1 < job.max_attempts;
      const status = retry ? 'PENDING' : 'FAILED';
      await query("UPDATE automation_jobs SET status=$2,scheduled_for=now()+interval '2 minutes',last_error=$3,updated_at=now() WHERE id=$1", [job.id,status,error.message]);
      if(status==='FAILED')await query(`INSERT INTO tasks(lifecycle_key,title,description,event_id,client_id,priority)
        SELECT $1,'Review failed booking handoff',$2,p.event_id,p.client_id,'HIGH' FROM proposals p WHERE p.id=$3
        ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING`,['handoff-review:'+job.id,'Inspect provider delivery and communication history before retrying. '+error.code,job.related_entity_id]);
      processed.push({id:job.id,status});
    }
  }
  return {processed};
}
