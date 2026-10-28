import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';import pg from 'pg';
test('active work views, event reminder digests and short-notice invoices use persisted workflow',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.match(url.pathname,/qa/);const base=new pg.Pool({connectionString:url.toString()}),schema='active_qa_'+crypto.randomBytes(5).toString('hex');let pool,server;
 try{await base.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'active-qa-secret-at-least-thirty-two-characters',EMAIL_PROVIDER:'development',PORT:'0',TASK_NOTIFICATIONS_ENABLED:'true',TASK_NOTIFICATIONS_SINCE:'2020-01-01'});
 const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db,one=async(sql,args=[])=>(await query(sql,args)).rows[0];for(const file of (await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8')));

 await query("INSERT INTO business_settings(business_name,timezone) VALUES('ACTIVE QA','America/Chicago')");
 const owner=await one("INSERT INTO users(name,email,password_hash) VALUES('QA Owner','staff@qa.invalid','not-a-login') RETURNING id");
 const customer=await one("INSERT INTO clients(name,email) VALUES('Active QA','active@qa.invalid') RETURNING id");
 const past=await one("INSERT INTO clients(name,email) VALUES('Past QA','past@qa.invalid') RETURNING id");
 const event=await one("INSERT INTO events(event_name,event_type,event_date,client_id,status) VALUES('Future QA','Wedding',business_today()+200,$1,'CONFIRMED') RETURNING *",[customer.id]);
 await query("INSERT INTO events(event_name,event_type,event_date,client_id,status) VALUES('Past QA','Wedding',business_today()-1,$1,'COMPLETED')",[past.id]);
 assert.equal((await one('SELECT client_work_active($1) active',[customer.id])).active,true);assert.equal((await one('SELECT client_work_active($1) active',[past.id])).active,false);
 for(const title of ['Assign staff','Assign event equipment'])await query("INSERT INTO tasks(title,event_id,assigned_user_id,assigned_at,due_date) VALUES($1,$2,$3,now()-interval '2 days',business_today()-1)",[title,event.id,owner.id]);
 const paymentTask=await one("INSERT INTO tasks(title,event_id,assigned_user_id,assigned_at,due_date) VALUES('Collect invoice payment',$1,$2,now()-interval '2 days',business_today()) RETURNING *",[event.id,owner.id]);
 assert.equal((await one('SELECT count(*)::int n FROM tasks t WHERE task_work_actionable(t)')).n,1);
 const {queueTaskNotifications}=await import('../server/src/services/task-notification-service.js');await queueTaskNotifications();await queueTaskNotifications();
 const summaries=(await query("SELECT c.* FROM communications c JOIN task_notification_ledger l ON l.communication_id=c.id WHERE l.period LIKE 'event-month:%'")).rows;assert.equal(summaries.length,1);assert.match(summaries[0].rendered_body,/Assign staff/);assert.match(summaries[0].rendered_body,/Assign event equipment/);
 const {dispatchDecision}=await import('../server/src/services/communication-dispatch-policy.js');assert.equal(await dispatchDecision({query},summaries[0]),'SEND');
 await query("UPDATE events SET event_date=business_today()+30 WHERE id=$1",[event.id]);assert.equal(await dispatchDecision({query},summaries[0]),'CANCELLED','Queued monthly summary is obsolete when cadence changes');await queueTaskNotifications();
 assert.equal((await one("SELECT count(*)::int n FROM task_notification_ledger WHERE period LIKE 'event-week:%'")).n,1);
 assert.equal((await one("SELECT count(*)::int n FROM tasks t WHERE task_work_actionable(t)")).n,3);
 for(const [days,prefix] of [[31,'event-month:'],[30,'event-week:'],[8,'event-week:'],[7,new Date().toISOString().slice(0,4)]]){await query('UPDATE events SET event_date=business_today()+$2::int WHERE id=$1',[event.id,days]);const period=(await one("SELECT task_reminder_period(t) p FROM tasks t WHERE title='Assign staff'")).p;assert.ok(period.startsWith(prefix));}
 await query("UPDATE events SET status='COMPLETED' WHERE id=$1",[event.id]);assert.equal((await one('SELECT event_work_active($1) active',[event.id])).active,true,'New closeout keeps delivery follow-up active');assert.equal((await one("SELECT task_reminder_period(t) p FROM tasks t WHERE title='Assign staff'")).p,null);
 await query('UPDATE event_closeouts SET closed_at=now() WHERE event_id=$1',[event.id]);assert.equal((await one('SELECT event_work_active($1) active',[event.id])).active,false);
 const short=await one("INSERT INTO events(event_name,event_type,event_date,client_id) VALUES('SHORT NOTICE QA','Wedding',business_today()+7,$1) RETURNING id",[customer.id]);
 const {createInvoice,getInvoice}=await import('../server/src/services/invoice-service.js');const invoice=await createInvoice({body:{client_id:customer.id,event_id:short.id,depositOnly:true,items:[{description:'QA service',quantity:1,unit_price:100}]},user:owner});assert.equal(invoice.pricing_snapshot.amount_due_now,100);assert.equal(invoice.pricing_snapshot.full_payment_required,true);
 await query("UPDATE invoices SET due_date=business_today()+7,status='SENT' WHERE id=$1",[invoice.id]);
 assert.ok((await getInvoice(invoice.id)).effective_due_date<=(await one('SELECT business_today()::text today')).today,'Even a legacy later invoice due date cannot allow partial checkout');
 const {publicPaymentOptions}=await import('../server/src/services/payment-service.js');const options=await publicPaymentOptions(await getInvoice(invoice.id));assert.equal(options.depositAvailable,false);assert.equal(options.allowCustomAmount,false);assert.equal(options.amountDue,100);
 const {buildProposalSnapshot}=await import('../server/src/services/proposal-service.js');const snapshot=await buildProposalSnapshot({client_id:customer.id,event_id:short.id,custom_line_items:[{description:'QA service',quantity:1,unit_price:100}],deposit_value:30});assert.equal(snapshot.pricing.deposit_value,100);assert.equal(snapshot.pricing.deposit_amount,snapshot.pricing.total);assert.equal(snapshot.pricing.balance,0);assert.match(snapshot.content.terms,/within 14 days/);
 if(process.env.ACTIVE_WORK_PDF_QA){const {generateProposalPdf,generateInvoicePdf}=await import('../server/src/services/document-service.js');await fs.writeFile('/tmp/lola-short-notice-proposal.pdf',await generateProposalPdf({...snapshot,pricing_snapshot:snapshot.pricing,line_items_snapshot:snapshot.lineItems,proposal_number:'QA-SHORT-NOTICE',event_name:'Short notice QA',client_name:'QA Client'}));await fs.writeFile('/tmp/lola-short-notice-invoice.pdf',await generateInvoicePdf(await getInvoice(invoice.id)));}
 await query('UPDATE clients SET sales_qualified=true');
 await query("INSERT INTO permissions(key) VALUES('*') ON CONFLICT DO NOTHING");await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[owner.id]);
 ({server}=await import('../server/src/index.js'));if(!server.listening)await new Promise(r=>server.once('listening',r));const jwt=(await import('jsonwebtoken')).default;
 const api=async path=>{const result=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{headers:{Authorization:'Bearer '+jwt.sign({sub:owner.id},process.env.JWT_SECRET)}});assert.equal(result.status,200);return (await result.json()).data;};
 assert.deepEqual((await api('/clients?status=ACTIVE')).map(x=>x.id),[customer.id]);assert.deepEqual((await api('/clients?status=PAST')).map(x=>x.id),[past.id]);assert.equal((await api('/clients?status=ALL')).length,2);
 assert.deepEqual((await api('/events?status=ACTIVE')).map(x=>x.id),[short.id]);assert.equal((await api('/events?status=ALL')).length,3);assert.equal((await api('/events?status=COMPLETED')).length,2);
 assert.equal((await api('/tasks?status=ACTIVE')).some(x=>x.title==='Assign staff'),false);assert.equal((await api('/tasks?status=ALL')).some(x=>x.title==='Assign staff'),true);


 }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();await base.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await base.end();}
});
