import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {reconcileInvoice} from './payment-reconciliation-service.js';
import {disputeFundsWithheld} from '../../../shared/payment-dispute.js';
const reference=x=>typeof x==='string'?x:x?.id;
async function retrieve(id){
 if(!/^du_/.test(id||''))throw new AppError('Invalid dispute reference.',422,'INVALID_PROVIDER_DISPUTE');
 const response=await fetch('https://api.stripe.com/v1/disputes/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+env.stripeSecretKey,'Stripe-Version':'2026-08-26.dahlia'},signal:AbortSignal.timeout(15000)});
 const object=await response.json();
 if(!response.ok||object.id!==id)throw new AppError('Stripe dispute retrieval failed. Retry or review the provider event.',502,'DISPUTE_LOOKUP_FAILED');
 return object;
}
export async function reconcileStripeDispute(disputeId,livemode){
 const initial=await retrieve(disputeId);
 const intent=reference(initial.payment_intent);
 if(!intent)throw new AppError('Dispute payment relationship requires review.',409,'DISPUTE_RELATIONSHIP_REQUIRED');
 const payment=(await query("SELECT id,invoice_id FROM payments WHERE provider='STRIPE' AND provider_payment_id=$1 AND deleted_at IS NULL",[intent])).rows[0];
 if(!payment)throw new AppError('Post the original payment before reconciling its dispute.',409,'DISPUTE_PAYMENT_NOT_POSTED');
 return transaction(async client=>{
  // Invoice lock also serializes different disputes/refunds for this invoice.
  await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE',[payment.invoice_id]);
  const posted=(await client.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE',[payment.id])).rows[0];
  // Fetch current state AFTER locking. Late old events cannot undo a newer win.
  const object=await retrieve(disputeId);let withheld;
  try{withheld=disputeFundsWithheld(object);}catch{throw new AppError('Dispute balance data requires provider retry or Admin review.',409,'DISPUTE_LEDGER_INVALID');}
  if(object.livemode!==livemode||reference(object.payment_intent)!==intent||!/^ch_/.test(reference(object.charge)||'')||String(object.currency).toUpperCase()!==posted.currency||object.amount>Math.round(Number(posted.amount)*100))throw new AppError('Dispute does not match the posted payment.',409,'DISPUTE_PAYMENT_MISMATCH');
  const before=(await client.query('SELECT * FROM payment_disputes WHERE provider_dispute_id=$1',[disputeId])).rows[0];
  if(before&&(before.payment_id!==posted.id||before.provider_charge_id!==reference(object.charge)))throw new AppError('Dispute relationship changed.',409,'DISPUTE_PAYMENT_MISMATCH');
  const due=Number.isSafeInteger(object.evidence_details?.due_by)?new Date(object.evidence_details.due_by*1000).toISOString():null;
  const dispute=(await client.query(`INSERT INTO payment_disputes(payment_id,provider_dispute_id,provider_charge_id,status,amount,currency,funds_withheld,response_due_at,provider_snapshot)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(provider_dispute_id) DO UPDATE SET status=excluded.status,amount=excluded.amount,funds_withheld=excluded.funds_withheld,response_due_at=excluded.response_due_at,provider_snapshot=excluded.provider_snapshot,updated_at=now() RETURNING *`,[posted.id,disputeId,reference(object.charge),object.status,object.amount/100,posted.currency,withheld/100,due,JSON.stringify(object)])).rows[0];
  const total=Number((await client.query('SELECT COALESCE(sum(funds_withheld),0) n FROM payment_disputes WHERE payment_id=$1',[posted.id])).rows[0].n);
  if(total>Number(posted.amount))throw new AppError('Multiple disputes exceed the posted payment.',409,'DISPUTE_LEDGER_CONFLICT');
  await client.query('UPDATE payments SET disputed_amount=$2,updated_at=now() WHERE id=$1',[posted.id,total]);
  const review=(await client.query('SELECT invoice_payment_review($1) AS held',[posted.invoice_id])).rows[0].held;
  const key='payment-dispute:'+disputeId;
  if(review){
   const task=(await client.query(`INSERT INTO tasks(title,description,event_id,client_id,status,priority,lifecycle_key,due_date)
    VALUES('Review payment dispute','Review the dispute in Stripe and contact the client. Do not charge or refund again automatically. Booking history and signed terms are preserved.',$1,$2,'OPEN','HIGH',$3,$4)
    ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO UPDATE SET status='OPEN',due_date=excluded.due_date,updated_at=now() RETURNING id`,[posted.event_id,posted.client_id,key,due?.slice(0,10)||null])).rows[0];
   if(!before)await client.query(`INSERT INTO notifications(role_target,category,severity,title,body,entity_type,entity_id,action_url,metadata)
    VALUES('MANAGERS','PAYMENTS','WARNING','Payment dispute requires review','Review this Stripe dispute before continuing payment or planning actions.','payment',$1,$2,$3)`,[posted.id,'/sales/payments/'+posted.id,JSON.stringify({disputeId,taskId:task.id})]);
  }else await client.query("UPDATE tasks SET status='DONE',updated_at=now() WHERE lifecycle_key=$1 AND status NOT IN ('DONE','CANCELLED')",[key]);
  await reconcileInvoice(posted.invoice_id,{action:'payment_dispute_reconciled'});
  return {dispute,review};
 });
}
