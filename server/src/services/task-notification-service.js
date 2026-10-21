import {query,transaction} from '../db/pool.js';
import {createCommunicationDraft,brandedEmailHtml} from './automation-service.js';
import {stagingJobsPaused,stagingAutomationScope} from '../config/staging-safety.js';
import {env} from '../config/env.js';

/** Existing communication worker owns dispatch/retry; no historical notification backfill. */
export async function queueTaskNotifications(){
 const since=process.env.TASK_NOTIFICATIONS_SINCE;
 if(process.env.TASK_NOTIFICATIONS_ENABLED!=='true'||!Number.isFinite(Date.parse(since||''))||stagingJobsPaused())return {queued:0,paused:true};
 const scope=stagingAutomationScope();
 return transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('task-notifications'))");
  const rows=(await client.query(`SELECT t.*,u.email,u.name,(now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date AS today
   FROM tasks t JOIN users u ON u.id=t.assigned_user_id
   WHERE t.status IN ('OPEN','IN_PROGRESS') AND t.deleted_at IS NULL AND u.active AND u.deleted_at IS NULL
    AND (NOT EXISTS(SELECT 1 FROM task_notification_ledger l WHERE l.task_id=t.id AND l.assignment_version=t.assignment_version AND l.kind='ASSIGNED')
     OR (t.assigned_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM task_notification_ledger l WHERE l.task_id=t.id AND l.assignment_version=t.assignment_version AND l.kind='REMINDER' AND l.period=(now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date::text)))
    AND t.assigned_at>=$1 AND ($2::timestamptz IS NULL OR (t.assigned_at>=$2 AND (cardinality($3::text[])=0 OR lower(u.email)=ANY($3::text[]))))
   ORDER BY t.assigned_at,t.id LIMIT 200 FOR UPDATE OF t SKIP LOCKED`,[since,scope?.since||null,scope?.recipients||[]])).rows;
  let queued=0;
  for(const task of rows){
   const assigned=(await client.query("SELECT 1 FROM task_notification_ledger WHERE task_id=$1 AND assignment_version=$2 AND kind='ASSIGNED'",[task.id,task.assignment_version])).rowCount;
   const kind=assigned?'REMINDER':'ASSIGNED',period=kind==='ASSIGNED'?'assignment':task.today;
   if(assigned&&Date.now()-new Date(task.assigned_at).getTime()<86400000)continue;
   const ledger=(await client.query(`INSERT INTO task_notification_ledger(task_id,assigned_user_id,assignment_version,kind,period)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,[task.id,task.assigned_user_id,task.assignment_version,kind,period])).rows[0];
   if(!ledger)continue;
   const url=env.clientOrigin.replace(/\/$/,'')+'/operations/tasks';
   const body=`Hi ${task.name||'there'},\n\n${kind==='ASSIGNED'?'A task has been assigned to you':'Reminder: your task remains open'}: ${task.title}\n${task.description||''}\nDue: ${task.due_date||'Not specified'}\n\n${url}`;
   const message=await createCommunicationDraft({recipient:task.email,subject:`${kind==='ASSIGNED'?'Task assigned':'Task reminder'} — ${task.title}`,body,
    html:brandedEmailHtml(body,{kicker:'Your LOLA task',ctaLabel:'View tasks',ctaUrl:url}),status:'SCHEDULED',send_mode:'SCHEDULED',scheduled_at:new Date().toISOString(),trigger_key:'TASK_ASSIGNMENT_NOTIFICATION'});
   await client.query('UPDATE communications SET idempotency_key=$2 WHERE id=$1',[message.id,'task-notification:'+ledger.id]);
   await client.query('UPDATE task_notification_ledger SET communication_id=$2 WHERE id=$1',[ledger.id,message.id]);queued++;
  }
  return {queued,paused:false};
 });
}
