import {query,transaction} from '../db/pool.js';
import {createCommunicationDraft} from './automation-service.js';
import {decryptSecretJson} from './integration-secrets.js';
import {env} from '../config/env.js';
import {lockBookingReservations} from './booking-hold-service.js';
import {stagingJobsPaused,stagingAutomationScope} from '../config/staging-safety.js';

// Opt in only after queue inventory, recipient policy and delivery qualification.
// At most three reminders per grant/version, spaced three days apart.
export async function queuePlanningReminders(){
 if(process.env.PLANNING_REMINDERS_ENABLED!=='true'||stagingJobsPaused())return {queued:0,paused:true};
 const scope=stagingAutomationScope();
 return transaction(async()=>{
  await lockBookingReservations();
  const planning=(await query(`SELECT p.id,p.event_id,p.client_id,p.token_hash AS grant_version,p.token_ciphertext,c.email,c.name,e.event_name,
   LEAST(2,GREATEST(0,(current_date-COALESCE(p.planning_due_at,p.invited_at::date+3))/3))::int AS period
   FROM event_planning p JOIN events e ON e.id=p.event_id JOIN clients c ON c.id=p.client_id AND c.id=e.client_id
   WHERE p.submitted_at IS NULL AND p.invited_at IS NOT NULL AND p.revoked_at IS NULL AND p.expires_at>now()
    AND p.token_hash IS NOT NULL AND p.token_ciphertext IS NOT NULL AND e.deleted_at IS NULL AND c.deleted_at IS NULL
    AND e.status IN ('CONFIRMED','PREPARING','READY') AND e.event_date>=current_date
    AND current_date>=COALESCE(p.planning_due_at,p.invited_at::date+3)
    AND ($1::timestamptz IS NULL OR (p.invited_at>=$1 AND lower(c.email)=ANY($2::text[])))
   ORDER BY p.planning_due_at LIMIT 25 FOR UPDATE OF p SKIP LOCKED`,[scope?.since||null,scope?.recipients||[]])).rows;
  const creative=(await query(`SELECT a.id,a.event_id,a.client_id,a.version::text AS grant_version,a.public_token,c.email,c.name,e.event_name,
   LEAST(2,GREATEST(0,(current_date-a.requested_at::date-3)/3))::int AS period
   FROM creative_approvals a JOIN events e ON e.id=a.event_id JOIN clients c ON c.id=a.client_id AND c.id=e.client_id
   WHERE a.deleted_at IS NULL AND a.status IN ('PENDING_APPROVAL','VIEWED') AND a.expires_at>now() AND a.public_token IS NOT NULL
    AND current_date>=a.requested_at::date+3 AND e.deleted_at IS NULL AND c.deleted_at IS NULL
    AND e.status IN ('CONFIRMED','PREPARING','READY') AND e.event_date>=current_date
    AND ($1::timestamptz IS NULL OR (a.requested_at>=$1 AND lower(c.email)=ANY($2::text[])))
   ORDER BY a.requested_at LIMIT 25 FOR UPDATE OF a SKIP LOCKED`,[scope?.since||null,scope?.recipients||[]])).rows;
  let queued=0;
  for(const [kind,rows] of [['PLANNING',planning],['CREATIVE',creative]])for(const row of rows){
   if(!row.email)continue;
   const ledger=(await query(`INSERT INTO planning_reminder_ledger(event_id,kind,entity_id,grant_version,period)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,[row.event_id,kind,row.id,row.grant_version,row.period])).rows[0];
   if(!ledger)continue;
   const token=kind==='PLANNING'?decryptSecretJson(row.token_ciphertext).token:row.public_token;
   const managed=(await query('SELECT booking_journey_managed($1) AS managed',[row.event_id])).rows[0]?.managed;
   const url=managed?env.clientOrigin.replace(/\/$/,'')+'/client':`${env.clientOrigin.replace(/\/$/,'')}/${kind==='PLANNING'?'client':'approvals'}/${token}`;
   const action=kind==='PLANNING'?'complete your event planning':'review your current creative proof';
   const communication=await createCommunicationDraft({event_id:row.event_id,client_id:row.client_id,recipient:row.email,
    subject:`A reminder for ${row.event_name}`,body:`Hi ${row.name?.split(' ')[0]||'there'},\n\nPlease ${action} for ${row.event_name}.\n\n${url}\n\nThank you,\nThe LOLA Booth`,
    channel:'EMAIL',status:'SCHEDULED',send_mode:'SCHEDULED',scheduled_at:new Date().toISOString(),trigger_key:'PLANNING_RECURRING_REMINDER'});
   await query('UPDATE communications SET idempotency_key=$1 WHERE id=$2',[`planning-reminder:${ledger.id}`,communication.id]);
   await query('UPDATE planning_reminder_ledger SET communication_id=$1 WHERE id=$2',[communication.id,ledger.id]);queued++;
  }
  return {queued,paused:false};
 });
}
