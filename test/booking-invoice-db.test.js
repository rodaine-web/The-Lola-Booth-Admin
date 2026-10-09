import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';

test('disposable PostgreSQL: concurrent acceptance and invoice conversion preserve one accepted price', {skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL}, async()=>{
  const target=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(target.hostname),'Only disposable local PostgreSQL is permitted');
  assert.ok(target.pathname.startsWith('/lola_phase1_qa_'),'Use a dedicated Phase 1 QA database');
  const schema='lifecycle_'+crypto.randomBytes(8).toString('hex');
  const bootstrap=new pg.Pool({connectionString:target.toString()});
  let pool;
  try {
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    target.searchParams.set('options',`-c search_path=${schema},public`);
    process.env.DATABASE_URL=target.toString();process.env.NODE_ENV='test';delete process.env.APP_ENV;
    process.env.BOOKING_INVOICE_HANDOFF_ENABLED='true';process.env.BOOKING_AGREEMENT_HANDOFF_ENABLED='true';
    const db=await import('../server/src/db/pool.js');pool=db.pool;
    const {query,transaction}=db;
    const directory=new URL('../server/migrations/',import.meta.url);
    for(const filename of (await fs.readdir(directory)).filter(x=>x.endsWith('.sql')).sort())
      await transaction(async()=>query(await fs.readFile(new URL(filename,directory),'utf8')));
    await query("INSERT INTO business_settings(business_name) VALUES('Disposable QA')");
    const contact=(await query("INSERT INTO clients(name,email) VALUES('Lifecycle QA','qa@example.invalid') RETURNING id")).rows[0];
    const event=(await query("INSERT INTO events(client_id,event_name,event_type,event_date,start_time,end_time,status) VALUES($1,'Lifecycle QA','Wedding','2030-11-10','18:00','23:00','PENDING_DEPOSIT') RETURNING id",[contact.id])).rows[0];
    const agreed={total:1000,pricing_snapshot:{total:1000,deposit_amount:300,tax_rate:0},line_items_snapshot:[{description:'Accepted experience',quantity:1,unit_price:1000}],content:{}};
    const proposal=(await query(`INSERT INTO proposals(client_id,proposal_number,status,total,pricing_snapshot,line_items_snapshot,content,secure_token,event_id)
      VALUES($1,'QA-P1','SENT',1000,$2,$3,$4,$5,$6) RETURNING *`,[contact.id,agreed.pricing_snapshot,JSON.stringify(agreed.line_items_snapshot),agreed.content,crypto.randomBytes(24).toString('hex'),event.id])).rows[0];
    const version=(await query('INSERT INTO proposal_versions(proposal_id,version_number,snapshot) VALUES($1,1,$2) RETURNING id',[proposal.id,{...proposal,...agreed}])).rows[0];
    const {acceptProposal}=await import('../server/src/services/proposal-acceptance-service.js');
    const {createInvoice}=await import('../server/src/services/invoice-service.js');
    const req={user:{},headers:{},ip:'127.0.0.1'};
    const accepted=await Promise.all(Array.from({length:12},()=>acceptProposal(proposal.id,'QA Client',req)));
    assert.equal(accepted.filter(x=>!x.duplicate).length,1);
    assert.equal((await query("SELECT count(*)::int n FROM automation_jobs WHERE job_type='BOOKING_SEND_ACCEPTED_INVOICE' AND related_entity_id=$1",[proposal.id])).rows[0].n,1);
    assert.equal((await query('SELECT accepted_version_id FROM proposals WHERE id=$1',[proposal.id])).rows[0].accepted_version_id,version.id);
    // Simulate later mutable pricing corruption: conversion must still use the accepted version.
    await query("UPDATE proposals SET total=2000,pricing_snapshot=$2,line_items_snapshot=$3 WHERE id=$1",[proposal.id,{total:2000,deposit_amount:600,tax_rate:0},JSON.stringify([{description:'Changed live price',quantity:1,unit_price:2000}])]);
    const converted=await Promise.all(Array.from({length:12},()=>createInvoice({...req,body:{proposal_id:proposal.id,depositOnly:true}})));
    assert.equal(new Set(converted.map(x=>x.id)).size,1);
    assert.equal(Number(converted[0].total),1000);
    assert.equal(Number(converted[0].pricing_snapshot.amount_due_now),300);
    assert.equal((await query('SELECT count(*)::int n FROM invoices WHERE proposal_id=$1',[proposal.id])).rows[0].n,1);
    assert.equal((await query('SELECT count(*)::int n FROM invoice_items WHERE invoice_id=$1',[converted[0].id])).rows[0].n,1);
    assert.equal((await acceptProposal(proposal.id,'QA Client',req)).duplicate,true);
    const {reconcileInvoice,applyBookingConfirmationPolicy}=await import('../server/src/services/payment-reconciliation-service.js');
    await query("UPDATE invoices SET status='SENT' WHERE id=$1",[converted[0].id]);
    const payment=(await query(`INSERT INTO payments(invoice_id,event_id,client_id,amount,payment_method,payment_date,status)
      VALUES($1,$2,$3,300,'CARD',current_date,'PENDING') RETURNING id`,[converted[0].id,event.id,contact.id])).rows[0];
    const jobCount=async()=>Number((await query("SELECT count(*)::int n FROM automation_jobs WHERE job_type='BOOKING_SEND_PAID_AGREEMENT' AND related_entity_id=$1",[proposal.id])).rows[0].n);
    await reconcileInvoice(converted[0].id);
    assert.equal(await jobCount(),0,'Pending payment cannot trigger an agreement');
    await query("UPDATE payments SET status='SUCCEEDED',amount=299.99 WHERE id=$1",[payment.id]);
    await reconcileInvoice(converted[0].id);
    assert.equal(await jobCount(),0,'Payment below thirty percent cannot trigger an agreement');
    await query('UPDATE payments SET amount=300 WHERE id=$1',[payment.id]);
    await Promise.all(Array.from({length:8},()=>reconcileInvoice(converted[0].id)));
    assert.equal(await jobCount(),1,'Repeated verified payment reconciliation queues one agreement');
    assert.equal(await applyBookingConfirmationPolicy(event.id),null,'Payment alone cannot confirm a managed booking');
    const {createContract}=await import('../server/src/services/contract-service.js');
    const contract=await createContract(proposal.id,{title:'QA immutable agreement',terms:'QA agreement terms for the accepted service'},req);
    assert.equal(Number(contract.snapshot.total),1000,'Agreement retains the accepted price, not changed live proposal pricing');
    assert.equal(contract.snapshot.accepted_version_id,version.id);
    assert.equal(await applyBookingConfirmationPolicy(event.id),null,'Draft agreement cannot confirm a managed booking');
    const {updateContract}=await import('../server/src/services/contract-service.js');
    const {BOOKING_AGREEMENT_TITLE,BOOKING_AGREEMENT_TERMS}=await import('../shared/booking-agreement-terms.js');
    const {deliverPaidAgreement}=await import('../server/src/services/booking-agreement-handoff-service.js');
    const job=(await query("SELECT * FROM automation_jobs WHERE job_type='BOOKING_SEND_PAID_AGREEMENT' AND related_entity_id=$1",[proposal.id])).rows[0];
    await assert.rejects(deliverPaidAgreement(job),{code:'AGREEMENT_TERMS_REVIEW'},'A different manual draft requires review instead of being silently overwritten');
    await updateContract(contract.id,{title:BOOKING_AGREEMENT_TITLE,terms:BOOKING_AGREEMENT_TERMS},req);
    process.env.INTEGRATION_SECRET_KEY='qa-disposable-only-secret-value-at-least-32-characters';
    let sends=0;
    const sendEmail=async message=>{
      sends++;
      assert.equal(message.to,'qa@example.invalid');
      assert.equal((await pool.query('SELECT status FROM contracts WHERE id=$1',[contract.id])).rows[0].status,'ISSUED');
      assert.equal((await pool.query('SELECT count(*)::int n FROM contract_deliveries WHERE contract_id=$1',[contract.id])).rows[0].n,1,'Delivery claim persists before the external send');
      return {status:'SENT',deliveredExternally:true,provider:'QA',providerMessageId:'qa-only'};
    };
    assert.equal((await deliverPaidAgreement(job,{sendEmail})).status,'SENT_TO_PROVIDER');
    assert.equal((await deliverPaidAgreement(job,{sendEmail})).status,'SENT_TO_PROVIDER');
    assert.equal(sends,1,'Agreement retry cannot deliver twice');
    assert.equal((await query('SELECT count(*)::int n FROM contracts WHERE proposal_id=$1',[proposal.id])).rows[0].n,1,'Agreement retry cannot generate a duplicate contract');
    assert.equal(await applyBookingConfirmationPolicy(event.id),null,'An issued but unsigned agreement cannot confirm booking');
    await query("UPDATE payments SET status='REFUNDED',refunded_amount=300 WHERE id=$1",[payment.id]);
    await reconcileInvoice(converted[0].id);
    assert.equal((await deliverPaidAgreement(job,{sendEmail})).cancelled,true,'Refunded payment invalidates the agreement handoff');
    assert.equal(sends,1);
    await query("UPDATE invoices SET status='REFUNDED' WHERE id=$1",[converted[0].id]);
    const other=await createInvoice({...req,body:{client_id:contact.id,event_id:event.id,items:[{description:'Other event charge',quantity:1,unit_price:50}]}});
    await query("UPDATE invoices SET status='PAID',amount_paid=50,amount_outstanding=0,balance_due=0 WHERE id=$1",[other.id]);
    assert.equal(await applyBookingConfirmationPolicy(event.id),null,'Another paid invoice cannot bypass a refunded managed booking');


  } finally {
    if(pool)await pool.end();
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();
  }
});
