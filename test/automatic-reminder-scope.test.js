import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../server/src/db/pool.js';
import {queueDueReminders} from '../server/src/services/integration-jobs-service.js';
import {processDueJobs} from '../server/src/services/automation-service.js';
test('staging reminders select fresh QA records; scheduled dispatch excludes backlog and obsolete reminders',async()=>{
 const keys=['APP_ENV','STAGING_AUTOMATIONS_ENABLED','STAGING_AUTOMATIONS_SINCE','STAGING_EMAIL_ENABLED','STAGING_EMAIL_ALLOWLIST'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const originalQuery=pool.query,originalConnect=pool.connect;const calls=[];
 const query=async(sql,params=[])=>{calls.push({sql,params});return {rows:[]};};pool.query=query;pool.connect=async()=>({query,release(){}});
 try{
  Object.assign(process.env,{APP_ENV:'staging',STAGING_AUTOMATIONS_ENABLED:'true',STAGING_AUTOMATIONS_SINCE:'2026-10-04T12:00:00Z',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_ALLOWLIST:'qa@example.invalid'});
  await queueDueReminders();assert.equal(calls.length,2);
  for(const call of calls){assert.deepEqual(call.params,['2026-10-04T12:00:00.000Z',['qa@example.invalid']]);assert.match(call.sql,/created_at >= \$1/);assert.match(call.sql,/lower\(c.email\)=ANY/);}
  calls.length=0;await processDueJobs();
  assert.ok(!calls.some(c=>c.sql.includes('FROM automation_jobs j')));
  const due=calls.find(c=>c.sql.includes('SELECT id FROM communications'));assert.deepEqual(due.params,[25,'2026-10-04T12:00:00.000Z',['qa@example.invalid']]);
  const cancel=calls.find(c=>c.sql.includes("SET status='CANCELLED'"));assert.match(cancel.sql,/PAID/);assert.match(cancel.sql,/COMPLETED/);
  calls.length=0;delete process.env.STAGING_AUTOMATIONS_SINCE;assert.deepEqual(await queueDueReminders(),[]);assert.equal(calls.length,0);await assert.rejects(()=>processDueJobs(),e=>e.code==='STAGING_AUTOMATIONS_PAUSED');
 }finally{pool.query=originalQuery;pool.connect=originalConnect;for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
