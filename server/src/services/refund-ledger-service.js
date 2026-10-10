import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
const cents=value=>Math.round(Number(value)*100);

// The committed claim reserves refundable funds before a provider request.
// Replays return that claim; an uncertain provider outcome never starts a new refund.
export async function claimRefund({paymentId,amount,reason,notes,reference,actorId,key}) {
  if(typeof key!=='string'||key.length<8||key.length>160)throw new AppError('A stable refund request key is required.',422,'REFUND_KEY_REQUIRED');
  if(!Number.isFinite(Number(amount))||cents(amount)<=0||Math.abs(Number(amount)*100-cents(amount))>0.00001)throw new AppError('Enter a positive refund amount with at most two decimal places.',422,'INVALID_REFUND_AMOUNT');
  if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw new AppError('A refund reason is required.',422,'REFUND_REASON_REQUIRED');
  return transaction(async client=>{
    // Lock the request key as well as the payment: a reused key cannot cross payments.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`refund:${key}`]);
    const payment=(await client.query('SELECT * FROM payments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[paymentId])).rows[0];
    if(!payment)throw notFound('Payment');
    const prior=(await client.query('SELECT * FROM refunds WHERE idempotency_key=$1',[key])).rows[0];
    if(prior){
      if(prior.payment_id!==paymentId||cents(prior.amount)!==cents(amount)||prior.reason!==reason.trim())throw new AppError('This refund request key was already used for different details.',409,'REFUND_REQUEST_CONFLICT');
      return {payment,refund:prior,created:false};
    }
    if(!['MANUAL','STRIPE'].includes(payment.provider))throw new AppError('This provider has not been qualified for refunds.',409,'PROVIDER_REFUND_NOT_CONFIGURED');
    if(!['SUCCEEDED','PARTIALLY_REFUNDED'].includes(payment.status))throw new AppError('Only posted payments can be refunded.',409,'PAYMENT_NOT_REFUNDABLE');
    const reserved=Number((await client.query("SELECT COALESCE(sum(amount),0) n FROM refunds WHERE payment_id=$1 AND status IN ('PENDING','PROCESSING')",[paymentId])).rows[0].n);
    if(cents(amount)>cents(payment.amount)-cents(payment.refunded_amount)-cents(reserved))throw new AppError('Refund amount exceeds the available balance, including pending refunds.',409,'INVALID_REFUND_AMOUNT');
    const refund=(await client.query(`INSERT INTO refunds(payment_id,invoice_id,event_id,client_id,provider,amount,currency,reason,notes,refund_type,status,provider_reference,created_by,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [payment.id,payment.invoice_id,payment.event_id,payment.client_id,payment.provider,Number(amount),payment.currency,reason.trim(),notes||null,cents(amount)===cents(payment.amount)?'FULL':'PARTIAL',payment.provider==='MANUAL'?'SUCCEEDED':'PROCESSING',reference||null,actorId||null,key])).rows[0];
    if(payment.provider==='MANUAL')await client.query("UPDATE payments SET refunded_amount=refunded_amount+$1,status=CASE WHEN refunded_amount+$1>=amount THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END,updated_at=now() WHERE id=$2",[refund.amount,payment.id]);
    return {payment,refund,created:true};
  });
}

export async function settleStripeRefund(object) {
  const intent=typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id;
  if(!/^re_/.test(object.id||'')||!intent||!Number.isSafeInteger(object.amount)||object.amount<=0)throw new AppError('Invalid Stripe refund record.',502,'INVALID_PROVIDER_REFUND');
  const statuses={succeeded:'SUCCEEDED',pending:'PENDING',requires_action:'PENDING',failed:'FAILED',canceled:'CANCELLED'};
  const status=statuses[object.status];
  if(!status)throw new AppError('Unknown Stripe refund status.',502,'INVALID_PROVIDER_REFUND');
  return transaction(async client=>{
    const payment=(await client.query("SELECT * FROM payments WHERE provider='STRIPE' AND provider_payment_id=$1 AND deleted_at IS NULL FOR UPDATE",[intent])).rows[0];
    if(!payment)return null;
    if(String(object.currency).toUpperCase()!==payment.currency||object.amount>cents(payment.amount))throw new AppError('Stripe refund does not match the posted payment.',409,'REFUND_PAYMENT_MISMATCH');
    const claimId=object.metadata?.lola_refund_id;
    let prior=(await client.query("SELECT * FROM refunds WHERE (provider='STRIPE' AND provider_refund_id=$1) OR (id::text=$2 AND payment_id=$3) FOR UPDATE",[object.id,claimId||'',payment.id])).rows[0];
    if(prior&&(prior.payment_id!==payment.id||cents(prior.amount)!==object.amount||(prior.provider_refund_id&&prior.provider_refund_id!==object.id)))throw new AppError('Stripe refund differs from its committed request.',409,'REFUND_REQUEST_CONFLICT');
    // A canonical failed/canceled response can reverse a previous succeeded ledger entry.
    const delta=(status==='SUCCEEDED'?object.amount:0)-(prior?.status==='SUCCEEDED'?cents(prior.amount):0);
    if(cents(payment.refunded_amount)+delta>cents(payment.amount)||cents(payment.refunded_amount)+delta<0)throw new AppError('Refund reconciliation requires operator review.',409,'REFUND_LEDGER_CONFLICT');
    const refund=prior?(await client.query('UPDATE refunds SET status=$1,provider_refund_id=$2,provider_reference=$2,updated_at=now() WHERE id=$3 RETURNING *',[status,object.id,prior.id])).rows[0]:
      (await client.query(`INSERT INTO refunds(payment_id,invoice_id,event_id,client_id,provider,amount,currency,reason,refund_type,status,provider_refund_id,provider_reference,idempotency_key)
        VALUES($1,$2,$3,$4,'STRIPE',$5,$6,'Stripe refund',$7,$8,$9,$9,$10) RETURNING *`,[payment.id,payment.invoice_id,payment.event_id,payment.client_id,object.amount/100,payment.currency,object.amount===cents(payment.amount)?'FULL':'PARTIAL',status,object.id,`STRIPE:refund:${object.id}`])).rows[0];
    if(delta)await client.query("UPDATE payments SET refunded_amount=refunded_amount+$1,status=CASE WHEN refunded_amount+$1>=amount THEN 'REFUNDED' WHEN refunded_amount+$1>0 THEN 'PARTIALLY_REFUNDED' ELSE 'SUCCEEDED' END,updated_at=now() WHERE id=$2",[delta/100,payment.id]);
    return {payment,refund,changed:!prior||prior.status!==status};
  });
}

export async function markRefundRejected(id){await query("UPDATE refunds SET status='FAILED',updated_at=now() WHERE id=$1 AND status='PROCESSING' AND provider_refund_id IS NULL",[id]);}
