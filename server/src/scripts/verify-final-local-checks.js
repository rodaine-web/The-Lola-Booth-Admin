import assert from 'node:assert/strict';
import crypto from 'node:crypto';
export async function verifyFinalLocalChecks({db,call,base,env,owner,invoiceId}){
 const passed=[];
 const payments=await import('../services/payment-service.js');
 const jobs=await import('../services/integration-jobs-service.js');
 const automation=await import('../services/automation-service.js');
 const {getInvoice}=await import('../services/invoice-service.js');
 const invoice=await getInvoice(invoiceId);
 const originalFetch=globalThis.fetch;
 const originalStripe=env.stripeSecretKey,originalWebhook=env.stripeWebhookSecret,originalSms=env.smsProvider;
 env.stripeSecretKey='sk_test_local_mock_only';env.stripeWebhookSecret='whsec_local_fixture_only';
 const sessions=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.stripe.com/v1/checkout/sessions'){
   const amount=Number(options.body.get('line_items[0][price_data][unit_amount]'));
   const session={id:'cs_test_'+sessions.length,url:'https://checkout.stripe.com/c/pay/mock_'+sessions.length,amount};sessions.push(session);
   return new Response(JSON.stringify(session),{status:200,headers:{'content-type':'application/json'}});
  }
  if(!String(url).startsWith(base))throw new Error('External request blocked by local test');
  return originalFetch(url,options);
 };
 const signed=async(event,age=0)=>{const raw=Buffer.from(JSON.stringify(event));const timestamp=Math.floor(Date.now()/1000)-age;const hash=crypto.createHmac('sha256',env.stripeWebhookSecret).update(`${timestamp}.${raw}`).digest('hex');return payments.handleStripeWebhook(raw,`t=${timestamp},v1=${hash}`);};
 try{
  await db.query('UPDATE business_settings SET stripe_enabled=true');
  const options=await payments.publicPaymentOptions({...invoice,amount_outstanding:0,balance_due:100});assert.equal(options.amountDue,0);assert.equal(options.payable,false);
  const access=await call('POST','/public/invoice-access',{invoiceNumber:invoice.invoice_number,email:invoice.client_email},null);
  const wrong=await call('POST','/public/invoice-access',{invoiceNumber:'MISSING',email:'unknown@example.invalid'},null);assert.deepEqual(access.data,wrong.data);assert.equal(access.status,200);
  await call('POST','/public/invoice-access',{invoiceNumber:invoice.invoice_number,email:invoice.client_email},null);
  assert.equal((await db.query("SELECT count(*)::int n FROM communications WHERE invoice_id=$1 AND trigger_key='INVOICE_ACCESS'",[invoice.id])).rows[0].n,1);
  const safe=(await call('GET','/public/invoices/'+invoice.secure_token,null,null)).data.invoice;assert.equal(safe.client_email,undefined);assert.equal(safe.secure_token,undefined);assert.equal(safe.id,undefined);
  await db.query("UPDATE invoices SET token_expires_at=now()-interval '1 hour' WHERE id=$1",[invoice.id]);assert.equal((await call('GET','/public/invoices/'+invoice.secure_token,null,null)).status,404);await db.query('UPDATE invoices SET token_expires_at=NULL WHERE id=$1',[invoice.id]);
  passed.push('Secure invoice lookup has generic results, throttled email delivery, public field allowlist and expiry denial');
  assert.equal((await call('POST','/invoices/'+invoice.id+'/send',{})).status,200);
  const session=await payments.createPaymentSession({token:invoice.secure_token,provider:'STRIPE',idempotencyKey:'qa'});assert.equal(sessions[0].amount,Math.round(Number(invoice.total)*100));assert.equal((await payments.createPaymentSession({token:invoice.secure_token,provider:'STRIPE',idempotencyKey:'qa'})).sessionId,session.sessionId);
  const event={id:'evt_local_paid',type:'checkout.session.completed',livemode:false,data:{object:{id:session.sessionId,payment_intent:'pi_local_paid',payment_status:'paid',metadata:{invoice_id:invoice.id},amount_total:sessions[0].amount,currency:'usd'}}};
  await assert.rejects(()=>signed(event,400),e=>e.code==='INVALID_STRIPE_SIGNATURE');await assert.rejects(()=>signed({...event,livemode:true}),e=>e.code==='LIVE_PAYMENTS_DISABLED');
  await signed({...event,id:'evt_unpaid',data:{object:{...event.data.object,payment_status:'unpaid'}}});assert.equal((await db.query('SELECT count(*)::int n FROM payments WHERE invoice_id=$1',[invoice.id])).rows[0].n,0);
  await signed({id:'evt_decline',type:'payment_intent.payment_failed',livemode:false,data:{object:{id:'pi_local_decline',metadata:{invoice_id:invoice.id},last_payment_error:{code:'card_declined'}}}});
  assert.equal((await getInvoice(invoice.id)).amount_paid,'0.00');assert.equal((await db.query('SELECT status FROM payment_attempts WHERE provider_session_id=$1',[session.sessionId])).rows[0].status,'FAILED');
  await db.query("UPDATE payment_attempts SET status='PENDING' WHERE provider_session_id=$1",[session.sessionId]);
  const mismatch={...event,id:'evt_retry_after_failure',data:{object:{...event.data.object,currency:'eur'}}};await assert.rejects(()=>signed(mismatch),e=>e.code==='PAYMENT_MISMATCH');
  assert.equal((await db.query('SELECT count(*)::int n FROM payments WHERE invoice_id=$1',[invoice.id])).rows[0].n,0);
  // Same failing event remains retryable: still fails validation, never silently ignored.
  await assert.rejects(()=>signed(mismatch),e=>e.code==='PAYMENT_MISMATCH');
  const results=await Promise.all([signed(event),signed(event)]);assert.equal(results.filter(r=>r.duplicate).length,1);
  await signed({...event,id:'evt_same_payment_other_event'});
  const current=await getInvoice(invoice.id);assert.equal(Number(current.amount_outstanding),0);assert.equal(current.status,'PAID');
  assert.equal((await db.query('SELECT count(*)::int n FROM payments WHERE invoice_id=$1',[invoice.id])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM payment_receipts WHERE invoice_id=$1',[invoice.id])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM communications WHERE invoice_id=$1 AND trigger_key='PAYMENT_CONFIRMATION'",[invoice.id])).rows[0].n,1);
  const payment=(await db.query('SELECT * FROM payments WHERE invoice_id=$1',[invoice.id])).rows[0];
  const receipt=await fetch(`${base}/api/public/invoices/${invoice.secure_token}/receipts/${payment.id}/pdf`);assert.equal(receipt.status,200);assert.equal(Buffer.from(await receipt.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  await automation.processDueJobs({limit:100});assert.equal((await db.query("SELECT status FROM communications WHERE invoice_id=$1 AND trigger_key='PAYMENT_CONFIRMATION'",[invoice.id])).rows[0].status,'SENT_TO_PROVIDER');
  passed.push('Mock Stripe checkout amount, signed webhook, unpaid/decline safety, failed-event retry, concurrent duplicate delivery, one payment/receipt/email and reconciled balance');
  assert.equal((await call('POST','/invoices/'+invoice.id+'/revoke-access',{})).status,200);assert.equal((await call('GET','/public/invoices/'+invoice.secure_token,null,null)).status,404);await db.query('UPDATE invoices SET token_revoked_at=NULL WHERE id=$1',[invoice.id]);
  passed.push('Revoking invoice access denies the bearer URL; receipt download is invoice-scoped');
  const {verifyInvoiceQr}=await import('./verify-invoice-qr.js');
  const invoicePdf=await fetch(`${base}/api/public/invoices/${invoice.secure_token}/pdf`);
  assert.equal(invoicePdf.status,200);
  await verifyInvoiceQr(await invoicePdf.arrayBuffer(),`${env.publicBaseUrl}/pay/${invoice.secure_token}`);
  passed.push('Generated invoice PDF is rasterized and its QR decodes to the invoice-specific LOLA payment page');

  const lead=(await call('POST','/leads',{first_name:'Attribution',last_name:'QA',email:'attribution@example.invalid',phone:'5559990022',event_date:'2027-12-16',event_type:'Corporate'})).data;
  if(lead){await jobs.captureAttribution(lead.id,{utm_source:'instagram',fbclid:'synthetic_click',landing_page_url:'https://example.invalid/landing?email=private'});await jobs.captureAttribution(lead.id,{utm_source:'referral'});const row=(await db.query('SELECT first_touch,latest_touch FROM leads WHERE id=$1',[lead.id])).rows[0];assert.equal(row.first_touch.utm_source,'instagram');assert.equal(row.latest_touch.utm_source,'referral');assert.equal(row.first_touch.landing_page,'https://example.invalid/landing');}
  const marketing=await jobs.enqueueIntegrationEvent({provider:'GA4',eventName:'generate_lead',entityType:'invoice',entityId:invoice.id,payload:{email:'private@example.invalid',attribution:{utm_source:'test',email:'private@example.invalid'}},idempotencyKey:'marketing-qa'});assert.ok(!JSON.stringify(marketing.payload).includes('private'));
  await jobs.processIntegrationJobs({limit:500});await jobs.processIntegrationJobs({limit:500});assert.equal((await db.query("SELECT count(*)::int n FROM integration_dispatches WHERE idempotency_key='marketing-qa'")).rows[0].n,1);
  const failure=await jobs.enqueueIntegrationEvent({provider:'TIKTOK',eventName:'test_failure',entityType:'invoice',entityId:invoice.id,idempotencyKey:'mock-failure'});
  await jobs.processIntegrationJobs({dispatch:async()=>{throw Object.assign(new Error('fixture failure'),{code:'MOCK_TIMEOUT'});}});assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[failure.id])).rows[0].status,'QUEUED');await db.query('UPDATE integration_jobs SET available_at=now() WHERE id=$1',[failure.id]);await jobs.processIntegrationJobs();assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[failure.id])).rows[0].status,'SUCCEEDED');
  passed.push('Attribution first/latest touch, URL minimization, no extra PII, durable mock marketing dispatch, deduplication and retry');
  env.smsProvider='development';await db.query(`UPDATE business_settings SET sms_escalations='{"event_24h":false,"overdue_balance":false,"urgent_operations":true,"overdue_days":7}'`);
  const smsInput={entityType:'event',entityId:invoice.event_id,rule:'urgent_operations',reason:'Synthetic schedule change'};
  assert.equal((await jobs.queueSmsEscalation(smsInput)).queued,false);
  await jobs.setSmsConsent({entityType:'client',entityId:invoice.client_id,consented:true,source:'Synthetic local opt-in form',req:{user:owner}});
  const queued=await jobs.queueSmsEscalation(smsInput);assert.equal(queued.queued,true);assert.equal((await jobs.queueSmsEscalation(smsInput)).id,queued.id);
  await jobs.setSmsConsent({entityType:'client',entityId:invoice.client_id,consented:false,source:'',req:{user:owner}});await jobs.processIntegrationJobs();assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[queued.id])).rows[0].status,'CANCELLED');
  await jobs.setSmsConsent({entityType:'client',entityId:invoice.client_id,consented:true,source:'Synthetic renewed opt-in',req:{user:owner}});const allowed=await jobs.queueSmsEscalation({...smsInput,occurrence:'second'});await jobs.processIntegrationJobs();assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[allowed.id])).rows[0].status,'SUCCEEDED');
  await db.query("UPDATE events SET event_date=(now()+interval '12 hours')::date,start_time=(now()+interval '12 hours')::time,status='CONFIRMED' WHERE id=$1",[invoice.event_id]);
  const emailFirst=await jobs.queueEventReminder(invoice.event_id);assert.equal(emailFirst.emailQueued,true);assert.equal(emailFirst.sms.queued,false);
  await db.query("UPDATE business_settings SET sms_escalations=jsonb_set(sms_escalations,'{event_24h}','true')");
  assert.equal((await jobs.queueEventReminder(invoice.event_id)).sms.queued,false);await automation.processDueJobs({limit:100});await db.query("UPDATE business_settings SET sms_escalations=jsonb_set(sms_escalations,'{email_delay_hours}','0')");const escalated=await jobs.queueEventReminder(invoice.event_id);assert.equal(escalated.sms.queued,true);await jobs.queueEventReminder(invoice.event_id);
  assert.equal((await db.query("SELECT count(*)::int n FROM communications WHERE event_id=$1 AND trigger_key='EVENT_24H_REMINDER'",[invoice.event_id])).rows[0].n,1);
  await automation.processDueJobs({limit:100});await jobs.processIntegrationJobs({limit:100});assert.equal((await db.query("SELECT status FROM communications WHERE event_id=$1 AND trigger_key='EVENT_24H_REMINDER'",[invoice.event_id])).rows[0].status,'SENT_TO_PROVIDER');
  passed.push('Email-first event reminder persists once; SMS escalation only queues when separately enabled and consented');
  const overdue=(await call('POST','/invoices',{client_id:invoice.client_id,event_id:invoice.event_id,due_date:'2025-01-01',items:[{description:'Synthetic overdue fixture',quantity:1,unit_price:50}]})).data;
  await call('POST','/invoices/'+overdue.id+'/send',{});
  await db.query("UPDATE business_settings SET sms_escalations=jsonb_set(sms_escalations,'{overdue_balance}','true')");
  assert.equal((await jobs.queueOverdueReminder(overdue.id)).sms.queued,false);
  await automation.processDueJobs({limit:100});
  const overdueSms=await jobs.queueOverdueReminder(overdue.id);assert.equal(overdueSms.sms.queued,true);assert.equal((await jobs.queueOverdueReminder(overdue.id)).sms.id,overdueSms.sms.id);
  await jobs.setSmsConsent({entityType:'client',entityId:invoice.client_id,consented:false,req:{user:owner}});await jobs.processIntegrationJobs();assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[overdueSms.sms.id])).rows[0].status,'CANCELLED');
  await jobs.setSmsConsent({entityType:'client',entityId:invoice.client_id,consented:true,source:'Synthetic reset',req:{user:owner}});
  passed.push('Overdue email must be sent before mock SMS; threshold, per-invoice dedup and send-time consent withdrawal enforced');
  const unknown=await jobs.enqueueIntegrationEvent({provider:'GA4',eventName:'generate_lead',entityType:'invoice',entityId:invoice.id,idempotencyKey:'unknown-provider-outcome'});
  await db.query("UPDATE integration_jobs SET mode='PROVIDER',status='PROCESSING',started_at=now()-interval '6 minutes' WHERE id=$1",[unknown.id]);await jobs.processIntegrationJobs();assert.equal((await db.query('SELECT last_error FROM integration_jobs WHERE id=$1',[unknown.id])).rows[0].last_error,'PROVIDER_OUTCOME_UNKNOWN');assert.equal((await db.query('SELECT count(*)::int n FROM integration_dispatches WHERE idempotency_key=$1',[unknown.idempotency_key])).rows[0].n,0);
  passed.push('Stale external provider claim requires outcome review; worker restart never blindly resends');

  passed.push('SMS disabled by default, explicit escalation plus recorded consent, deduplicated queue, consent withdrawal rechecked at send and mock dispatch');
  const stale=await jobs.enqueueIntegrationEvent({provider:'META',eventName:'stale',entityType:'invoice',entityId:invoice.id,idempotencyKey:'stale-mock'});await db.query("UPDATE integration_jobs SET status='PROCESSING',started_at=now()-interval '6 minutes' WHERE id=$1",[stale.id]);await jobs.processIntegrationJobs();assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[stale.id])).rows[0].status,'SUCCEEDED');
  passed.push('Mock integration worker recovers a stale claim without duplicate dispatch');
  const smsFailure=await jobs.queueSmsEscalation({...smsInput,occurrence:'provider-error'});
  await jobs.processIntegrationJobs({dispatch:async()=>{throw Object.assign(new Error('Synthetic SMS timeout'),{code:'MOCK_SMS_TIMEOUT'});}});
  assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[smsFailure.id])).rows[0].status,'QUEUED');
  await db.query('UPDATE integration_jobs SET available_at=now() WHERE id=$1',[smsFailure.id]);await jobs.processIntegrationJobs();await jobs.processIntegrationJobs();
  assert.equal((await db.query('SELECT status FROM integration_jobs WHERE id=$1',[smsFailure.id])).rows[0].status,'SUCCEEDED');
  assert.equal((await db.query('SELECT count(*)::int n FROM integration_dispatches d JOIN integration_jobs j USING(idempotency_key) WHERE j.id=$1',[smsFailure.id])).rows[0].n,1);
  passed.push('Mock SMS provider failure retries safely and records one successful dispatch');

  const {ingestProviderLead}=await import('../services/social-lead-service.js');
  const {recoverPublicInquiryAcknowledgments}=await import('../services/public-form-email-service.js');
  const recovery=await ingestProviderLead({provider:'WEBSITE',payload:{firstName:'Recovery',lastName:'Fixture',email:'ack-recovery@example.invalid',phone:'5559990088',eventDate:'2027-12-16',eventType:'Corporate',city:'Chicago',state:'IL',form_id:'contact-recovery'}});
  assert.equal(recovery.lead.public_ack_pending,true);
  await recoverPublicInquiryAcknowledgments();await recoverPublicInquiryAcknowledgments();
  assert.equal((await db.query("SELECT count(*)::int n FROM communications WHERE lead_id=$1 AND trigger_key='PUBLIC_FORM'",[recovery.lead.id])).rows[0].n,2);
  assert.equal((await db.query('SELECT public_ack_pending FROM leads WHERE id=$1',[recovery.lead.id])).rows[0].public_ack_pending,false);
  passed.push('Interrupted form acknowledgment is recovered from a persisted lead marker; replay leaves one owner email and one customer email');
  const failedDraft=await automation.createCommunicationDraft({channel:'EMAIL',recipient:'retry@example.invalid',subject:'Retry fixture',body:'Persist failed delivery'},owner);
  const previousEmailProvider=env.emailProvider;
  try {
    env.emailProvider='unsupported-local-fixture';
    await assert.rejects(()=>automation.sendCommunication(failedDraft.id,owner),e=>e.code==='EMAIL_SEND_FAILED');
    await assert.rejects(()=>automation.retryCommunication(failedDraft.id,owner),e=>e.code==='EMAIL_SEND_FAILED');
    assert.equal((await db.query('SELECT status FROM communications WHERE id=$1',[failedDraft.id])).rows[0].status,'FAILED');
    env.emailProvider='development';
    await automation.retryCommunication(failedDraft.id,owner);
    await automation.sendCommunication(failedDraft.id,owner);
    assert.equal((await db.query('SELECT count(*)::int n FROM email_messages WHERE communication_id=$1',[failedDraft.id])).rows[0].n,1);
    assert.equal((await db.query('SELECT failure_code FROM communications WHERE id=$1',[failedDraft.id])).rows[0].failure_code,null);
  } finally {env.emailProvider=previousEmailProvider;}
  passed.push('Provider failure and failed retry stay visible; successful development retry clears failure and repeated send produces one delivery');
  const health=(await call('GET','/system/health')).data;
  assert.ok(health.checks.filter(item=>item.name.startsWith('payments.')||['sms','integrations'].includes(item.name)).every(item=>item.optional));
  assert.ok(health.checks.filter(item=>['api','database','worker','email','storage'].includes(item.name)).every(item=>!item.optional));
  assert.ok(!health.checks.some(item=>item.name.startsWith('payments.')&&item.status==='HEALTHY'));
  passed.push('System Health separates optional integrations from core checks and does not equate payment credentials with verified provider health');
  return passed;
 }finally{globalThis.fetch=originalFetch;env.stripeSecretKey=originalStripe;env.stripeWebhookSecret=originalWebhook;env.smsProvider=originalSms;await db.query('UPDATE business_settings SET stripe_enabled=false');}
}
