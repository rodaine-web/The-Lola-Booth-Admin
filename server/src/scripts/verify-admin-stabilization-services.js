// Runs real SQL against a newly-created local database. Never reads deployment credentials.
import fs from 'node:fs/promises';
import pg from 'pg';
import assert from 'node:assert/strict';
const database = `lola_stabilization_${Date.now()}`;
const admin = new pg.Client({host:'/private/tmp',port:55439,database:'postgres'});
await admin.connect(); await admin.query(`CREATE DATABASE ${database}`);
const db = new pg.Client({host:'/private/tmp',port:55439,database}); await db.connect();
const results=[];let pool;
async function check(defect,fn){try{await fn();results.push({defect,status:'PASS'});}catch(e){results.push({defect,status:'FAIL',message:e.message,code:e.code});}}
try {
 for(const file of (await fs.readdir('server/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.query(await fs.readFile('server/migrations/'+file,'utf8'));
 process.env.DATABASE_URL=`postgresql://localhost:55439/${database}?host=/private/tmp`;
 process.env.NODE_ENV='test';process.env.EMAIL_PROVIDER='development';process.env.SMS_PROVIDER='none';
 const {env}=await import('../config/env.js');env.databaseUrl=process.env.DATABASE_URL;env.emailProvider='development';
 ({pool}=await import('../db/pool.js'));
 const {listCommunications}=await import('../services/automation-service.js');
 await check('Communications unfiltered actual joined query',async()=>assert.deepEqual((await listCommunications()).data,[]));
 await check('Communications status actual joined query',async()=>assert.deepEqual((await listCommunications({status:'DRAFT'})).data,[]));
 await check('Database DATE stays a string while timestamps retain instant type',async()=>{const result=(await pool.query("SELECT '2027-12-16'::date AS day,'2027-12-16T00:00:00Z'::timestamptz AS instant")).rows[0];assert.equal(result.day,'2027-12-16');assert.ok(result.instant instanceof Date);});
 const {getInvoice}=await import('../services/invoice-service.js');
 const customer=(await db.query("INSERT INTO clients(name) VALUES('Synthetic historical customer') RETURNING id")).rows[0];
 const legacyInvoice=(await db.query("INSERT INTO invoices(invoice_number,client_id,total,amount_paid,balance_due) VALUES('LEGACY-QA', $1,499,0,499) RETURNING id",[customer.id])).rows[0];
 await check('Legacy invoice read normalizes missing outstanding without inventing items',async()=>{const i=await getInvoice(legacyInvoice.id);assert.equal(Number(i.amount_outstanding),499);assert.equal(i.items.length,0);assert.equal(i.data_quality,'INCOMPLETE_HISTORICAL');});
 const service=await import('../services/automation-service.js');
 await check('Communication draft, edit, rendered preview, filters, pagination and detail',async()=>{
  const a=await service.createCommunicationDraft({recipient:'local@example.invalid',subject:'Original QA',body:'Original body',client_id:customer.id});
  const b=await service.createCommunicationDraft({recipient:'second@example.invalid',subject:'Second QA',body:'Second body'});
  await service.updateCommunicationDraft(a.id,{subject:'Revised QA',rendered_body:'Revised body'});
  const detail=await service.getCommunication(a.id);assert.equal(detail.client_name,'Synthetic historical customer');assert.match(detail.rendered_html,/Revised body/);
  const found=await service.listCommunications({status:'DRAFT',search:'Revised QA'});assert.equal(found.data.length,1);assert.equal(found.data[0].id,a.id);
  const page=await service.listCommunications({pageSize:1,page:2});assert.equal(page.data.length,1);assert.equal(page.pagination.total,2);
  await service.scheduleCommunication(a.id,new Date(Date.now()+3600000).toISOString());assert.equal((await service.getCommunication(a.id)).status,'SCHEDULED');
  await service.cancelCommunication(a.id);await assert.rejects(()=>service.sendCommunication(a.id),/cannot be sent/);
  await assert.rejects(()=>service.scheduleCommunication(b.id,'not a date'),/future schedule/);
 });
 await check('Development email send is single-action under concurrency; failed retry and sent immutability',async()=>{
  const draft=await service.createCommunicationDraft({recipient:'local@example.invalid',subject:'Local send',body:'Development only'});
  const sent=await Promise.all([service.sendCommunication(draft.id),service.sendCommunication(draft.id)]);
  assert.ok(sent.every(r=>r.communication.status==='SENT_TO_PROVIDER'));assert.equal(sent.filter(r=>r.delivery.duplicatePrevented).length,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM email_messages WHERE communication_id=$1',[draft.id])).rows[0].n,1);
  await assert.rejects(()=>service.updateCommunicationDraft(draft.id,{rendered_body:'Cannot change'}),/immutable/);
  await assert.rejects(()=>service.scheduleCommunication(draft.id,new Date(Date.now()+3600000).toISOString()));
  const failed=await service.createCommunicationDraft({recipient:'retry@example.invalid',subject:'Local retry',body:'Development only'});
  await db.query("UPDATE communications SET status='FAILED',failure_message='Synthetic network failure' WHERE id=$1",[failed.id]);
  assert.equal((await service.retryCommunication(failed.id)).communication.status,'SENT_TO_PROVIDER');
 });
 const {invoiceBalanceSql}=await import('../../../shared/invoice-balance.js');
 await check('Invoice SQL and detail balance agree for null, zero and void records',async()=>{
  for(const [status,outstanding,balance] of [['DRAFT',null,499],['PAID',0,499],['VOID',499,499]]) {
   await db.query('UPDATE invoices SET status=$1,amount_outstanding=$2,balance_due=$3 WHERE id=$4',[status,outstanding,balance,legacyInvoice.id]);
   const sql=(await db.query(`SELECT ${invoiceBalanceSql()} AS balance FROM invoices i WHERE id=$1`,[legacyInvoice.id])).rows[0];
   assert.equal(Number(sql.balance),(await getInvoice(legacyInvoice.id)).amount_outstanding);
  }
 });
 await fs.mkdir('audit-output/admin-stabilization',{recursive:true});
 await fs.writeFile(`audit-output/admin-stabilization/services-${process.argv.includes('--baseline')?'before':process.argv.includes('--invoice-baseline')?'invoice-before':'after'}.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
}finally{if(pool)await pool.end();await db.end();await admin.query(`DROP DATABASE ${database}`);await admin.end();}
