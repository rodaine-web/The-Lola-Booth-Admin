import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';

test('disposable PostgreSQL: custom quote scope, immutable acceptance, invoice and net payment',
  {skip: !process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL}, async () => {
    const url = new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(url.pathname.startsWith('/lola_phase1_qa_'));
    const schema = 'quote_' + crypto.randomBytes(8).toString('hex');
    const bootstrap = new pg.Pool({connectionString: url.toString()});
    let pool;
    try {
      await bootstrap.query(`CREATE SCHEMA ${schema}`);
      url.searchParams.set('options', `-c search_path=${schema},public`);
      process.env.DATABASE_URL = url.toString();
      process.env.NODE_ENV = 'test';
      delete process.env.APP_ENV;
      process.env.EMAIL_PROVIDER = 'development';
      const db = await import('../server/src/db/pool.js'); pool = db.pool;
      for (const name of (await fs.readdir(new URL('../server/migrations/', import.meta.url))).filter(x => x.endsWith('.sql')).sort())
        await db.transaction(async () => db.query(await fs.readFile(new URL('../server/migrations/' + name, import.meta.url), 'utf8')));
      await db.query("INSERT INTO business_settings(business_name) VALUES('Quote QA')");
      const client = (await db.query("INSERT INTO clients(name,email) VALUES('Quote QA','qa@example.invalid') RETURNING id")).rows[0];
      const event = (await db.query("INSERT INTO events(event_name,client_id,event_type,event_date,status) VALUES('No real event',$1,'WEDDING','2030-12-15','CONFIRMED') RETURNING id", [client.id])).rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      await db.query("INSERT INTO event_planning(event_id,client_id,backdrop_path,token_hash,expires_at) VALUES($1,$2,'CUSTOM',$3,now()+interval '1 hour')", [event.id,client.id,crypto.createHash('sha256').update(token).digest('hex')]);
      const req = {user:{id:null,permissions:['*']},headers:{}};
      const service = await import('../server/src/services/backdrop-quote-service.js');
      const planning = await import('../server/src/services/event-planning-service.js');
      const quote = await service.issueBackdropQuote(event.id,{description:'Custom design scope',total:250,requiredPayment:250},req);
      const invoice = (await db.query("INSERT INTO invoices(invoice_number,event_id,client_id,status,total,balance_due) VALUES('QUOTE-QA',$1,$2,'SENT',250,250) RETURNING id",[event.id,client.id])).rows[0];
      await assert.rejects(service.linkBackdropInvoice(event.id,invoice.id,req), {code:'QUOTE_ACCEPTANCE_REQUIRED'});
      await service.acceptBackdropQuote(token,quote.id,'QA signer',req);
      await assert.rejects(db.query('UPDATE backdrop_quotes SET total=300 WHERE id=$1',[quote.id]), {code:'23514'});
      await planning.selectPlanningBackdrop(token,{path:'OWN'},req);
      await assert.rejects(service.linkBackdropInvoice(event.id,invoice.id,req), {code:'QUOTE_ACCEPTANCE_REQUIRED'});
      assert.equal(await service.publicBackdropQuote(token),null,'Stale scope is not presented to the client');
      await planning.selectPlanningBackdrop(token,{path:'CUSTOM'},req);
      const mismatch = (await db.query("INSERT INTO invoices(invoice_number,event_id,client_id,status,total,balance_due) VALUES('WRONG-QUOTE',$1,$2,'SENT',249,249) RETURNING id",[event.id,client.id])).rows[0];
      await assert.rejects(service.linkBackdropInvoice(event.id,mismatch.id,req), {code:'QUOTE_INVOICE_MISMATCH'});
      await service.linkBackdropInvoice(event.id,invoice.id,req);
      await assert.rejects(planning.selectPlanningBackdrop(token,{path:'OWN'},req), {code:'QUOTE_INVOICE_LOCKED'});
      await assert.rejects(service.assertBackdropPayment(event.id,client.id), {code:'BACKDROP_PAYMENT_REQUIRED'});
      const payment = (await db.query("INSERT INTO payments(event_id,client_id,invoice_id,amount,payment_method,payment_date,status) VALUES($1,$2,$3,250,'CARD',current_date,'PENDING') RETURNING id",[event.id,client.id,invoice.id])).rows[0];
      await assert.rejects(service.assertBackdropPayment(event.id,client.id), {code:'BACKDROP_PAYMENT_REQUIRED'});
      await db.query("UPDATE payments SET status='SUCCEEDED' WHERE id=$1",[payment.id]);
      assert.equal(await service.assertBackdropPayment(event.id,client.id),true);
      await db.query("UPDATE payments SET status='PARTIALLY_REFUNDED',refunded_amount=1 WHERE id=$1",[payment.id]);
      await assert.rejects(service.assertBackdropPayment(event.id,client.id), {code:'BACKDROP_PAYMENT_REQUIRED'});
      await assert.rejects(service.voidBackdropQuote(event.id,quote.id,req),{code:'QUOTE_INVOICE_LOCKED'});
      await db.query("UPDATE invoices SET status='VOID' WHERE id=$1",[invoice.id]);
      await assert.rejects(service.voidBackdropQuote(event.id,quote.id,req),{code:'QUOTE_INVOICE_LOCKED'},'Invoice void alone cannot erase money still held');
      await db.query("UPDATE payments SET status='REFUNDED',refunded_amount=amount WHERE id=$1",[payment.id]);
      assert.equal(await service.voidBackdropQuote(event.id,quote.id,req),null);
      await planning.selectPlanningBackdrop(token,{path:'OWN'},req);
      const history=(await db.query('SELECT status,invoice_id,accepted_by FROM backdrop_quotes WHERE id=$1',[quote.id])).rows[0];
      assert.deepEqual(history,{status:'VOID',invoice_id:invoice.id,accepted_by:'QA signer'},'Resolved quote keeps commercial history');
      assert.equal((await db.query("SELECT count(*)::int n FROM backdrops WHERE status='INACTIVE' AND image_url IS NULL AND quantity=0")).rows[0].n,10);
    } finally {
      if(pool) await pool.end();
      await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await bootstrap.end();
    }
  });
