import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../server/src/db/pool.js';
import {env} from '../server/src/config/env.js';
import {sendProposal} from '../server/src/services/proposal-service.js';

test('proposal send returns success after committing HTML delivery without generating a PDF attachment', async()=>{
  const originalQuery=pool.query,originalConnect=pool.connect,originalProvider=env.emailProvider,originalAppEnv=process.env.APP_ENV;
  const calls=[];
  const query=async(sql,params=[])=>{calls.push({sql,params});return {rows:sql.includes('INSERT INTO communications')?[{id:'communication-qa'}]:[]};};
  pool.query=query;pool.connect=async()=>({query,release(){calls.push({sql:'RELEASE'});}});
  env.emailProvider='development';process.env.APP_ENV='development';
  try{
    const result=await sendProposal({body:{},user:{id:'owner-qa'}},{id:'proposal-qa',secure_token:'qa-test-only-token',client_name:'Demo Lead',client_email:'demo@example.invalid',proposal_number:'QA-1001',event_name:'Demo Wedding'});
    assert.equal(result.email.status,'SENT');assert.equal(result.email.deliveredExternally,false);
    assert.deepEqual(result.email.attachments,[]);assert.equal(result.document,undefined);
    assert.ok(calls.some(row=>row.sql==='COMMIT'));
    assert.ok(!calls.some(row=>row.sql==='ROLLBACK'));
    assert.ok(calls.some(row=>row.sql.includes("SET status='SENT'")));
    const communication=calls.find(row=>row.sql.includes('INSERT INTO communications'));
    assert.match(communication.params[10],/View Your Proposal/);
    assert.match(communication.params[10],/Download PDF/);
    assert.match(communication.params[10],/qa-test-only-token\?download=pdf/);
    assert.ok(calls.some(row=>row.sql.includes('INSERT INTO proposal_deliveries')));
    assert.ok(calls.some(row=>row.sql.includes('INSERT INTO email_messages')));
  }finally{
    pool.query=originalQuery;pool.connect=originalConnect;env.emailProvider=originalProvider;
    if(originalAppEnv===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=originalAppEnv;
  }
});
