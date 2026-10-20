import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';

test('Stripe tax PostgreSQL: checkout, retainer/balance, zero-tax and webhook replay reconciliation',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/lola_.*qa/);
 const schema='tax_qa_'+crypto.randomBytes(6).toString('hex'),bootstrap=new pg.Pool({connectionString:url.toString()}),originalFetch=globalThis.fetch;let pool;
 try{
  await bootstrap.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:url.toString(),NODE_ENV:'test',APP_ENV:'test',STRIPE_SECRET_KEY:'sk_test_qa_only',STRIPE_ACCOUNT_ID:'acct_qaonly',STRIPE_WEBHOOK_SECRET:'whsec_qaonly',STRIPE_AUTOMATIC_TAX_ENABLED:'true',STRIPE_TAX_CODE:'txcd_20030000',STRIPE_TAX_CODE_OVERRIDES:'{}',EMAIL_PROVIDER:'development'});
  const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db;
  // Apply actual migrations sequentially in the disposable schema.
  for(const file of(await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8')));
  const row=async(sql,args=[])=>(await query(sql,args)).rows[0];
  await query("INSERT INTO business_settings(business_name,stripe_enabled) VALUES('Tax QA only',true)");
  const client=await row("INSERT INTO clients(name,email) VALUES('Tax QA','tax-qa@example.invalid') RETURNING id"),event=await row("INSERT INTO events(client_id,event_name,event_type,event_date,status) VALUES($1,'Tax QA only','Wedding','2035-10-15','TENTATIVE') RETURNING id",[client.id]);
  let number=0,currentEvent;const sessions=new Map(),requests=[];
  globalThis.fetch=async(address,options={})=>{
   const path=String(address);
   if(path.endsWith('/account'))return {ok:true,json:async()=>({id:'acct_qaonly',charges_enabled:true})};
   if(path.includes('/events/'))return {ok:true,json:async()=>currentEvent};
   if(path.includes('/checkout/sessions?')){const intent=new URL(path).searchParams.get('payment_intent');return {ok:true,json:async()=>({data:[...sessions.values()].filter(s=>s.payment_intent===intent).map(s=>({id:s.id})),has_more:false})};}
   if(path.endsWith('/expire')){const s=sessions.get(path.split('/').at(-2));s.status='expired';return {ok:true,json:async()=>s};}
   if(path.includes('/checkout/sessions/'))return {ok:true,json:async()=>sessions.get(path.split('/').at(-1))};
   if(path.endsWith('/checkout/sessions')){const p=options.body;requests.push(p);const id='cs_tax'+(++number),metadata=Object.fromEntries([...p.entries()].filter(([k])=>/^metadata\[/.test(k)).map(([k,v])=>[k.slice(9,-1),v]));const base=[...p.entries()].filter(([k])=>k.endsWith('[unit_amount]')).reduce((n,[,v])=>n+Number(v),0);const session={id,status:'open',url:'https://checkout.stripe.com/c/pay/'+id,livemode:false,payment_intent:'pi_tax'+number,currency:'usd',amount_subtotal:base,amount_total:base,payment_status:'unpaid',metadata,automatic_tax:{enabled:true,status:null},total_details:{amount_tax:0,amount_discount:0}};sessions.set(id,session);return {ok:true,json:async()=>session};}
   throw Error('Unexpected external request '+path);
  };
  const {createPaymentSession,handleStripeWebhook}=await import('../server/src/services/payment-service.js');
  async function deliver(type,object,id=crypto.randomUUID()){currentEvent={id:'evt_'+id,type,livemode:false,data:{object}};const raw=Buffer.from(JSON.stringify(currentEvent)),time=Math.floor(Date.now()/1000),signature='t='+time+',v1='+crypto.createHmac('sha256','whsec_qaonly').update(time+'.'+raw).digest('hex');return handleStripeWebhook(raw,signature);}
  async function invoice(){const i=await row("INSERT INTO invoices(invoice_number,client_id,event_id,status,subtotal,discount,tax,total,balance_due,amount_outstanding,secure_token,pricing_snapshot) VALUES($1,$2,$3,'SENT',1000,100,0,900,900,900,$4,$5) RETURNING *",['TAX-QA-'+crypto.randomUUID(),client.id,event.id,crypto.randomBytes(24).toString('hex'),{amount_due_now:270,allow_custom_amount:true,allow_pay_in_full:true}]);await query("INSERT INTO invoice_items(invoice_id,label,description,quantity,unit_price,total,line_total,taxable,stripe_tax_code) VALUES($1,'Discounted service','Discounted service',1,800,800,800,true,'txcd_20030000'),($1,'Printed photos','Printed photos',1,100,100,100,true,'txcd_20090028')",[i.id]);return i;}
  const i=await invoice();
  const retainer=await createPaymentSession({token:i.secure_token,provider:'STRIPE',amountChoice:'DEPOSIT',idempotencyKey:'tax-retainer'});assert.equal(retainer.amount,270);assert.equal(requests[0].get('automatic_tax[enabled]'),'true');assert.equal(requests[0].get('billing_address_collection'),'required');assert.equal(requests[0].get('line_items[0][price_data][tax_behavior]'),'exclusive');
  const s=sessions.get(retainer.sessionId);Object.assign(s,{amount_total:28688,total_details:{amount_tax:1688,amount_discount:0},payment_status:'paid',automatic_tax:{enabled:true,status:'complete'},customer_details:{address:{country:'US'}}});
  // PaymentIntent arrives first; its final tax must come from the originating session.
  await deliver('payment_intent.succeeded',{id:s.payment_intent,amount_received:s.amount_total,currency:'usd',metadata:s.metadata});
  await deliver('checkout.session.completed',s);const stored=await row('SELECT * FROM invoices WHERE id=$1',[i.id]);assert.equal(Number(stored.amount_paid),270);assert.equal(Number(stored.amount_outstanding),630);assert.equal(Number(stored.stripe_tax_amount),16.88);assert.equal((await row('SELECT count(*)::int n FROM payments WHERE invoice_id=$1',[i.id])).n,1);
  const p=await row('SELECT * FROM payments WHERE invoice_id=$1',[i.id]);assert.equal(Number(p.amount),286.88);assert.equal(Number(p.tax_amount),16.88);const {getReceiptView}=await import('../server/src/services/receipt-service.js');const receipt=await getReceiptView(stored,p.id);assert.equal(receipt.serviceSubtotal,270);assert.equal(receipt.tax,16.88);assert.equal(receipt.balanceDue,630);
  const balance=await createPaymentSession({token:i.secure_token,provider:'STRIPE',amountChoice:'FULL',idempotencyKey:'tax-balance'});assert.equal(balance.amount,630);const final=sessions.get(balance.sessionId);Object.assign(final,{amount_total:66938,total_details:{amount_tax:3938,amount_discount:0},payment_status:'paid',automatic_tax:{enabled:true,status:'complete'}});await deliver('checkout.session.completed',final);const done=await row('SELECT * FROM invoices WHERE id=$1',[i.id]);assert.equal(Number(done.amount_paid),900);assert.equal(Number(done.amount_outstanding),0);assert.equal(Number(done.stripe_tax_amount),56.26);
  const free=await invoice(),checkout=await createPaymentSession({token:free.secure_token,provider:'STRIPE',amountChoice:'FULL',idempotencyKey:'zero-tax'}),zero=sessions.get(checkout.sessionId);Object.assign(zero,{payment_status:'paid',automatic_tax:{enabled:true,status:'complete'}});await deliver('checkout.session.completed',zero);assert.equal(Number((await row('SELECT stripe_tax_amount FROM invoices WHERE id=$1',[free.id])).stripe_tax_amount),0);
  // Replacing an unpaid amount closes its old provider session before exposing a new one.
  const changed=await invoice(),old=await createPaymentSession({token:changed.secure_token,provider:'STRIPE',amountChoice:'DEPOSIT',idempotencyKey:'change-retainer'});
  await createPaymentSession({token:changed.secure_token,provider:'STRIPE',amountChoice:'FULL',idempotencyKey:'change-full'});
  assert.equal(sessions.get(old.sessionId).status,'expired');
  assert.equal((await row('SELECT status FROM payment_attempts WHERE provider_session_id=$1',[old.sessionId])).status,'EXPIRED');
  const uncertain=await invoice(),uncertainSession=await createPaymentSession({token:uncertain.secure_token,provider:'STRIPE',amountChoice:'DEPOSIT',idempotencyKey:'uncertain-retainer'});
  sessions.get(uncertainSession.sessionId).status='complete';
  await assert.rejects(createPaymentSession({token:uncertain.secure_token,provider:'STRIPE',amountChoice:'FULL',idempotencyKey:'uncertain-full'}),{code:'PAYMENT_RECONCILIATION_PENDING'});
  assert.equal((await row('SELECT status FROM payment_attempts WHERE provider_session_id=$1',[uncertainSession.sessionId])).status,'PENDING');
  const unknown=await invoice(),unknownSession=await createPaymentSession({token:unknown.secure_token,provider:'STRIPE',amountChoice:'DEPOSIT',idempotencyKey:'unknown-retainer'});
  sessions.get(unknownSession.sessionId).status='unknown';
  await assert.rejects(createPaymentSession({token:unknown.secure_token,provider:'STRIPE',amountChoice:'FULL',idempotencyKey:'unknown-full'}),{code:'CHECKOUT_REVIEW_REQUIRED'});
  await query("UPDATE invoices SET status='VOID' WHERE id=ANY($1::uuid[])",[[uncertain.id,unknown.id,changed.id]]);
  const {expireStaleBookingCheckouts}=await import('../server/src/services/checkout-lifecycle-service.js');
  const cleanup=await expireStaleBookingCheckouts();assert.equal(cleanup.review,2);assert.equal(cleanup.expired,1);
  assert.equal((await row("SELECT count(*)::int n FROM tasks WHERE lifecycle_key LIKE 'checkout-review:%'")).n,2);
  await expireStaleBookingCheckouts();assert.equal((await row("SELECT count(*)::int n FROM tasks WHERE lifecycle_key LIKE 'checkout-review:%'")).n,2,'Review tasks are deduplicated');
  const invalid=await invoice();await query('UPDATE invoices SET tax=1 WHERE id=$1',[invalid.id]);await assert.rejects(createPaymentSession({token:invalid.secure_token,provider:'STRIPE',amountChoice:'FULL',idempotencyKey:'manual-tax'}),{code:'STRIPE_LEGACY_TAX_REVIEW'});
  await query("UPDATE payments SET refunded_amount=1,status='PARTIALLY_REFUNDED' WHERE id=$1",[p.id]);assert.equal((await row('SELECT invoice_payment_review($1) AS held',[i.id])).held,true,'Do not invent partial refund tax allocation');
 }finally{globalThis.fetch=originalFetch;if(pool)await pool.end();await bootstrap.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await bootstrap.end();}
});
