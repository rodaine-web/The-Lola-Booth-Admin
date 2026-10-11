import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';

test('disposable PostgreSQL: decline, expiry and replay affect only their checkout',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
  const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.ok(url.pathname.startsWith('/lola_phase1_qa_'));
  const schema='failure_'+crypto.randomBytes(8).toString('hex');
  const bootstrap=new pg.Pool({connectionString:url.toString()});
  const originalFetch=globalThis.fetch;let pool;
  try{
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options',`-c search_path=${schema},public`);
    process.env.DATABASE_URL=url.toString();process.env.NODE_ENV='test';delete process.env.APP_ENV;
    process.env.EMAIL_PROVIDER='development';process.env.STRIPE_SECRET_KEY='sk_test_disposable';
    process.env.STRIPE_WEBHOOK_SECRET='whsec_disposable';
    const db=await import('../server/src/db/pool.js');pool=db.pool;
    for(const name of (await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())
      await db.transaction(async()=>db.query(await fs.readFile(new URL('../server/migrations/'+name,import.meta.url),'utf8')));
    await db.query("INSERT INTO business_settings(business_name) VALUES('Failure QA')");
    const invoice=(await db.query("INSERT INTO invoices(invoice_number,status,total,balance_due) VALUES('FAILURE-QA','SENT',100,100) RETURNING id")).rows[0];
    async function attempt(session,status='PENDING'){
      await db.query("INSERT INTO payment_attempts(invoice_id,provider,provider_reference,provider_session_id,amount,currency,status) VALUES($1,'STRIPE',$2,$2,100,'USD',$3)",[invoice.id,session,status]);
    }
    await attempt('cs_declined');await attempt('cs_other');await attempt('cs_paid','SUCCEEDED');
    const {handleStripeWebhook}=await import('../server/src/services/payment-service.js');
    let currentEvent;
    globalThis.fetch=async address=>{
      if(String(address).includes('/events/'))return {ok:true,json:async()=>currentEvent};
      if(String(address).includes('/checkout/sessions?'))return {ok:true,json:async()=>({data:[{id:'cs_declined'}],has_more:false})};
      throw new Error('Unexpected provider request');
    };
    async function deliver(type,object,id=crypto.randomUUID()){
      currentEvent={id:'evt_'+id,type,livemode:false,data:{object}};
      const raw=Buffer.from(JSON.stringify(currentEvent));const t=Math.floor(Date.now()/1000);
      const signature=`t=${t},v1=${crypto.createHmac('sha256','whsec_disposable').update(t+'.'+raw).digest('hex')}`;
      return handleStripeWebhook(raw,signature);
    }
    const state=async session=>(await db.query('SELECT status,failure_code FROM payment_attempts WHERE provider_session_id=$1',[session])).rows[0];
    const declineId=crypto.randomUUID();
    await deliver('payment_intent.payment_failed',{id:'pi_declined',metadata:{invoice_id:invoice.id},last_payment_error:{code:'card_declined'}},declineId);
    assert.deepEqual(await state('cs_declined'),{status:'PENDING',failure_code:'card_declined'},'Checkout remains usable after a declined card');
    assert.deepEqual(await state('cs_other'),{status:'PENDING',failure_code:null});
    assert.equal((await deliver('payment_intent.payment_failed',{id:'pi_declined',metadata:{invoice_id:invoice.id},last_payment_error:{code:'card_declined'}},declineId)).duplicate,true);
    await deliver('checkout.session.expired',{id:'cs_declined',metadata:{invoice_id:invoice.id},payment_status:'unpaid'});
    assert.equal((await state('cs_declined')).status,'EXPIRED');
    await deliver('checkout.session.async_payment_failed',{id:'cs_other',metadata:{invoice_id:invoice.id},payment_status:'unpaid'});
    assert.equal((await state('cs_other')).status,'FAILED');
    await deliver('checkout.session.expired',{id:'cs_paid',metadata:{invoice_id:invoice.id},payment_status:'unpaid'});
    assert.equal((await state('cs_paid')).status,'SUCCEEDED','Late failure cannot reverse a succeeded attempt');
    assert.equal((await db.query('SELECT count(*)::int n FROM payments')).rows[0].n,0);
    assert.equal(Number((await db.query('SELECT amount_paid FROM invoices WHERE id=$1',[invoice.id])).rows[0].amount_paid),0);
    assert.equal((await db.query('SELECT count(*)::int n FROM payment_receipts')).rows[0].n,0,'Failures do not generate receipts');
  }finally{
    globalThis.fetch=originalFetch;if(pool)await pool.end();
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();
  }
});
