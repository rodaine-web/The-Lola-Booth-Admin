import {query} from '../db/pool.js';
import {isStaging,stagingEmailPolicy} from '../config/staging-safety.js';
import {sendCommunication} from './automation-service.js';
export function selectedQualificationJobs(config=process.env){
 if(!isStaging(config)||config.STAGING_EMAIL_ENABLED!=='true')return [];
 const ids=String(config.STAGING_EMAIL_JOB_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(ids.length>8||ids.some(x=>!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x)))throw Error('Qualification allows at most eight explicit email job IDs.');
 return [...new Set(ids)];
}
export async function processStagingQualificationJobs({sendCommunicationImpl=sendCommunication}={}){
 const ids=selectedQualificationJobs();if(!ids.length)return {processed:[]};
 // A claimed job survives a process restart. Never automatically resend an unknown outcome.
 await query("UPDATE staging_email_qualification_jobs SET status='HELD_FOR_REVIEW',last_error='Worker stopped during delivery; review provider history before retrying.',history=history||jsonb_build_array(jsonb_build_object('status','HELD_FOR_REVIEW','at',now())),updated_at=now() WHERE id=ANY($1::uuid[]) AND status='PROCESSING' AND started_at<now()-interval '5 minutes'",[ids]);
 const claimed=await query(`UPDATE staging_email_qualification_jobs SET status='PROCESSING',attempt_count=attempt_count+1,started_at=now(),updated_at=now(),history=history||jsonb_build_array(jsonb_build_object('status','PROCESSING','at',now())) WHERE id IN (SELECT j.id FROM staging_email_qualification_jobs j JOIN communications c ON c.id=j.communication_id WHERE j.id=ANY($1::uuid[]) AND j.status='PENDING' AND c.deleted_at IS NULL AND (c.scheduled_at IS NULL OR c.scheduled_at<=now()) ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED) RETURNING *`,[ids]);
 const processed=[];
 for(const job of claimed.rows){
  let status='COMPLETED',error=null;
  try{
   const c=(await query('SELECT recipient,cc,bcc,subject FROM communications WHERE id=$1',[job.communication_id])).rows[0];
   stagingEmailPolicy({to:c.recipient,cc:c.cc,bcc:c.bcc,subject:c.subject});
   await sendCommunicationImpl(job.communication_id,{}, {qualificationClaim:true});
  }catch(e){status=e.code==='DELIVERY_OUTCOME_UNKNOWN'||!e.code?'HELD_FOR_REVIEW':'FAILED';error=e.message;}
  await query("UPDATE staging_email_qualification_jobs SET status=$2,last_error=$3,completed_at=CASE WHEN $2='COMPLETED' THEN now() ELSE NULL END,history=history||jsonb_build_array(jsonb_build_object('status',$2::text,'at',now())),updated_at=now() WHERE id=$1 AND status='PROCESSING'",[job.id,status,error]);
  processed.push({id:job.id,status});
 }
 return {processed};
}
