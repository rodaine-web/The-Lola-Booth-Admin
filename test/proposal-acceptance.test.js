import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../server/src/db/pool.js';
import { acceptProposal, INVOICE_HANDOFF_JOB } from '../server/src/services/proposal-acceptance-service.js';
const req={headers:{'user-agent':'QA'},ip:'127.0.0.1'};
function database(t,{status='SENT',version=true,expired=false,queueFailure=false}={}) {
  const calls=[];
  let proposal={id:'proposal',status,proposal_number:'QA-1'};
  const run=async(sql,args=[])=>{
    calls.push({sql,args});
    if (sql.startsWith('SELECT * FROM proposals')) return {rows:[proposal]};
    if (sql.startsWith('SELECT id FROM proposal_versions')) return {rows:version?[{id:'version'}]:[]};
    if (sql.startsWith('UPDATE proposals')) {if(expired)return {rows:[]};proposal={...proposal,status:'ACCEPTED',accepted_version_id:args[4]};return {rows:[proposal]};}
    if (queueFailure && sql.startsWith('INSERT INTO automation_jobs')) throw new Error('Queue unavailable');
    return {rows:[],rowCount:0};
  };
  t.mock.method(pool,'connect',async()=>({query:run,release(){}}));
  t.mock.method(pool,'query',run);
  const prior=process.env.BOOKING_INVOICE_HANDOFF_ENABLED;
  process.env.BOOKING_INVOICE_HANDOFF_ENABLED='true';
  t.after(()=>{if(prior===undefined)delete process.env.BOOKING_INVOICE_HANDOFF_ENABLED;else process.env.BOOKING_INVOICE_HANDOFF_ENABLED=prior;});
  return calls;
}
test('acceptance persists the accepted version and durable invoice job in one commit; replay queues nothing',async t=>{
  const calls=database(t);
  const first=await acceptProposal('proposal','QA Client',req);
  assert.equal(first.proposal.accepted_version_id,'version');
  assert.equal(first.duplicate,false);
  const replay=await acceptProposal('proposal','QA Client',req);
  assert.equal(replay.duplicate,true);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO automation_jobs')).length,1);
  assert.equal(calls.find(x=>x.sql.startsWith('INSERT INTO automation_jobs')).args[0],INVOICE_HANDOFF_JOB);
  assert.ok(calls.findIndex(x=>x.sql.startsWith('INSERT INTO automation_jobs'))<calls.findIndex(x=>x.sql==='COMMIT'));
  assert.ok(calls.find(x=>x.sql.startsWith('SELECT * FROM proposals')).sql.includes('FOR UPDATE'));
});
test('converted proposals are harmless acceptance retries',async t=>{
  const calls=database(t,{status:'CONVERTED'});
  assert.equal((await acceptProposal('proposal','QA Client',req)).duplicate,true);
  assert.equal(calls.some(x=>x.sql.startsWith('INSERT INTO automation_jobs')),false);
});
test('expired, draft and unversioned proposals cannot accept or queue an invoice',async t=>{
  for(const [options,code] of [[{expired:true},'PROPOSAL_EXPIRED'],[{status:'DRAFT'},'PROPOSAL_NOT_ACCEPTABLE'],[{version:false},'PROPOSAL_VERSION_REQUIRED']]) {
    const calls=database(t,options);
    await assert.rejects(acceptProposal('proposal','QA Client',req),{code});
    assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
    assert.equal(calls.some(x=>x.sql.startsWith('INSERT INTO automation_jobs')),false);
  }
});
test('queue failure rolls acceptance back instead of losing the automatic handoff',async t=>{
  const calls=database(t,{queueFailure:true});
  await assert.rejects(acceptProposal('proposal','QA Client',req),/Queue unavailable/);
  assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
  assert.equal(calls.some(x=>x.sql==='COMMIT'),false);
});
test('disabled handoff preserves acceptance without activating historical automation',async t=>{
  const calls=database(t);process.env.BOOKING_INVOICE_HANDOFF_ENABLED='false';
  assert.equal((await acceptProposal('proposal','QA Client',req)).duplicate,false);
  assert.equal(calls.some(x=>x.sql.startsWith('INSERT INTO automation_jobs')),false);
});
