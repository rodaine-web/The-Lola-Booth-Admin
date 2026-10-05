import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {once} from 'node:events';
import jwt from 'jsonwebtoken';

test('V1.1 real API journey: agreement, workspace, development email, signing and revocation', {skip:!process.env.V11_TEST_DATABASE_URL},async()=>{
 const database=new URL(process.env.V11_TEST_DATABASE_URL);
 assert.ok(['localhost','127.0.0.1'].includes(database.hostname),'Only a disposable local database is allowed.');
 const schema=`v11_http_${crypto.randomBytes(8).toString('hex')}`;
 database.searchParams.set('options',`-c search_path=${schema},public`);
 Object.assign(process.env,{DATABASE_URL:database.toString(),NODE_ENV:'test',PORT:'0',EMAIL_PROVIDER:'development',JWT_SECRET:'v11-test-jwt-secret-not-for-real-users'});delete process.env.APP_ENV;
 const {pool}=await import('../server/src/db/pool.js');let server;
 try{
  const setup=await pool.connect();
  try{
   await setup.query('BEGIN');await setup.query(`CREATE SCHEMA ${schema}`);
   const dir=new URL('../server/migrations/',import.meta.url);
   for(const file of (await fs.readdir(dir)).filter(file=>file.endsWith('.sql')).sort())await setup.query(await fs.readFile(new URL(file,dir),'utf8'));
   await setup.query('COMMIT');
  }catch(error){await setup.query('ROLLBACK');throw error;}finally{setup.release();}
  const user=(await pool.query("INSERT INTO users(name,email,password_hash) VALUES('QA Owner','http-qa@example.com','test-only') RETURNING id")).rows[0];
  await pool.query("INSERT INTO permissions(key) VALUES('*') ON CONFLICT(key) DO NOTHING");
  await pool.query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[user.id]);
  const viewer=(await pool.query("INSERT INTO users(name,email,password_hash) VALUES('No Sales','no-sales@example.com','test-only') RETURNING id")).rows[0];
  const client=(await pool.query("INSERT INTO clients(name,email) VALUES('Demo Client','demo@example.com') RETURNING id")).rows[0];
  const proposal=(await pool.query("INSERT INTO proposals(proposal_number,client_id,status,total,secure_token,line_items_snapshot) VALUES('V11-HTTP-DEMO',$1,'ACCEPTED',1099,'proposal-demo-token',$2) RETURNING id",[client.id,JSON.stringify([{description:'360 Signature',quantity:1,unit_price:1099}])])).rows[0];
  ({server}=await import('../server/src/index.js'));if(!server.listening)await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const ownerToken=jwt.sign({sub:user.id},process.env.JWT_SECRET),viewerToken=jwt.sign({sub:viewer.id},process.env.JWT_SECRET);
  async function api(path,{method='GET',body,token=ownerToken}={}){
   const response=await fetch(`${origin}/api${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,data:await response.json()};
  }
  const draft=await api(`/proposals/${proposal.id}/contracts`,{method:'POST',body:{title:'HTTP demo agreement',terms:'Approved demo terms for isolated API verification only.'}});assert.equal(draft.status,201);
  const id=draft.data.id;
  assert.equal((await api(`/contracts/${id}/send`,{method:'POST',token:viewerToken})).status,403);
  const issued=await api(`/contracts/${id}/issue`,{method:'POST'});assert.equal(issued.status,200);
  const agreementToken=issued.data.signing_url.split('/').at(-1);
  const opened=await api(`/public/contracts/${agreementToken}`,{token:null});assert.equal(opened.status,200);assert.ok(!('token_hash' in opened.data));
  assert.equal((await api(`/contracts/${id}/send`,{method:'POST'})).data.status,'DEVELOPMENT_ONLY');
  // Invoice conversion must preserve agreement and workspace eligibility.
  await pool.query("UPDATE proposals SET status='CONVERTED' WHERE id=$1",[proposal.id]);
  const access=await api(`/proposals/${proposal.id}/workspace`,{method:'POST'});assert.equal(access.status,200);
  const workspaceToken=access.data.url.split('/').at(-1);
  const workspace=await api(`/public/workspaces/${workspaceToken}`,{token:null});assert.equal(workspace.status,200);assert.equal(workspace.data.agreements[0].status,'ISSUED');
  const signature={name:'Demo Client',email:'demo@example.com',consent:true,documentHash:issued.data.document_hash};
  assert.equal((await api(`/public/contracts/${agreementToken}/sign`,{method:'POST',body:{...signature,consent:false},token:null})).status,400);
  const signed=await api(`/public/contracts/${agreementToken}/sign`,{method:'POST',body:signature,token:null});assert.equal(signed.data.status,'SIGNED');
  const repeated=await api(`/public/contracts/${agreementToken}/sign`,{method:'POST',body:signature,token:null});assert.equal(repeated.data.signed_at,signed.data.signed_at);
  assert.equal((await api(`/contracts/${id}`,{method:'PATCH',body:{title:'Changed agreement',terms:'This attempted changed document must fail.'}})).status,409);
  const pdf=await fetch(`${origin}/api/public/contracts/${agreementToken}/pdf`);assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/pdf/);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  if(process.env.V11_BROWSER_TEST==='true'){
   const {verifyClientBrowser}=await import('./support/v11-client-browser.js');
   await verifyClientBrowser({api,origin,proposalId:proposal.id,workspaceToken});
  }
  const convertedDraft=await api(`/proposals/${proposal.id}/contracts`,{method:'POST',body:{title:'Converted proposal agreement',terms:'Nonbinding disposable QA terms. No booking or payment commitment.'}});
  assert.equal(convertedDraft.status,201);
  assert.equal((await api(`/contracts/${convertedDraft.data.id}/issue`,{method:'POST'})).status,200);
  await api(`/proposals/${proposal.id}/workspace/revoke`,{method:'POST'});
  assert.equal((await api(`/public/workspaces/${workspaceToken}`,{token:null})).status,404);
  assert.equal((await pool.query('SELECT status FROM proposals WHERE id=$1',[proposal.id])).rows[0].status,'CONVERTED');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
 }
});
