import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {reconcileEventFinance,applyBookingConfirmationPolicy} from './payment-reconciliation-service.js';

// Explicit, audited repair of a legacy journey, never a name/email-based match.
export async function linkEventBooking(eventId,proposalId,req){
 if(!req.user?.roles?.some(role=>['OWNER','ADMIN','SUPER_ADMIN'].includes(role)))throw new AppError('An Admin must review booking links.',403,'FORBIDDEN');
 const result=await transaction(async()=>{
  const event=(await query('SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[eventId])).rows[0];
  const proposal=(await query('SELECT * FROM proposals WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[proposalId])).rows[0];
  if(!event||!proposal)throw new AppError('Event or proposal not found.',404,'NOT_FOUND');
  const conflict=message=>{throw new AppError(message,409,'BOOKING_LINK_REVIEW');};
  if(event.status==='CANCELLED'||!event.client_id||proposal.client_id!==event.client_id)conflict('The proposal must belong to this event’s client.');
  if(proposal.event_id&&proposal.event_id!==eventId)conflict('This proposal is already linked to another event.');
  if(!['ACCEPTED','CONVERTED'].includes(proposal.status)||!proposal.accepted_version_id)conflict('Review an accepted commercial proposal first.');
  const related=(await query(`SELECT 1 FROM leads WHERE id=$1 AND converted_event_id=$2
    UNION ALL SELECT 1 FROM invoices WHERE proposal_id=$3 AND event_id=$2 AND deleted_at IS NULL`,[proposal.lead_id,eventId,proposalId])).rowCount;
  if(proposal.event_id!==eventId&&!related)conflict('No existing lead conversion or invoice establishes this event relationship. Review it before linking.');
  const invoices=(await query("SELECT * FROM invoices WHERE proposal_id=$1 AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID','REFUNDED') ORDER BY id FOR UPDATE",[proposalId])).rows;
  if(!invoices.length)conflict('Issue the accepted booking invoice before linking.');
  for(const invoice of invoices){
   if(invoice.client_id!==event.client_id||(invoice.event_id&&invoice.event_id!==eventId))conflict('An invoice belongs to another client or event.');
   if(invoice.pricing_snapshot?.accepted_version_id!==proposal.accepted_version_id)conflict('The invoice must reference the current accepted proposal version.');
  }
  const invoiceIds=invoices.map(i=>i.id);
  const conflictingPayments=await query('SELECT 1 FROM payments WHERE invoice_id=ANY($1::uuid[]) AND ((event_id IS NOT NULL AND event_id<>$2) OR (client_id IS NOT NULL AND client_id<>$3)) LIMIT 1',[invoiceIds,eventId,event.client_id]);
  if(conflictingPayments.rowCount)conflict('A payment is linked to a different client or event.');
  await query('UPDATE proposals SET event_id=$2,updated_at=now() WHERE id=$1 AND event_id IS NULL',[proposalId,eventId]);
  await query('UPDATE invoices SET event_id=$2,updated_at=now() WHERE id=ANY($1::uuid[]) AND event_id IS NULL',[invoiceIds,eventId]);
  await query('UPDATE payments SET event_id=$2,updated_at=now() WHERE invoice_id=ANY($1::uuid[]) AND event_id IS NULL',[invoiceIds,eventId]);
  await reconcileEventFinance({query},eventId);
  const after={proposalId,invoiceIds,eventId};
  await writeAudit({req,action:'event_booking_links_reviewed',entity:'event',entityId:eventId,before:{proposalEventId:proposal.event_id,invoices:invoices.map(i=>({id:i.id,eventId:i.event_id}))},after});
  return after;
 });
 // Re-check the normal prerequisites; linking never invents acceptance, signatures or payments.
 try{const event=await applyBookingConfirmationPolicy(eventId,{signedAgreement:true});return {...result,status:event?.status||'PENDING'};}
 catch(error){if(error.statusCode>=500||!['BOOKING_PREREQUISITES','RESERVATION_CONFLICT','CAPACITY_CONFLICT'].includes(error.code))throw error;return {...result,status:'REVIEW_REQUIRED',message:error.message};}
}
