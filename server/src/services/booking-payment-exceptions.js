import {BOOKING_AGREEMENT_TERMS} from '../../../shared/booking-agreement-terms.js';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
export async function approveBookingPaymentException(eventId,input,req){
 if(!req.user?.roles?.includes('ADMIN'))throw new AppError('An Admin must approve payment exceptions.',403,'FORBIDDEN');
 return transaction(async()=>{
  const event=(await query('SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[eventId])).rows[0];
  if(!event||event.status==='CANCELLED')throw new AppError('Event unavailable.',404,'NOT_FOUND');
  const invoice=(await query("SELECT total FROM invoices WHERE event_id=$1 AND proposal_id IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID','REFUNDED') ORDER BY created_at DESC LIMIT 1",[eventId])).rows[0];
  if(!invoice||Number(input.minimum_before_confirmation)>Number(invoice.total)||Number(input.minimum_before_agreement)>Number(input.minimum_before_confirmation))throw new AppError('Exception payments must be within the accepted invoice total and ordered correctly.',422,'PAYMENT_EXCEPTION_INVALID');
  if(input.balance_due_date>String(event.event_date))throw new AppError('Balance must be due by the event date.',422,'PAYMENT_EXCEPTION_INVALID');
  if((await query("SELECT 1 FROM contracts k JOIN proposals p ON p.id=k.proposal_id WHERE p.event_id=$1 AND k.status='SIGNED'",[eventId])).rowCount)throw new AppError('A signed booking needs a documented amendment before its payment requirements change.',409,'SIGNED_PAYMENT_AMENDMENT_REQUIRED');
  const before=(await query('SELECT * FROM booking_payment_exceptions WHERE event_id=$1 AND revoked_at IS NULL FOR UPDATE',[eventId])).rows[0];
  if(before)await query('UPDATE booking_payment_exceptions SET revoked_at=now() WHERE id=$1',[before.id]);
  const row=(await query(`INSERT INTO booking_payment_exceptions(event_id,minimum_before_agreement,minimum_before_confirmation,balance_due_date,reason,approved_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[eventId,input.minimum_before_agreement,input.minimum_before_confirmation,input.balance_due_date,input.reason,req.user.id])).rows[0];
  await query("UPDATE invoices SET due_date=$2,updated_at=now() WHERE event_id=$1 AND proposal_id IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID','PAID','REFUNDED')",[eventId,input.balance_due_date]);
  await writeAudit({req,action:'booking_payment_exception_approved',entity:'event',entityId:eventId,before:before||{policy:'30% agreement minimum; full payment within 14 days'},after:row});
  return row;
 });
}
export async function agreementPaymentQualified(invoice){
 if(!invoice||['DRAFT','VOID','REFUNDED'].includes(invoice.status)||!(Number(invoice.total)>0))return false;
 const exception=invoice.event_id?(await query('SELECT minimum_before_agreement FROM booking_payment_exceptions WHERE event_id=$1 AND revoked_at IS NULL',[invoice.event_id])).rows[0]:null;
 const required=exception?Math.round(Number(exception.minimum_before_agreement)*100):Math.ceil(Math.round(Number(invoice.total)*100)*.3);
 return Math.round(Number(invoice.amount_paid)*100)>=required;
}

export async function bookingAgreementTerms(eventId){
 const exception=eventId?(await query('SELECT id,minimum_before_agreement,minimum_before_confirmation,balance_due_date::text AS balance_due_date,reason FROM booking_payment_exceptions WHERE event_id=$1 AND revoked_at IS NULL',[eventId])).rows[0]:null;
 if(!exception)return BOOKING_AGREEMENT_TERMS;
 return BOOKING_AGREEMENT_TERMS+`\n\nWRITTEN PAYMENT EXCEPTION\n\nLOLA-approved exception ${exception.id}. This written arrangement replaces the standard payment minimums and balance due date for this booking only. Required before agreement issuance: $${Number(exception.minimum_before_agreement).toFixed(2)}. Required before booking confirmation: $${Number(exception.minimum_before_confirmation).toFixed(2)}. Remaining balance due: ${exception.balance_due_date}.\n\nApproved arrangement: ${exception.reason}\n\nAll other terms, including the client cancellation and rebooking-credit policy, remain in effect. Client accepts this arrangement by signing this agreement.`;
}
