import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
test('disposable PostgreSQL: canonical dispute replay, inquiry, withdrawal, reversal and financial guards',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.ok(url.pathname.startsWith('/lola_phase1_qa_'));
 const schema='dispute_'+crypto.randomBytes(8).toString('hex');const bootstrap=new pg.Pool({connectionString:url.toString()});let pool;const originalFetch=globalThis.fetch;
 try{
  await bootstrap.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-c search_path=${schema},public`);
  process.env.DATABASE_URL=url.toString();process.env.NODE_ENV='test';delete process.env.APP_ENV;process.env.EMAIL_PROVIDER='development';process.env.STRIPE_SECRET_KEY='sk_test_disposable';process.env.STRIPE_WEBHOOK_SECRET='whsec_disposable';
  const db=await import('../server/src/db/pool.js');pool=db.pool;
  for(const name of (await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())await db.transaction(async()=>db.query(await fs.readFile(new URL('../server/migrations/'+name,import.meta.url),'utf8')));
  await db.query("INSERT INTO business_settings(business_name) VALUES('Dispute QA')");
  const c=(await db.query("INSERT INTO clients(name,email) VALUES('Dispute QA','qa@example.invalid') RETURNING id")).rows[0];
  const e=(await db.query("INSERT INTO events(event_name,client_id,event_type,event_date,status) VALUES('No real event',$1,'WEDDING','2030-12-15','CONFIRMED') RETURNING id",[c.id])).rows[0];
  const i=(await db.query("INSERT INTO invoices(invoice_number,event_id,client_id,status,total,amount_paid,balance_due) VALUES('DISPUTE-QA',$1,$2,'PAID',100,100,0) RETURNING id",[e.id,c.id])).rows[0];
  const p=(await db.query("INSERT INTO payments(event_id,client_id,invoice_id,provider,provider_payment_id,amount,payment_method,payment_date,status) VALUES($1,$2,$3,'STRIPE','pi_qa',100,'CARD',current_date,'SUCCEEDED') RETURNING id",[e.id,c.id,i.id])).rows[0];
  const eventMap=new Map();let currentEvent,canonical={id:'du_qa',payment_intent:'pi_qa',charge:'ch_qa',livemode:false,amount:10000,currency:'usd',status:'warning_needs_response',balance_transactions:[],evidence_details:{due_by:2000000000}};
  globalThis.fetch=async address=>{if(String(address).includes('/events/'))return {ok:true,json:async()=>eventMap.get(String(address).split("/events/")[1])};if(String(address).includes('/disputes/'))return {ok:true,json:async()=>structuredClone(canonical)};throw Error('Unexpected provider request');};
  const {handleStripeWebhook,publicPaymentOptions}=await import('../server/src/services/payment-service.js');
  async function deliver(type='charge.dispute.updated',id='evt_'+crypto.randomUUID()){
   currentEvent={id,type,livemode:false,data:{object:{id:'du_qa',status:'needs_response'}}};
   eventMap.set(id,structuredClone(currentEvent));const raw=Buffer.from(JSON.stringify(currentEvent));const t=Math.floor(Date.now()/1000);const signature=`t=${t},v1=${crypto.createHmac('sha256','whsec_disposable').update(t+'.'+raw).digest('hex')}`;return handleStripeWebhook(raw,signature);
  }
  const state=async()=>(await db.query('SELECT status,amount_paid,balance_due FROM invoices WHERE id=$1',[i.id])).rows[0];
  const {reportingQuery}=await import('../server/src/services/reporting-query.js');
  const reportingNet=async()=>Number((await reportingQuery('SELECT GREATEST(0,p.amount-p.refunded_amount-p.disputed_amount) AS net FROM payments p WHERE p.id=$1',[p.id])).rows[0].net);
  await deliver('charge.dispute.created');assert.equal(Number((await state()).amount_paid),100,'Inquiry does not withdraw funds');
  assert.equal((await db.query('SELECT invoice_payment_review($1) held',[i.id])).rows[0].held,true);
  assert.equal((await publicPaymentOptions({...await state(),id:i.id,total:100})).payable,false);
  canonical={...canonical,status:'needs_response',balance_transactions:[{id:'txn_debit',amount:-10000,currency:'usd',fee:1500}]};
  const eventId='evt_replay';await deliver('charge.dispute.funds_withdrawn',eventId);
  assert.equal(Number((await state()).amount_paid),0);assert.equal(Number((await state()).balance_due),100);assert.equal(await reportingNet(),0,'Reporting includes the newly added dispute column');
  assert.equal((await deliver('charge.dispute.funds_withdrawn',eventId)).duplicate,true);
  await Promise.all(Array.from({length:6},()=>deliver()));
  assert.equal((await db.query('SELECT count(*)::int n FROM payment_disputes')).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM tasks WHERE lifecycle_key='payment-dispute:du_qa'")).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM refunds')).rows[0].n,0,'Dispute is not a refund');
  assert.match((await db.query('SELECT booking_confirmation_missing($1) missing',[e.id])).rows[0].missing.join(' '),/dispute/);
  const {assertPlanningPrerequisites}=await import('../server/src/services/event-planning-service.js');await assert.rejects(assertPlanningPrerequisites(e.id),{code:'PAYMENT_DISPUTE_REVIEW'});
  const {claimRefund}=await import('../server/src/services/refund-ledger-service.js');await assert.rejects(claimRefund({paymentId:p.id,amount:1,reason:'QA',key:'qa_refund_dispute'}),{code:'PAYMENT_DISPUTE_REVIEW'});
  const {dispatchDecision}=await import('../server/src/services/communication-dispatch-policy.js');process.env.BOOKING_LIFECYCLE_REMINDERS_ENABLED='true';await db.query("UPDATE invoices SET due_date=current_date WHERE id=$1",[i.id]);
  assert.equal(await dispatchDecision(db,{trigger_key:'BOOKING_BALANCE_REMINDER',invoice_id:i.id,event_id:e.id,recipient:'qa@example.invalid',idempotency_key:'booking-reminder:BALANCE:'+i.id+':'+new Date().toISOString().slice(0,10)+':1'}),'CANCELLED');
  canonical={...canonical,status:'won',balance_transactions:[...canonical.balance_transactions,{id:'txn_credit',amount:10000,currency:'usd',fee:0}]};
  await deliver('charge.dispute.funds_reinstated');await deliver('charge.dispute.created'); // stale notification refetches current won record
  assert.equal(Number((await state()).amount_paid),100);assert.equal((await state()).status,'PAID');assert.equal(await reportingNet(),100,'Reinstated funds return to reporting');assert.equal((await db.query('SELECT invoice_payment_review($1) held',[i.id])).rows[0].held,false);
  assert.equal((await db.query("SELECT status FROM tasks WHERE lifecycle_key='payment-dispute:du_qa'")).rows[0].status,'DONE');
  canonical={...canonical,currency:'eur'};await assert.rejects(deliver(),{code:'DISPUTE_LEDGER_INVALID'});assert.equal(Number((await state()).amount_paid),100,'Mismatch rolls back');
  assert.equal((await db.query('SELECT status FROM events WHERE id=$1',[e.id])).rows[0].status,'CONFIRMED','Do not erase booking or agreement history');
 }finally{globalThis.fetch=originalFetch;if(pool)await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();}
});
