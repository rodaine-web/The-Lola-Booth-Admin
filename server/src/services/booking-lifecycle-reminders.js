import {query,transaction} from '../db/pool.js';
import {stagingJobsPaused,stagingAutomationScope} from '../config/staging-safety.js';
import {createCommunicationDraft} from './automation-service.js';
import {contractSigningUrl} from './contract-service.js';
import {env} from '../config/env.js';

export async function queueBookingLifecycleReminders(){
 if(process.env.BOOKING_LIFECYCLE_REMINDERS_ENABLED!=='true'||stagingJobsPaused())return {queued:0,paused:true};
 const scope=stagingAutomationScope();
 return transaction(async()=>{
  await query("SELECT pg_advisory_xact_lock(hashtext('booking-lifecycle-reminders'))");
  await query(`UPDATE tasks t SET status='DONE',updated_at=now() WHERE t.status IN ('OPEN','IN_PROGRESS') AND
   (((t.lifecycle_key LIKE 'agreement-sign:%' OR t.lifecycle_key LIKE 'agreement-escalation:%') AND EXISTS(SELECT 1 FROM contracts k WHERE k.id::text=split_part(t.lifecycle_key,':',2) AND k.status='SIGNED'))
    OR (t.lifecycle_key LIKE 'booking-balance:%' AND EXISTS(SELECT 1 FROM invoices i WHERE i.id::text=split_part(t.lifecycle_key,':',2) AND i.status='PAID')))`);
  await query(`UPDATE tasks t SET status='CANCELLED',updated_at=now() WHERE t.lifecycle_key IS NOT NULL AND t.status IN ('OPEN','IN_PROGRESS')
   AND EXISTS(SELECT 1 FROM events e WHERE e.id=t.event_id AND (e.deleted_at IS NOT NULL OR e.status='CANCELLED'))`);
  const contracts=(await query(`SELECT k.*,p.event_id,p.client_id,c.email FROM contracts k JOIN proposals p ON p.id=k.proposal_id
   JOIN clients c ON c.id=p.client_id LEFT JOIN events e ON e.id=p.event_id
   WHERE k.status='ISSUED' AND k.signing_due_at IS NOT NULL AND p.deleted_at IS NULL AND c.deleted_at IS NULL
    AND (e.id IS NULL OR (e.deleted_at IS NULL AND e.status<>'CANCELLED'))
    AND k.snapshot->>'accepted_version_id'=p.accepted_version_id::text
    AND ($1::timestamptz IS NULL OR (k.issued_at>=$1 AND (cardinality($2::text[])=0 OR lower(c.email)=ANY($2::text[]))))
   ORDER BY k.signing_due_at LIMIT 100 FOR UPDATE OF k SKIP LOCKED`,[scope?.since||null,scope?.recipients||[]])).rows;
  const invoices=(await query(`SELECT i.*,c.email,e.event_name FROM invoices i JOIN clients c ON c.id=i.client_id JOIN events e ON e.id=i.event_id
   WHERE i.deleted_at IS NULL AND c.deleted_at IS NULL AND e.deleted_at IS NULL AND e.status<>'CANCELLED'
    AND i.status NOT IN ('DRAFT','VOID','PAID','REFUNDED') AND i.amount_outstanding>0 AND booking_journey_managed(e.id)
    AND ($1::timestamptz IS NULL OR (i.created_at>=$1 AND (cardinality($2::text[])=0 OR lower(c.email)=ANY($2::text[]))))
   ORDER BY i.due_date LIMIT 100 FOR UPDATE OF i SKIP LOCKED`,[scope?.since||null,scope?.recipients||[]])).rows;
  let queued=0;
  async function todo(key,title,row,due){await query(`INSERT INTO tasks(lifecycle_key,title,description,event_id,client_id,due_date,priority)
    VALUES($1,$2,'Review the booking record and contact the client. Do not cancel automatically.',$3,$4,$5,'HIGH') ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING`,[key,title,row.event_id,row.client_id,due]);}
  async function reminder(kind,row,offset,when,url,text){
   if(new Date(when)>new Date())return;
   const due=kind==='SIGNATURE'?new Date(row.signing_due_at).toISOString():String(row.due_date);
   const key=`booking-reminder:${kind}:${row.id}:${due}:${offset}`;
   if((await query('SELECT 1 FROM communications WHERE idempotency_key=$1',[key])).rowCount)return;
   const message=await createCommunicationDraft({event_id:row.event_id,client_id:row.client_id,proposal_id:row.proposal_id,invoice_id:kind==='BALANCE'?row.id:null,
    recipient:row.email,subject:kind==='SIGNATURE'?'Your LOLA agreement needs your signature':'Your LOLA booking balance',body:text+'\n\n'+url+'\n\nThe LOLA Booth',
    status:'SCHEDULED',send_mode:'SCHEDULED',scheduled_at:new Date().toISOString(),trigger_key:kind==='SIGNATURE'?'BOOKING_SIGNATURE_REMINDER':'BOOKING_BALANCE_REMINDER'});
   await query('UPDATE communications SET idempotency_key=$2 WHERE id=$1',[message.id,key]);queued++;
  }
  for(const row of contracts){
   await todo('agreement-sign:'+row.id,'Client agreement signature required',row,new Date(row.signing_due_at).toISOString().slice(0,10));
   if(new Date(row.signing_grace_until)<=new Date()){
    await todo('agreement-escalation:'+row.id,'Review overdue agreement — management decision required',row,new Date().toISOString().slice(0,10));continue;
   }
   const url=await contractSigningUrl(row.id);
   // At most the most recent due reminder is queued; delayed activation never backfills every missed reminder.
   const due=(await query(`SELECT day,((signing_due_at AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))+(day-5)*interval '1 day') AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago') AS at
    FROM contracts CROSS JOIN unnest(ARRAY[2,4,5,8,11]) AS day WHERE id=$1 ORDER BY day DESC`,[row.id])).rows.find(item=>new Date(item.at)<=new Date());
   if(due)await reminder('SIGNATURE',row,due.day,due.at,url,`Please review and sign your agreement. Signing due date: ${new Date(row.signing_due_at).toLocaleDateString('en-US',{timeZone:'America/Chicago'})}. Your booking still requires confirmed payment and availability.`);
  }
  for(const row of invoices){
   const dates=(await query(`SELECT ((due_date+time '12:00') AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago')) AS deadline,
    due_date<(now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date-7 AS escalated FROM invoices WHERE id=$1`,[row.id])).rows[0];
   if(dates.escalated)await todo('booking-balance:'+row.id,'Review overdue booking balance — management decision required',row,row.due_date);
   const due=(await query(`SELECT day,((due_date-day+time '12:00') AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago')) AS at FROM invoices CROSS JOIN unnest(ARRAY[1,3,5]) AS day WHERE id=$1 ORDER BY day`,[row.id])).rows.find(item=>new Date(item.at)<=new Date());
   if(due)await reminder('BALANCE',row,due.day,due.at,env.clientOrigin.replace(/\/$/,'')+'/client',`Your remaining balance is due ${row.due_date}. Sign in to review your invoice and payment options. Payments already verified reduce your outstanding balance.`);
  }
  return {queued,paused:false};
 });
}
