import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import {once} from 'node:events';
import jwt from 'jsonwebtoken';

test('proposal review: published prices, concurrent sends, read-only copies and safe retries',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const target=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.match(target.pathname,/lola_.*qa/);
 const schema='review_'+crypto.randomBytes(8).toString('hex'),bootstrap=new pg.Pool({connectionString:target.toString()});let pool,server;
 try{
  await bootstrap.query(`CREATE SCHEMA ${schema}`);target.searchParams.set('options',`-c search_path=${schema},public`);
  Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',APP_ENV:'test',PORT:'0',JWT_SECRET:'disposable-only-qa-jwt-not-for-real-use',EMAIL_PROVIDER:'development',INTEGRATION_SECRET_KEY:'disposable-qa-only-secret-at-least-32-characters'});
  const db=await import('../server/src/db/pool.js');pool=db.pool;
  const {query,transaction}=db;const dir=new URL('../server/migrations/',import.meta.url);
  for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL(file,dir),'utf8')));
  await query("INSERT INTO business_settings(business_name) VALUES('QA only')");
  const row=async(sql,args=[])=>(await query(sql,args)).rows[0];
  const user=await row("INSERT INTO users(name,email,password_hash) VALUES('QA','owner@qa.invalid','qa-only') RETURNING id");
  const client=await row("INSERT INTO clients(name,email) VALUES('QA Client','primary@qa.invalid') RETURNING id");
  const {createProposalVersion,getProposal}=await import('../server/src/services/proposal-service.js');
  const {saveSentProposalRevision,sendReviewedProposal,latestProposalDelivery}=await import('../server/src/services/proposal-review-service.js');
  const {acceptProposal}=await import('../server/src/services/proposal-acceptance-service.js');
  const req={user:{id:user.id},headers:{},ip:'127.0.0.1'};
  let serial=0;
  async function fixture(){const p=await row("INSERT INTO proposals(client_id,proposal_number,status,total,pricing_snapshot,line_items_snapshot,content,secure_token,valid_through,sent_at) VALUES($1,$2,'SENT',1000,$3,$4,$5,$6,'2035-10-15',now()) RETURNING *",[client.id,'QA-'+(++serial),{total:1000,deposit_amount:300},JSON.stringify([{description:'Original',quantity:1,unit_price:1000}]),{},crypto.randomBytes(24).toString('hex')]);const v=await transaction(c=>createProposalVersion(c,p,user.id));await query('UPDATE proposals SET published_version_id=$2 WHERE id=$1',[p.id,v.id]);return {...p,published_version_id:v.id};}
  async function revision(p){await saveSentProposalRevision({...req,body:{client_id:client.id,custom_line_items:[{description:'Negotiated experience',quantity:1,unit_price:800}],valid_through:'2035-10-15',customer_notes:'We need an 8 by 8 foot space. Travel is included.',notes:'PRIVATE INTERNAL ONLY'}},await getProposal(p.id));return getProposal(p.id);}
  const p=await fixture(),edited=await revision(p);assert.equal(Number((await getProposal(p.secure_token,{publicView:true})).total),1000);assert.equal(Number(edited.total),800);assert.equal(edited.has_unsent_revision,true);
  const sends=[];const deliver=async message=>{sends.push(message);await new Promise(r=>setTimeout(r,15));return {provider:'QA',providerMessageId:crypto.randomUUID(),deliveredExternally:false};};
  const body={requestId:crypto.randomUUID(),versionId:edited.review_version_id,recipients:['primary@qa.invalid','copy@qa.invalid']};
  await assert.rejects(sendReviewedProposal({...req,body:{...body,requestId:crypto.randomUUID(),versionId:p.published_version_id}},p.id,{deliver}),{code:'PROPOSAL_REVIEW_STALE'});
  const result=await Promise.all(Array.from({length:8},()=>sendReviewedProposal({...req,body},p.id,{deliver})));assert.ok(result.some(r=>r.status==='COMPLETE'));assert.equal(sends.length,2);assert.match(sends[0].subject,/update to your Proposal/);for(const m of sends){assert.match(m.body,/8 by 8 foot space/);assert.doesNotMatch(m.body,/PRIVATE INTERNAL/);}assert.equal((await row('SELECT snapshot FROM proposal_versions WHERE id=$1',[edited.review_version_id])).snapshot.content.customer_notes,'We need an 8 by 8 foot space. Travel is included.');
  const published=await row('SELECT * FROM proposals WHERE id=$1',[p.id]);assert.equal(Number(published.total),800);assert.equal(published.draft_version_id,null);assert.equal(published.published_version_id,edited.review_version_id);
  await assert.rejects(getProposal(p.secure_token,{publicView:true}),{code:'NOT_FOUND'});
  const copyUrl=sends.find(m=>m.to==='copy@qa.invalid').body.match(/https?:\/\/\S+\/proposal\/([a-f0-9]+)/)?.[1];assert.ok(copyUrl);
  const copy=await getProposal(copyUrl,{publicView:true});assert.equal(copy.view_only,true);assert.equal(copy.secure_token,copyUrl);assert.equal(JSON.stringify(copy).includes(published.secure_token),false);
  ({server}=await import('../server/src/index.js'));if(!server.listening)await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  const copied=await fetch(`${origin}/api/public/proposals/${copyUrl}`);assert.equal(copied.status,200);const copiedJson=await copied.json();assert.equal(copiedJson.proposal.view_only,true);assert.equal(JSON.stringify(copiedJson).includes(published.secure_token),false);
  for(const action of ['accept','decline']){const denied=await fetch(`${origin}/api/public/proposals/${copyUrl}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({acceptedByName:'Copy QA'})});assert.equal(denied.status,403);}
  const viewer=jwt.sign({sub:user.id},process.env.JWT_SECRET);assert.equal((await fetch(`${origin}/api/proposals/${p.id}/send`,{method:'POST',headers:{'authorization':`Bearer ${viewer}`,'content-type':'application/json'},body:JSON.stringify(body)})).status,403,'Sales permission is enforced');
  await assert.rejects(acceptProposal(p.id,'Copy QA',{...req,params:{token:copyUrl}}),{code:'PROPOSAL_LINK_REPLACED'});
  await acceptProposal(p.id,'QA',{...req,params:{token:published.secure_token}});await assert.rejects(revision(p),{code:'PROPOSAL_NOT_EDITABLE'});
  // The primary may accept the previously published offer while an unsent revision exists.
  const old=await fixture();await revision(old);await acceptProposal(old.id,'QA',{...req,params:{token:old.secure_token}});const accepted=await row('SELECT * FROM proposals WHERE id=$1',[old.id]);assert.equal(accepted.accepted_version_id,old.published_version_id);assert.equal(Number(accepted.total),1000);assert.equal(accepted.draft_version_id,null);
  // A failed copy retries alone, even after primary acceptance.
  const partial=await fixture(),draft=await revision(partial);let copyFail=true,primarySends=0,copySends=0;
  const partiallyDeliver=async m=>{if(m.to.startsWith('primary'))primarySends++;else{copySends++;if(copyFail){const e=new Error('confirmed provider rejection');e.code='QA_REJECTED';e.details={status:400,outcomeUnknown:false};throw e;}}return {provider:'QA',providerMessageId:crypto.randomUUID()};};
  const partialBody={requestId:crypto.randomUUID(),versionId:draft.review_version_id,recipients:body.recipients};assert.equal((await sendReviewedProposal({...req,body:partialBody},partial.id,{deliver:partiallyDeliver})).status,'PARTIAL');
  const live=await row('SELECT secure_token FROM proposals WHERE id=$1',[partial.id]);await acceptProposal(partial.id,'QA',{...req,params:{token:live.secure_token}});copyFail=false;
  assert.equal((await sendReviewedProposal({...req,body:partialBody},partial.id,{deliver:partiallyDeliver})).status,'COMPLETE');assert.equal(primarySends,1);assert.equal(copySends,2);
  // A timeout has an unknown outcome; neither retry nor a new request resends it.
  const uncertain=await fixture();const unknownBody={requestId:crypto.randomUUID(),versionId:uncertain.published_version_id,recipients:['primary@qa.invalid']};let uncertainSends=0;
  const timeout=async()=>{uncertainSends++;throw new Error('transport timeout');};assert.equal((await sendReviewedProposal({...req,body:unknownBody},uncertain.id,{deliver:timeout})).status,'UNKNOWN');
  assert.equal((await sendReviewedProposal({...req,body:unknownBody},uncertain.id,{deliver:timeout})).status,'UNKNOWN');await assert.rejects(sendReviewedProposal({...req,body:{...unknownBody,requestId:crypto.randomUUID()}},uncertain.id,{deliver:timeout}),{code:'PROPOSAL_DELIVERY_UNCERTAIN'});assert.equal(uncertainSends,1);assert.equal((await latestProposalDelivery(uncertain.id)).recipients[0].status,'UNKNOWN');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();}
});
