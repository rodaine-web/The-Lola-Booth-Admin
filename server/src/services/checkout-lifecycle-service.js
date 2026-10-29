import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {logger} from '../config/logger.js';
import {AppError} from '../utils/errors.js';
import {verifyStripeAccount} from './stripe-configuration.js';
const stripeHeaders=()=>({Authorization:`Bearer ${env.stripeSecretKey}`,'Stripe-Version':'2026-08-26.dahlia'});

// Caller holds the invoice row lock. Provider confirmation precedes local expiry.
export async function expireOtherCheckouts(invoice,amount,scope,{attemptIds=null}={}){
 const pending=(await query(`SELECT * FROM payment_attempts WHERE invoice_id=$1 AND provider='STRIPE' AND status='PENDING'
  AND (amount<>$2 OR metadata->>'agreement_scope' IS DISTINCT FROM $3) AND ($4::uuid[] IS NULL OR id=ANY($4))`,[invoice.id,amount,scope,attemptIds])).rows;
 let expiredCount=0;
 for(const attempt of pending){
  const response=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(attempt.provider_session_id)}`,{headers:stripeHeaders(),signal:AbortSignal.timeout(15000)});
  const session=await response.json();
  if(!response.ok)throw new AppError('Previous checkout requires reconciliation before another payment.',409,'CHECKOUT_REVIEW_REQUIRED');
  if(session.status==='complete'||session.payment_status==='paid')throw new AppError('A previous payment is being reconciled. Refresh before paying again.',409,'PAYMENT_RECONCILIATION_PENDING');
  if(!['open','expired'].includes(session.status))throw new AppError('Previous checkout status requires review.',409,'CHECKOUT_REVIEW_REQUIRED');
  if(session.status==='open'){
   const expired=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}/expire`,{method:'POST',headers:stripeHeaders(),signal:AbortSignal.timeout(15000)});
   if(!expired.ok)throw new AppError('Previous checkout could not be closed. Try again after reconciliation.',409,'CHECKOUT_REVIEW_REQUIRED');
   const result=await expired.json();
   if(result.status!=='expired')throw new AppError('Previous checkout expiry requires review.',409,'CHECKOUT_REVIEW_REQUIRED');
  }
  await query("UPDATE payment_attempts SET status='EXPIRED',updated_at=now() WHERE id=$1 AND status='PENDING'",[attempt.id]);expiredCount++;
 }
 return expiredCount;
}

export async function closeProposalCheckouts(proposalId){
 const invoices=(await query("SELECT * FROM invoices WHERE proposal_id=$1 AND deleted_at IS NULL ORDER BY id FOR UPDATE",[proposalId])).rows;
 if(!(await query("SELECT 1 FROM payment_attempts a JOIN invoices i ON i.id=a.invoice_id WHERE i.proposal_id=$1 AND a.provider='STRIPE' AND a.status='PENDING' LIMIT 1",[proposalId])).rowCount)return;
 await verifyStripeAccount();
 for(const invoice of invoices)await expireOtherCheckouts(invoice,-1,'replacement-agreement');
}
const staleAttemptsSql=`SELECT a.id,a.invoice_id FROM invoices i JOIN payment_attempts a ON a.invoice_id=i.id
 LEFT JOIN proposals p ON p.id=i.proposal_id
 LEFT JOIN LATERAL(SELECT * FROM contracts WHERE proposal_id=p.id AND status IN ('ISSUED','SIGNED') ORDER BY revision DESC LIMIT 1) k ON true
 WHERE a.provider='STRIPE' AND a.status='PENDING' AND i.deleted_at IS NULL
  AND ($1::uuid IS NULL OR i.id=$1)
  AND (i.status IN ('PAID','VOID','REFUNDED') OR a.amount>i.amount_outstanding
   OR (i.proposal_id IS NOT NULL AND (k.id IS NULL OR k.status<>'SIGNED' OR k.snapshot->>'accepted_version_id' IS DISTINCT FROM p.accepted_version_id::text
      OR (a.metadata->>'agreement_scope' IS NOT NULL AND a.metadata->>'agreement_scope' NOT LIKE 'agreement:'||k.id::text||':%')))
   OR (invoice_balance_deadline(i.id)<=business_today() AND a.amount<i.amount_outstanding))
 ORDER BY i.id,a.id LIMIT 100`;
/** Expire unsafe provider sessions; uncertain payments remain pending for operator review. */
export async function expireStaleBookingCheckouts(){
 if(!env.stripeSecretKey)return {expired:0,review:0};
 const rows=(await query(staleAttemptsSql,[null])).rows;
 if(!rows.length)return {expired:0,review:0};
 await verifyStripeAccount();let expired=0,review=0;
 for(const id of [...new Set(rows.map(row=>row.invoice_id))]){
  try{expired+=await transaction(async()=>{
   const invoice=(await query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[id])).rows[0];
   // Re-evaluate after locking: a concurrent payment or revised agreement may have changed eligibility.
   const stale=(await query(staleAttemptsSql,[id])).rows.map(row=>row.id);
   return stale.length?expireOtherCheckouts(invoice,-1,'obsolete-checkout',{attemptIds:stale}):0;
  });}catch(error){
   review++;
   logger.warn({invoiceId:id,code:error.code||'CHECKOUT_REVIEW_REQUIRED'},'Stale Stripe checkout needs operator review');
   await query(`INSERT INTO tasks(title,description,client_id,event_id,lifecycle_key,priority)
    SELECT 'Reconcile previous Stripe checkout','A previous Checkout could not be safely expired. Inspect Stripe and webhook history before another payment. No payment was removed.',client_id,event_id,'checkout-review:'||id,'HIGH' FROM invoices WHERE id=$1
    ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING`,[id]);
  }
 }
 return {expired,review};
}
