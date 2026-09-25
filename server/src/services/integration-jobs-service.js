import {stagingJobsPaused} from '../config/staging-safety.js';
import crypto from 'node:crypto';
import {MARKETING_PROVIDERS,marketingConfiguration,dispatchMarketing} from './marketing-adapters.js';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';

export const ATTRIBUTION_FIELDS=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid','fbclid','ttclid','ga_client_id','ga_session_id'];
export function attributionFrom(payload={}, {capture=false}={}){
 const touch={};for(const key of ATTRIBUTION_FIELDS)if(typeof payload[key]==='string'&&payload[key].trim())touch[key]=payload[key].trim().slice(0,200);
 if(touch.fbclid){const stamp=Number(payload.fbclid_timestamp);if(Number.isSafeInteger(stamp)&&stamp>0&&stamp<=Date.now())touch.fbclid_timestamp=stamp;else if(capture)touch.fbclid_timestamp=Date.now();}
 for(const [key,source] of [['landing_page',payload.landing_page_url||payload.landing_page],['referrer',payload.referrer_url||payload.referrer]]){try{const u=new URL(source);if(['https:','http:'].includes(u.protocol))touch[key]=u.origin+u.pathname;}catch{}}
 return touch;
}
export async function captureAttribution(leadId,payload){
 const touch=attributionFrom(payload,{capture:true});if(!Object.keys(touch).length)return;
 await query("UPDATE leads SET first_touch=CASE WHEN first_touch='{}'::jsonb THEN $1 ELSE first_touch END,latest_touch=$1 WHERE id=$2",[JSON.stringify(touch),leadId]);
}
export async function enqueueIntegrationEvent({provider,eventName,entityType,entityId,payload={},idempotencyKey}){
 if(!['GA4','META','TIKTOK','LINKEDIN','TWILIO'].includes(provider))throw new AppError('Unsupported integration.',422,'INTEGRATION_UNSUPPORTED');
 const safe=provider==='TWILIO'?{rule:payload.rule,reason:String(payload.reason||'').slice(0,180)}:{attribution:attributionFrom(payload.attribution||{}),value:Number.isFinite(Number(payload.value))?Number(payload.value):undefined,currency:/^[A-Z]{3}$/.test(payload.currency)?payload.currency:undefined};
 const row=await query(`INSERT INTO integration_jobs(provider,event_name,entity_type,entity_id,payload,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`,[provider,eventName,entityType,entityId,JSON.stringify(safe),idempotencyKey]);
 if(MARKETING_PROVIDERS.includes(provider)&&marketingConfiguration(provider).enabled)await query("UPDATE integration_jobs SET mode='PROVIDER' WHERE id=$1 AND attempts=0",[row.rows[0].id]);return row.rows[0];
}
const lifecycleEvents={lead_received:'generate_lead',lead_created:'generate_lead',proposal_sent:'proposal_sent',proposal_accepted:'proposal_accepted',lead_converted:'booking_created',booking_auto_confirmed:'booking_confirmed',invoice_created:'invoice_issued',payment_succeeded:'payment_completed',event_completed:'event_completed'};
export async function enqueueLifecycle({action,entityType,entityId}){
 if(action==='payment_succeeded'&&entityType!=='payment')return;
 const eventName=lifecycleEvents[action];if(!eventName)return;
 let lead;
 if(entityType==='lead')lead=(await query('SELECT first_touch FROM leads WHERE id=$1',[entityId])).rows[0];
 else if(entityType==='proposal')lead=(await query('SELECT l.first_touch FROM proposals p JOIN leads l ON l.id=p.lead_id WHERE p.id=$1',[entityId])).rows[0];
 else if(entityType==='event')lead=(await query('SELECT first_touch FROM leads WHERE converted_event_id=$1 LIMIT 1',[entityId])).rows[0];
 else if(entityType==='invoice'||entityType==='payment')lead=(await query(`SELECT c.first_touch,r.${entityType==='invoice'?'total':'amount'} AS value,${entityType==='invoice'?"(SELECT currency FROM business_settings LIMIT 1)":'r.currency'} AS currency FROM ${entityType==='invoice'?'invoices':'payments'} r JOIN clients c ON c.id=r.client_id WHERE r.id=$1`,[entityId])).rows[0];
 for(const provider of ['GA4','META','TIKTOK'])await enqueueIntegrationEvent({provider,eventName,entityType,entityId,payload:{attribution:lead?.first_touch,...(lead?.value!=null?{value:Number(lead.value),currency:lead.currency}:{})},idempotencyKey:`${provider}:${eventName}:${entityId}`});
}
export async function setSmsConsent({entityType,entityId,consented,source,req}){
 const table=entityType==='lead'?'leads':entityType==='client'?'clients':null;
 if(!table)throw new AppError('Unsupported recipient.',422,'SMS_RECIPIENT_REQUIRED');
 if(consented&&!String(source||'').trim())throw new AppError('Record the consent source.',422,'CONSENT_SOURCE_REQUIRED');
 return transaction(async client=>{
 const before=(await client.query(`SELECT sms_consent_status,sms_consented_at,sms_consent_source,sms_opted_out_at FROM ${table} WHERE id=$1 FOR UPDATE`,[entityId])).rows[0];
 if(!before)throw new AppError('Recipient not found.',404,'RECIPIENT_NOT_FOUND');
 const row=(await client.query(`UPDATE ${table} SET sms_consent_status=$1,sms_consented_at=CASE WHEN $2 THEN now() ELSE sms_consented_at END,sms_consent_source=CASE WHEN $2 THEN $3 ELSE sms_consent_source END,sms_opted_out_at=CASE WHEN $2 THEN NULL ELSE now() END WHERE id=$4 RETURNING id,sms_consent_status,sms_consented_at,sms_consent_source,sms_opted_out_at`,[consented?'OPTED_IN':'OPTED_OUT',consented,source,entityId])).rows[0];
 await client.query("INSERT INTO audit_logs(user_id,action,entity,entity_id,before_json,after_json) VALUES($1,'sms_consent_changed',$2,$3,$4,$5)",[req.user.id,entityType,entityId,before,row]);return row;
 });
}
export async function smsEligibility({entityType,entityId,rule,reason}){
 if(env.smsProvider!=='development')return {allowed:false,reason:'SMS provider is disabled or awaiting verification.'};
 const settings=(await query('SELECT sms_escalations FROM business_settings LIMIT 1')).rows[0]?.sms_escalations||{};
 if(!settings[rule]||!['event_24h','overdue_balance','urgent_operations'].includes(rule))return {allowed:false,reason:'This escalation is disabled.'};
 let recipient;
 if(entityType==='event')recipient=(await query('SELECT c.*,e.event_date,e.start_time,e.status AS event_status FROM events e JOIN clients c ON c.id=e.client_id WHERE e.id=$1 AND e.deleted_at IS NULL',[entityId])).rows[0];
 else if(entityType==='invoice')recipient=(await query('SELECT c.*,i.due_date,i.balance_due FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=$1 AND i.deleted_at IS NULL',[entityId])).rows[0];
 if(['CANCELLED','COMPLETED'].includes(recipient?.event_status))return {allowed:false,reason:'Event is not active.'};
 if(!recipient?.phone||recipient.sms_consent_status!=='OPTED_IN'||!recipient.sms_consented_at||recipient.sms_opted_out_at)return {allowed:false,reason:'Current recorded SMS consent is required.'};
 if(rule==='event_24h'){
 const due=(await query("SELECT ((event_date+COALESCE(start_time,'12:00'::time)) AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago')) BETWEEN now() AND now()+interval '24 hours' AS eligible FROM events WHERE id=$1",[entityId])).rows[0];
 if(!due?.eligible)return {allowed:false,reason:'Event is outside the 24-hour window.'};
 }
 if(rule==='overdue_balance'){
 const due=(await query("SELECT due_date <= current_date-$2::int AND balance_due>0 AND status NOT IN ('VOID','PAID','REFUNDED') AS eligible FROM invoices WHERE id=$1",[entityId,Number(settings.overdue_days)||7])).rows[0];if(!due?.eligible)return {allowed:false,reason:'Balance escalation criteria not met.'};
 }
 if(rule==='urgent_operations'&&!String(reason||'').trim())return {allowed:false,reason:'An urgent operational reason is required.'};
 if(['event_24h','overdue_balance'].includes(rule)){
 const column=entityType==='event'?'event_id':'invoice_id',trigger=rule==='event_24h'?'EVENT_24H_REMINDER':'OVERDUE_BALANCE_REMINDER';
 const reminderKey=rule==='event_24h'?`event-reminder:${entityId}:${String(recipient.event_date).slice(0,10)}`:`overdue-reminder:${entityId}`;
 const prior=(await query(`SELECT id FROM communications WHERE ${column}=$1 AND trigger_key=$2 AND idempotency_key=$4 AND status IN ('SENT_TO_PROVIDER','DELIVERED') AND sent_at<=now()-($3::int*interval '1 hour') LIMIT 1`,[entityId,trigger,Number(settings.email_delay_hours??1),reminderKey])).rows[0];
 if(!prior)return {allowed:false,reason:'A successfully sent email and the escalation delay are required.'};
 }
 return {allowed:true,recipient:recipient.phone};
}
export async function queueSmsEscalation(input){
 const eligible=await smsEligibility(input);if(!eligible.allowed)return {queued:false,reason:eligible.reason};
 const job=await enqueueIntegrationEvent({provider:'TWILIO',eventName:input.rule,entityType:input.entityType,entityId:input.entityId,payload:input,idempotencyKey:`SMS:${input.rule}:${input.entityId}:${input.occurrence||'once'}`});return {queued:true,id:job.id};
}
async function defaultDispatch(job){
 if(MARKETING_PROVIDERS.includes(job.provider)){
  if(job.mode==='PROVIDER')return dispatchMarketing(job);
  if(env.nodeEnv==='production')return {mode:'DISABLED',result:'DISABLED'};
 }
 await developmentDispatch(job);return {mode:'DEVELOPMENT',result:'MOCK_ACCEPTED'};
}
async function developmentDispatch(job){
 if(env.nodeEnv==='production')throw new AppError('Development dispatch cannot run in production.',409,'DEVELOPMENT_ONLY');
 // This adapter persists synthetic acceptance only. It never calls a provider.
 await query(`INSERT INTO integration_dispatches(idempotency_key,provider,provider_reference) VALUES($1,$2,$3) ON CONFLICT(idempotency_key) DO NOTHING`,[job.idempotency_key,job.provider,'mock_'+crypto.createHash('sha256').update(job.idempotency_key).digest('hex').slice(0,24)]);
}
export async function processIntegrationJobs({limit=25,dispatch=defaultDispatch}={}){
 if(stagingJobsPaused())return [];
 if(dispatch!==defaultDispatch&&env.nodeEnv!=='test')throw new AppError('Test adapter unavailable.',403,'TEST_ONLY');
 await query("UPDATE integration_jobs SET status=CASE WHEN mode='PROVIDER' THEN 'FAILED' ELSE 'QUEUED' END,last_error=CASE WHEN mode='PROVIDER' THEN 'PROVIDER_OUTCOME_UNKNOWN' ELSE last_error END,available_at=now() WHERE status='PROCESSING' AND started_at<now()-interval '5 minutes'");
 const results=[];
 for(let i=0;i<limit;i++){
 const job=await transaction(async client=>{const row=(await client.query("SELECT * FROM integration_jobs WHERE status='QUEUED' AND available_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];if(!row)return null;return (await client.query("UPDATE integration_jobs SET status='PROCESSING',attempts=attempts+1,started_at=now() WHERE id=$1 RETURNING *",[row.id])).rows[0];});if(!job)break;
 try{await transaction(async client=>{
 const locked=(await client.query('SELECT * FROM integration_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];if(locked.status==='SUCCEEDED')return;
 if(job.provider==='TWILIO'){const eligible=await smsEligibility({entityType:job.entity_type,entityId:job.entity_id,...job.payload});if(!eligible.allowed){await client.query("UPDATE integration_jobs SET status='CANCELLED',last_error=$2 WHERE id=$1",[job.id,eligible.reason]);return;}}
 const result=await dispatch(job)||{mode:'DEVELOPMENT',result:'MOCK_ACCEPTED'};
 await client.query("INSERT INTO integration_attempts(job_id,provider,event_name,attempt,mode,result,response_summary) VALUES($1,$2,$3,$4,$5,$6,$7)",[job.id,job.provider,job.event_name,job.attempts,result.mode,result.result,JSON.stringify(result)]);
 if(result.result==='DISABLED'){await client.query("UPDATE integration_jobs SET status='CANCELLED',last_error='PROVIDER_DISABLED' WHERE id=$1",[job.id]);return;}
 await client.query("UPDATE integration_jobs SET status='SUCCEEDED',completed_at=now(),last_error=NULL WHERE id=$1",[job.id]);});results.push({id:job.id,status:'PROCESSED'});
 }catch(error){await query("INSERT INTO integration_attempts(job_id,provider,event_name,attempt,mode,result,response_summary) VALUES($1,$2,$3,$4,$5,'FAILED',$6)",[job.id,job.provider,job.event_name,job.attempts,job.mode,JSON.stringify({code:error.code||'INTEGRATION_DISPATCH_FAILED',httpStatus:error.providerStatus})]);await query("UPDATE integration_jobs SET status=$2,last_error=$3,available_at=now()+interval '1 minute' WHERE id=$1",[job.id,job.attempts>=3||(job.mode==='PROVIDER'&&!error.retryable)?'FAILED':'QUEUED',error.code||'INTEGRATION_DISPATCH_FAILED']);results.push({id:job.id,status:'RETRY_OR_FAILED'});}
 }
 return results;
}

export async function queueEventReminder(eventId){
 const event=(await query(`SELECT e.id,e.event_date,e.event_name,e.client_id,c.email FROM events e JOIN clients c ON c.id=e.client_id
 WHERE e.id=$1 AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED')
 AND ((e.event_date+COALESCE(e.start_time,'12:00'::time)) AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago')) BETWEEN now() AND now()+interval '24 hours'`,[eventId])).rows[0];
 if(!event)return {queued:false,reason:'Event is outside the reminder window.'};
 const occurrence=String(event.event_date).slice(0,10),key=`event-reminder:${event.id}:${occurrence}`;
 if(event.email){
  const {brandedEmailHtml}=await import('./automation-service.js');
  const date=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).format(new Date(occurrence+'T12:00:00Z'));
  const body=`A reminder from The LOLA Booth: ${event.event_name} is scheduled for ${date}.\nPlease reply to this email if your event details have changed.`;
  await query(`INSERT INTO communications(client_id,event_id,type,channel,direction,recipient,subject,rendered_subject,rendered_body,rendered_html,status,send_mode,scheduled_at,trigger_key,idempotency_key)
    VALUES($1,$2,'EMAIL','EMAIL','OUTBOUND',$3,'Your upcoming LOLA event','Your upcoming LOLA event',$4,$5,'SCHEDULED','SCHEDULED',now(),'EVENT_24H_REMINDER',$6)
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,[event.client_id,event.id,event.email,body,brandedEmailHtml(body),key]);
 }
 const sms=await queueSmsEscalation({entityType:'event',entityId:event.id,rule:'event_24h',reason:'Your event is within 24 hours.',occurrence});
 return {queued:true,emailQueued:Boolean(event.email),sms};
}
export async function queueDueReminders(){
 if(env.nodeEnv==='production')return []; // Local qualification does not enable new production automations.
 const events=(await query("SELECT id FROM events WHERE deleted_at IS NULL AND event_date BETWEEN current_date AND current_date+2 AND status NOT IN ('CANCELLED','COMPLETED') LIMIT 100")).rows;
 const results=[];for(const event of events)results.push(await queueEventReminder(event.id));
 const invoices=(await query("SELECT id FROM invoices WHERE deleted_at IS NULL AND due_date<current_date AND balance_due>0 AND status NOT IN ('DRAFT','VOID','PAID','REFUNDED') LIMIT 100")).rows;
 for(const invoice of invoices)results.push(await queueOverdueReminder(invoice.id));return results;
}

export async function queueOverdueReminder(invoiceId){
 const invoice=(await query("SELECT i.*,c.email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=$1 AND i.deleted_at IS NULL AND i.due_date<current_date AND i.balance_due>0 AND i.status NOT IN ('DRAFT','VOID','PAID','REFUNDED')",[invoiceId])).rows[0];
 if(!invoice)return {queued:false,reason:'No eligible overdue balance.'};
 if(invoice.email){
  const {brandedEmailHtml}=await import('./automation-service.js');
  const body=`A reminder from The LOLA Booth: invoice ${invoice.invoice_number} has an outstanding balance. Please refer to your invoice email for your secure payment link.`;
  await query(`INSERT INTO communications(client_id,event_id,invoice_id,type,channel,direction,recipient,subject,rendered_subject,rendered_body,rendered_html,status,send_mode,scheduled_at,trigger_key,idempotency_key)
   VALUES($1,$2,$3,'EMAIL','EMAIL','OUTBOUND',$4,'Your LOLA invoice reminder','Your LOLA invoice reminder',$5,$6,'SCHEDULED','SCHEDULED',now(),'OVERDUE_BALANCE_REMINDER',$7)
   ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,[invoice.client_id,invoice.event_id,invoice.id,invoice.email,body,brandedEmailHtml(body),`overdue-reminder:${invoice.id}`]);
 }
 return {queued:true,emailQueued:Boolean(invoice.email),sms:await queueSmsEscalation({entityType:'invoice',entityId:invoice.id,rule:'overdue_balance',reason:'Overdue balance after email reminder'})};
}
