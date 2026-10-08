import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {recordActivity} from './activity-service.js';
import {writeAudit} from './audit-service.js';
import {userCanAccessEvent} from './event-operations-service.js';
import {hashContractValue} from './contract-service.js';
import {secureDocumentUrl} from '../../../shared/document-access.js';
import {documentOrigin} from '../utils/public-document-url.js';

async function planningGrant(token){
 const row=(await query(`SELECT p.event_id,p.client_id FROM event_planning p JOIN events e ON e.id=p.event_id
  JOIN clients c ON c.id=p.client_id AND c.id=e.client_id WHERE p.token_hash=$1 AND p.revoked_at IS NULL AND p.expires_at>now()
  AND e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') FOR SHARE OF p`,[hashContractValue(token)])).rows[0];
 if(!row)throw new AppError('Planning access unavailable.',404,'NOT_FOUND');return row;
}
export async function currentBackdropQuote(eventId,clientId=null){
 const row=(await query(`SELECT q.*,i.secure_token,i.token_expires_at,i.token_revoked_at,i.status AS invoice_status FROM backdrop_quotes q
  LEFT JOIN invoices i ON i.id=q.invoice_id AND i.deleted_at IS NULL WHERE q.event_id=$1 AND ($2::uuid IS NULL OR q.client_id=$2)
   AND q.status IN ('ISSUED','ACCEPTED') AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM event_planning p
    WHERE p.event_id=q.event_id AND p.backdrop_path=q.backdrop_path AND p.backdrop_id IS NOT DISTINCT FROM q.backdrop_id))
   ORDER BY q.created_at DESC LIMIT 1`,[eventId,clientId])).rows[0];
 if(!row)return null;
 return {id:row.id,description:row.description,total:row.total,requiredPayment:row.required_payment,status:row.status,acceptedAt:row.accepted_at,
  invoiceId:row.invoice_id,paymentUrl:row.invoice_status&&!['DRAFT','VOID','REFUNDED'].includes(row.invoice_status)?secureDocumentUrl(documentOrigin(),'pay',row):null};
}
export async function issueBackdropQuote(eventId,input,req){
 if(!await userCanAccessEvent(req.user,eventId))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 return transaction(async()=>{
  const event=(await query("SELECT client_id FROM events WHERE id=$1 AND deleted_at IS NULL AND status NOT IN ('CANCELLED','COMPLETED') FOR UPDATE",[eventId])).rows[0];
  if(!event?.client_id)throw new AppError('A current event client is required.',409,'QUOTE_EVENT_INVALID');
  const planning=(await query("SELECT backdrop_path,backdrop_id FROM event_planning WHERE event_id=$1 AND backdrop_path IN ('CUSTOM','COLLECTION') FOR SHARE",[eventId])).rows[0];
  if(!planning)throw new AppError('Select custom or collection backdrop work before issuing its quote.',409,'QUOTE_SCOPE_REQUIRED');
  const row=(await query(`INSERT INTO backdrop_quotes(event_id,client_id,description,total,required_payment,created_by,backdrop_path,backdrop_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[eventId,event.client_id,input.description,input.total,input.requiredPayment,req.user.id,planning.backdrop_path,planning.backdrop_id])).rows[0];
  await writeAudit({req,action:'backdrop_quote_issued',entity:'event',entityId:eventId,after:{quoteId:row.id,...input}});
  return currentBackdropQuote(eventId);
 });
}
export async function publicBackdropQuote(token){return transaction(async()=>{const grant=await planningGrant(token);return currentBackdropQuote(grant.event_id,grant.client_id);});}
export async function acceptBackdropQuote(token,quoteId,name,req){
 return transaction(async()=>{
  const grant=await planningGrant(token);
  const quote=(await query(`SELECT q.* FROM backdrop_quotes q JOIN event_planning p ON p.event_id=q.event_id
   AND p.backdrop_path=q.backdrop_path AND p.backdrop_id IS NOT DISTINCT FROM q.backdrop_id
   WHERE q.id=$1 AND q.event_id=$2 AND q.client_id=$3 FOR UPDATE OF q`,[quoteId,grant.event_id,grant.client_id])).rows[0];
  if(quote?.status==='ACCEPTED')return currentBackdropQuote(grant.event_id,grant.client_id);
  if(quote?.status!=='ISSUED')throw new AppError('This quote is unavailable.',409,'QUOTE_UNAVAILABLE');
  await query("UPDATE backdrop_quotes SET status='ACCEPTED',accepted_by=$2,accepted_at=now(),updated_at=now() WHERE id=$1",[quote.id,name]);
  await writeAudit({req,action:'backdrop_quote_accepted',entity:'event',entityId:grant.event_id,after:{quoteId:quote.id,name}});
  await recordActivity({entityType:'event',entityId:grant.event_id,action:'backdrop_quote_accepted',summary:'Client accepted custom backdrop quote'});
  return currentBackdropQuote(grant.event_id,grant.client_id);
 });
}
export async function linkBackdropInvoice(eventId,invoiceId,req){
 if(!await userCanAccessEvent(req.user,eventId))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 return transaction(async()=>{
  const quote=(await query("SELECT * FROM backdrop_quotes WHERE event_id=$1 AND status='ACCEPTED' FOR UPDATE",[eventId])).rows[0];
  if(!quote)throw new AppError('Client acceptance is required before invoice linkage.',409,'QUOTE_ACCEPTANCE_REQUIRED');
  if(quote.invoice_id&&quote.invoice_id!==invoiceId)throw new AppError('The quote already has an invoice.',409,'QUOTE_INVOICE_LOCKED');
  const invoice=(await query("SELECT * FROM invoices WHERE id=$1 AND event_id=$2 AND client_id=$3 AND deleted_at IS NULL AND status NOT IN ('VOID','REFUNDED') FOR SHARE",[invoiceId,eventId,quote.client_id])).rows[0];
  if(!invoice||Number(invoice.total)!==Number(quote.total))throw new AppError('Link a dedicated invoice for this client, event and exact quote total.',422,'QUOTE_INVOICE_MISMATCH');
  await query('UPDATE backdrop_quotes SET invoice_id=$2,updated_at=now() WHERE id=$1',[quote.id,invoiceId]);
  await writeAudit({req,action:'backdrop_quote_invoice_linked',entity:'event',entityId:eventId,after:{quoteId:quote.id,invoiceId}});
  return currentBackdropQuote(eventId);
 });
}
export async function voidBackdropQuote(eventId,quoteId,req){
 if(!await userCanAccessEvent(req.user,eventId))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 return transaction(async()=>{
  const quote=(await query('SELECT * FROM backdrop_quotes WHERE id=$1 AND event_id=$2 FOR UPDATE',[quoteId,eventId])).rows[0];
  if(!quote)throw new AppError('Quote unavailable.',404,'NOT_FOUND');
  if(quote.invoice_id)throw new AppError('Resolve the linked invoice and any payment before replacing this quote.',409,'QUOTE_INVOICE_LOCKED');
  if(quote.status!=='VOID'){
   await query("UPDATE backdrop_quotes SET status='VOID',updated_at=now() WHERE id=$1",[quoteId]);
   await writeAudit({req,action:'backdrop_quote_voided',entity:'event',entityId:eventId,after:{quoteId}});
   await recordActivity({entityType:'event',entityId:eventId,action:'backdrop_quote_voided',summary:'Backdrop quote withdrawn; issued terms retained in history'});
  }
  return currentBackdropQuote(eventId);
 });
}
export async function assertBackdropPayment(eventId,clientId){
 const quote=(await query(`SELECT q.required_payment,i.total,i.status,i.client_id,i.event_id,
   COALESCE((SELECT sum(p.amount-COALESCE(p.refunded_amount,0)) FROM payments p WHERE p.invoice_id=i.id AND p.deleted_at IS NULL AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')),0) AS paid
  FROM backdrop_quotes q JOIN invoices i ON i.id=q.invoice_id AND i.deleted_at IS NULL
   JOIN event_planning plan ON plan.event_id=q.event_id AND plan.backdrop_path=q.backdrop_path AND plan.backdrop_id IS NOT DISTINCT FROM q.backdrop_id
  WHERE q.event_id=$1 AND q.client_id=$2 AND q.status='ACCEPTED' AND i.client_id=$2 AND i.event_id=$1
   AND i.total=q.total AND i.status NOT IN ('DRAFT','VOID','REFUNDED')`,[eventId,clientId])).rows[0];
 if(!quote||Number(quote.paid)<Number(quote.required_payment))throw new AppError('Accepted quote, linked invoice and required net payment are needed before confirming chargeable backdrop work.',409,'BACKDROP_PAYMENT_REQUIRED');
 return true;
}
