import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {pool,query} from '../db/pool.js';import {processStagingQualificationJobs} from '../services/staging-email-qualification-service.js';import {AppError} from '../utils/errors.js';
const url=new URL(process.env.DATABASE_URL||'');if(url.hostname!=='localhost'||url.pathname!=='/lola_goal2_qualification')throw Error('Local QA database only.');
Object.assign(process.env,{APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_ALLOWLIST:'qa@example.invalid'});
const run='local-'+randomUUID(),jobs=[];let calls=0;
try{
 for(const purpose of ['MANUAL','CONTACT_ACK','BOOKING_ACK','PROPOSAL']){
  const c=(await query("INSERT INTO communications(type,channel,direction,recipient,subject,rendered_body,status) VALUES('EMAIL','EMAIL','OUTBOUND','qa@example.invalid','Local mock only','No external delivery','DRAFT') RETURNING id")).rows[0];
  jobs.push((await query('INSERT INTO staging_email_qualification_jobs(run_key,purpose,communication_id) VALUES($1,$2,$3) RETURNING *',[run,purpose,c.id])).rows[0]);
 }
 const select=job=>process.env.STAGING_EMAIL_JOB_IDS=job.id;
 const success=async()=>{calls++;return {};};select(jobs[0]);await processStagingQualificationJobs({sendCommunicationImpl:success});await processStagingQualificationJobs({sendCommunicationImpl:success});assert.equal(calls,1);
 assert.equal((await query('SELECT status FROM staging_email_qualification_jobs WHERE id=$1',[jobs[1].id])).rows[0].status,'PENDING');
 select(jobs[1]);await processStagingQualificationJobs({sendCommunicationImpl:async()=>{throw new AppError('Safe simulated rejection',502,'MICROSOFT_AUTH_REJECTED');}});
 assert.equal((await query('SELECT status FROM staging_email_qualification_jobs WHERE id=$1',[jobs[1].id])).rows[0].status,'FAILED');
 await query("UPDATE staging_email_qualification_jobs SET status='PENDING',history=history||'[{\"status\":\"RETRY_REQUESTED\"}]'::jsonb WHERE id=$1",[jobs[1].id]);await processStagingQualificationJobs({sendCommunicationImpl:success});await processStagingQualificationJobs({sendCommunicationImpl:success});assert.equal(calls,2);
 select(jobs[2]);await processStagingQualificationJobs({sendCommunicationImpl:async()=>{throw new AppError('Simulated ambiguous result',502,'DELIVERY_OUTCOME_UNKNOWN');}});await processStagingQualificationJobs({sendCommunicationImpl:success});assert.equal(calls,2);
 await query("UPDATE staging_email_qualification_jobs SET status='PROCESSING',started_at=now()-interval '10 minutes' WHERE id=$1",[jobs[3].id]);select(jobs[3]);await processStagingQualificationJobs({sendCommunicationImpl:success});assert.equal(calls,2);
 const rows=(await query('SELECT purpose,status,attempt_count,history FROM staging_email_qualification_jobs WHERE run_key=$1 ORDER BY purpose',[run])).rows;
 assert.equal(rows.filter(r=>r.status==='HELD_FOR_REVIEW').length,2);assert.equal(rows.filter(r=>r.status==='COMPLETED').length,2);
 const evidence={mode:'LOCAL MOCK ONLY',externalEmailsSent:0,successfulMockSends:calls,restartNoResend:'PASS',safeFailureRetry:'PASS',ambiguousOutcomeHold:'PASS',staleClaimHold:'PASS',explicitSelection:'PASS',jobs:rows};await fs.writeFile('audit-output/goal2/local-email-queue.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{process.env.STAGING_EMAIL_ENABLED='false';await pool.end();}
