import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

test('complete migration chain supports V1.1 agreements, email records and scoped workspace', {skip:!process.env.V11_TEST_DATABASE_URL},async()=>{
 const target=new URL(process.env.V11_TEST_DATABASE_URL);
 assert.ok(['localhost','127.0.0.1'].includes(target.hostname),'Only a disposable local database is allowed.');
 process.env.DATABASE_URL=process.env.V11_TEST_DATABASE_URL;process.env.NODE_ENV='test';delete process.env.APP_ENV;
 const {pool,query,transaction}=await import('../server/src/db/pool.js');
 const agreements=await import('../server/src/services/contract-service.js');
 const {sendContract}=await import('../server/src/services/contract-delivery-service.js');
 const {workspaceAccess,publicWorkspace}=await import('../server/src/services/client-workspace-service.js');
 try{await transaction(async()=>{
  const schema=`v11_full_${crypto.randomBytes(8).toString('hex')}`;
  await query(`CREATE SCHEMA ${schema}`);await query(`SET LOCAL search_path TO ${schema},public`);
  const dir=new URL('../server/migrations/',import.meta.url);
  for(const file of (await fs.readdir(dir)).filter(file=>file.endsWith('.sql')).sort())await query(await fs.readFile(new URL(file,dir),'utf8'));
  const user=(await query("INSERT INTO users(name,email,password_hash) VALUES('V11 QA','v11@example.com','test-only') RETURNING id")).rows[0];
  const client=(await query("INSERT INTO clients(name,email) VALUES('Demo Client','demo@example.com') RETURNING id")).rows[0];
  const proposal=(await query("INSERT INTO proposals(proposal_number,client_id,status,total,secure_token,line_items_snapshot) VALUES('V11-DB-DEMO',$1,'ACCEPTED',1099,'proposal-demo-token',$2) RETURNING id",[client.id,JSON.stringify([{description:'360 Signature',quantity:1,unit_price:1099}])])).rows[0];
  const req={user,ip:'127.0.0.1',headers:{'user-agent':'CI database verification'}};
  const draft=await agreements.createContract(proposal.id,{title:'QA service agreement',terms:'Demo approved service terms for database verification only.'},req);
  const issued=await agreements.issueContract(draft.id,req);
  const send=async()=>({status:'SENT',provider:'test',providerMessageId:'ci-test',deliveredExternally:true});
  assert.equal((await sendContract(draft.id,req,{send})).status,'SENT_TO_PROVIDER');
  assert.equal((await sendContract(draft.id,req,{send})).replayed,true);
  assert.equal((await query("SELECT count(*)::int AS n FROM communications WHERE proposal_id=$1",[proposal.id])).rows[0].n,1);
  const signed=await agreements.signContract(issued.signing_url.split('/').at(-1),{name:'Demo Client',email:'demo@example.com',consent:true,documentHash:issued.document_hash},req);
  assert.equal(signed.status,'SIGNED');
  const access=await workspaceAccess(proposal.id,req);
  const view=await publicWorkspace(access.url.split('/').at(-1));
  assert.equal(view.agreements.length,1);assert.equal(view.agreements[0].status,'SIGNED');assert.equal(view.invoices.length,0);
  const stored=(await query('SELECT token_ciphertext FROM contract_access_credentials WHERE contract_id=$1',[draft.id])).rows[0];
  assert.ok(!JSON.stringify(stored).includes(issued.signing_url.split('/').at(-1)));
  await query(`DROP SCHEMA ${schema} CASCADE`);
 });}finally{await pool.end();}
});
