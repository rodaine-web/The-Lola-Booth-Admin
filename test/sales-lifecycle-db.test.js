import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';

// Independent disposable schema; never connects to a hosted customer database.
test('sales lifecycle: lost verdict, expiry, task stop, client promotion and paid protection',{skip:!process.env.CRM_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.match(url.pathname,/lola_.*(test|qa)/);
 const db=new pg.Client({connectionString:url.toString()});await db.connect();
 const schema='sales_qa_'+crypto.randomBytes(8).toString('hex');
 try{
  await db.query('BEGIN');await db.query('CREATE SCHEMA '+schema);await db.query('SET LOCAL search_path TO '+schema+',public');
  const dir=new URL('../server/migrations/',import.meta.url);
  for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.query(await fs.readFile(new URL(file,dir),'utf8'));
  const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  const lead=await row("INSERT INTO leads(first_name,last_name,email,status) VALUES('Lost','QA','lost@qa.invalid','PROPOSAL_SENT') RETURNING *");
  const client=await row("INSERT INTO clients(name,email,referral_source,sales_qualified) VALUES('Lost QA','lost@qa.invalid','Website request',false) RETURNING *");
  assert.equal((await row('SELECT contact_type FROM crm_contacts WHERE id=$1',[client.contact_id])).contact_type,'PROSPECT');
  const event=await row("INSERT INTO events(client_id,event_name,event_date,event_type,status) VALUES($1,'Lost QA','2030-10-15','Corporate','PENDING_DEPOSIT') RETURNING *",[client.id]);
  await db.query('UPDATE leads SET converted_client_id=$2,converted_event_id=$3 WHERE id=$1',[lead.id,client.id,event.id]);
  const proposal=await row("INSERT INTO proposals(lead_id,client_id,event_id,proposal_number,status,secure_token,valid_through) VALUES($1,$2,$3,'LOST-QA','SENT','qa-only','2030-10-15') RETURNING *",[lead.id,client.id,event.id]);
  const task=await row("INSERT INTO tasks(title,lead_id,proposal_id,status) VALUES('Await acceptance',$1,$2,'IN_PROGRESS') RETURNING *",[lead.id,proposal.id]);
  const hold=await row("INSERT INTO booking_holds(event_id,expires_at) VALUES($1,now()+interval '1 day') RETURNING *",[event.id]);
  await db.query("INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,scheduled_for) VALUES('SEND_EMAIL_TEMPLATE','proposal',$1,now()+interval '1 day')",[proposal.id]);
  await db.query("UPDATE leads SET status='LOST' WHERE id=$1",[lead.id]);
  assert.equal((await row('SELECT status FROM proposals WHERE id=$1',[proposal.id])).status,'DECLINED');
  const closed=await row('SELECT * FROM tasks WHERE id=$1',[task.id]);assert.equal(closed.status,'CANCELLED');assert.equal(closed.closure_reason,'Lead marked Lost');
  assert.equal((await row('SELECT status FROM events WHERE id=$1',[event.id])).status,'CANCELLED');
  assert.equal((await row('SELECT status FROM booking_holds WHERE id=$1',[hold.id])).status,'RELEASED');
  assert.equal((await row('SELECT status FROM automation_jobs WHERE related_entity_id=$1',[proposal.id])).status,'CANCELLED');
  await db.query("UPDATE tasks SET status='OPEN' WHERE id=$1",[task.id]);assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[task.id])).status,'CANCELLED');
  const newTask=await row("INSERT INTO tasks(title,lead_id) VALUES('Late automation',$1) RETURNING *",[lead.id]);assert.equal(newTask.status,'CANCELLED');
  assert.equal((await row('SELECT count(*)::int n FROM reporting_clients WHERE id=$1',[client.id])).n,0);
  assert.equal((await row('SELECT count(*)::int n FROM reporting_events WHERE id=$1',[event.id])).n,0);
  // A reopened lead never resurrects old follow-ups.
  await db.query("UPDATE leads SET status='NEW' WHERE id=$1",[lead.id]);assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[task.id])).status,'CANCELLED');
  const expiring=await row("INSERT INTO proposals(proposal_number,status,secure_token,valid_through) VALUES('EXPIRY-QA','SENT','expiry-qa',current_date-1) RETURNING *");
  const expTask=await row("INSERT INTO tasks(title,proposal_id) VALUES('Expired follow-up',$1) RETURNING *",[expiring.id]);assert.equal(expTask.status,'CANCELLED');
  await db.query('SELECT reconcile_sales_lifecycle()');assert.equal((await row('SELECT status FROM proposals WHERE id=$1',[expiring.id])).status,'EXPIRED');
  // WON and client qualification are distinct from confirmation/resource assignment.
  await db.query("UPDATE leads SET status='WON' WHERE id=$1",[lead.id]);assert.equal((await row('SELECT sales_qualified FROM clients WHERE id=$1',[client.id])).sales_qualified,true);
  assert.equal((await row('SELECT contact_type FROM crm_contacts WHERE id=$1',[client.contact_id])).contact_type,'CLIENT');
  const invoice=await row("INSERT INTO invoices(invoice_number,lead_id,client_id,event_id,proposal_id,status,total,amount_paid) VALUES('PAID-QA',$1,$2,$3,$4,'PARTIAL',100,30) RETURNING *",[lead.id,client.id,event.id,proposal.id]);
  await db.query('SAVEPOINT protected');await assert.rejects(db.query("UPDATE leads SET status='LOST' WHERE id=$1",[lead.id]),/cancellation workflow/);await db.query('ROLLBACK TO SAVEPOINT protected');assert.equal((await row('SELECT status FROM leads WHERE id=$1',[lead.id])).status,'WON');assert.equal((await row('SELECT amount_paid FROM invoices WHERE id=$1',[invoice.id])).amount_paid,'30.00');
  await db.query('ROLLBACK');
 }finally{await db.end();}
});
