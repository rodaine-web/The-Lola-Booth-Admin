import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';

test('legacy booking links: audited repair restores finance and confirmation without changing signed documents',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const target=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.ok(target.pathname.startsWith('/lola_phase1_qa_'));
 const bootstrap=new pg.Pool({connectionString:target.toString()}),schema='linkrepair_'+crypto.randomBytes(8).toString('hex');let pool,server;
 try{
  await bootstrap.query(`CREATE SCHEMA ${schema}`);target.searchParams.set('options',`-c search_path=${schema},public`);
  process.env.DATABASE_URL=target.toString();process.env.NODE_ENV='test';process.env.JWT_SECRET='local-link-repair-fixture-only-secret';process.env.PORT='0';delete process.env.APP_ENV;
  process.env.EMAIL_PROVIDER='development';process.env.BOOKING_WORKSPACE_HANDOFF_ENABLED='false';
  const db=await import('../server/src/db/pool.js');pool=db.pool;const{query,transaction}=db;
  const dir=new URL('../server/migrations/',import.meta.url);for(const file of(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL(file,dir),'utf8')));
  await query("INSERT INTO business_settings(business_name) VALUES('Local link-repair QA')");
  const user=(await query("INSERT INTO users(name,email,password_hash) VALUES('QA Admin','repair@example.invalid','not-a-login') RETURNING id")).rows[0];
  const req={user:{id:user.id,roles:['ADMIN']},headers:{},ip:'127.0.0.1'};
  const client=(await query("INSERT INTO clients(name,email) VALUES('Synthetic paid client','paid@example.invalid') RETURNING id")).rows[0];
  const event=(await query("INSERT INTO events(client_id,event_name,event_type,event_date,status) VALUES($1,'Synthetic Sunday event','Birthday','2030-11-10','TENTATIVE') RETURNING id",[client.id])).rows[0];
  const lead=(await query("INSERT INTO leads(first_name,last_name,email,event_type,status,converted_client_id,converted_event_id) VALUES('Synthetic','QA','paid@example.invalid','Birthday','WON',$1,$2) RETURNING id",[client.id,event.id])).rows[0];
  const proposal=(await query("INSERT INTO proposals(client_id,lead_id,proposal_number,status,total,content) VALUES($1,$2,'QA-LINK-P','CONVERTED',1000,'{}') RETURNING id",[client.id,lead.id])).rows[0];
  const version=(await query('INSERT INTO proposal_versions(proposal_id,version_number,snapshot) VALUES($1,1,$2) RETURNING id',[proposal.id,{total:1000,line_items_snapshot:[]}])).rows[0];
  await query('UPDATE proposals SET accepted_version_id=$2,accepted_at=now() WHERE id=$1',[proposal.id,version.id]);
  const invoice=(await query("INSERT INTO invoices(client_id,proposal_id,invoice_number,status,total,amount_paid,amount_outstanding,balance_due,pricing_snapshot) VALUES($1,$2,'QA-LINK-I','PAID',1000,1000,0,0,$3) RETURNING id",[client.id,proposal.id,{accepted_version_id:version.id,payment_mode:'DEPOSIT_REQUEST',amount_due_now:300}])).rows[0];
  const pay=(await query("INSERT INTO payments(invoice_id,client_id,amount,payment_method,payment_date,status) VALUES($1,$2,1000,'CARD',current_date,'SUCCEEDED') RETURNING id",[invoice.id,client.id])).rows[0];
  const contract=(await query("INSERT INTO contracts(proposal_id,revision,status,title,terms,snapshot,document_hash,signed_at,signer_name) VALUES($1,1,'SIGNED','QA signed agreement','Immutable QA terms',$2,'immutable-qa-document-hash',now(),'Synthetic QA') RETURNING *",[proposal.id,{accepted_version_id:version.id,event_name:'Synthetic Sunday event',total:1000}])).rows[0];
  const {linkEventBooking}=await import('../server/src/services/event-booking-links.js');
  await assert.rejects(linkEventBooking(event.id,proposal.id,{...req,user:{id:user.id,roles:['ATTENDANT']}}),{code:'FORBIDDEN'});
  const other=(await query("INSERT INTO events(client_id,event_name,event_type,event_date) VALUES($1,'Unrelated booking','Birthday','2030-11-10') RETURNING id",[client.id])).rows[0];
  await assert.rejects(linkEventBooking(other.id,proposal.id,req),{code:'BOOKING_LINK_REVIEW'},'Same client alone never authorises a match');
  const result=await linkEventBooking(event.id,proposal.id,req);assert.equal(result.status,'CONFIRMED');
  for(const [table,id]of[['proposals',proposal.id],['invoices',invoice.id],['payments',pay.id]])assert.equal((await query(`SELECT event_id FROM ${table} WHERE id=$1`,[id])).rows[0].event_id,event.id);
  assert.equal((await query('SELECT * FROM contracts WHERE id=$1',[contract.id])).rows[0].document_hash,contract.document_hash);
  assert.equal(Number((await query('SELECT amount FROM payments WHERE id=$1',[pay.id])).rows[0].amount),1000);
  assert.equal((await query("SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1 AND action='event_booking_links_reviewed' AND actor_user_id=$2",[event.id,user.id])).rows[0].n,1);
  const {getEventOperations}=await import('../server/src/services/event-operations-service.js');
  const operations=await getEventOperations(event.id,req.user);assert.equal(operations.event.amount_paid,1000);assert.equal(operations.readiness.items.find(i=>i.label==='Required deposit paid').status,'COMPLETE');
  assert.equal((await linkEventBooking(event.id,proposal.id,req)).status,'CONFIRMED','Repeated repair is safe');
  assert.equal((await query('SELECT count(*)::int n FROM payments WHERE invoice_id=$1',[invoice.id])).rows[0].n,1);
  await query("INSERT INTO roles(name) VALUES('ADMIN') ON CONFLICT DO NOTHING");
  await query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='ADMIN'",[user.id]);
  await query("INSERT INTO permissions(key) VALUES('*') ON CONFLICT DO NOTHING");
  await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[user.id]);
  ({server}=await import('../server/src/index.js'));if(!server.listening)await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const token=jwt.sign({sub:user.id},process.env.JWT_SECRET);
  async function api(path,body,auth=token){const response=await fetch(origin+'/api'+path,{method:'PATCH',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
  const path='/events/'+event.id;
  assert.equal((await api(path,{start_time:'16:00',end_time:'20:00'},null)).status,401);
  const edited=await api(path,{start_time:'16:00',end_time:'20:00',setup_time:'15:00',breakdown_time:'21:00',event_type:'Birthday',guest_count:60});
  assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.status,'CONFIRMED','Editing details must not reset booking confirmation');assert.equal(edited.data.start_time,'16:00:00');assert.equal(edited.data.end_time,'20:00:00');
  assert.equal((await api(path,{end_time:'15:00'})).status,400,'End time cannot precede the saved start time');
  assert.equal((await api(path,{start_time:'25:00'})).status,400,'Invalid clock times fail validation');
  const fresh=await fetch(origin+'/api'+path,{headers:{Authorization:'Bearer '+token}});const detail=await fresh.json();
  assert.equal(detail.amount_paid,1000);assert.equal(detail.operations.readiness.items.find(i=>i.label==='Required deposit paid').status,'COMPLETE');
  // Corrupted cross-event payment metadata is rejected atomically.
  const event2=(await query("INSERT INTO events(client_id,event_name,event_type,event_date) VALUES($1,'Conflicting booking','Birthday','2030-11-11') RETURNING id",[client.id])).rows[0];
  await query('UPDATE payments SET event_id=$2 WHERE id=$1',[pay.id,event2.id]);
  await assert.rejects(linkEventBooking(event.id,proposal.id,req),{code:'BOOKING_LINK_REVIEW'});

 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();}
});
