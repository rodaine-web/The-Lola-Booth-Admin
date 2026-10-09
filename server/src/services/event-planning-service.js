import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {env} from '../config/env.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {hashContractValue} from './contract-service.js';
import {userCanAccessEvent} from './event-operations-service.js';
import {recordActivity} from './activity-service.js';
import {writeAudit} from './audit-service.js';
import {createCommunicationDraft} from './automation-service.js';
import {createNotification} from './notification-service.js';
import {getStorageProvider} from './storage-service.js';
import {planningRequirements,planningCompletion,missingPlanningFields,validPlanningUpload,normalizedPlanningValue} from '../../../shared/event-planning.js';
import {z} from 'zod';
const text=z.string().trim().max(3000),short=z.string().trim().max(200);
const briefSchema=z.object({event_name:short,event_type:short,event_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')),start_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).or(z.literal('')),end_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).or(z.literal('')),venue_name:short,venue_address:text,guest_count:z.coerce.number().int().min(0).max(100000).optional(),primary_contact_name:short,primary_contact_email:z.string().email().or(z.literal('')),primary_contact_phone:short,on_site_contact_name:short.optional(),on_site_contact_phone:short.optional(),setup_instructions:text.optional(),parking_instructions:text.optional(),notes:text.optional(),theme:short.optional(),moods:z.array(z.enum(['Elegant','Glamorous','Modern','Minimal','Fun','Romantic','Corporate','Luxury','Bold','Custom'])).max(10).optional(),colors:z.array(z.string().regex(/^#[a-fA-F0-9]{6}$/)).max(12).optional(),creative_notes:text.optional(),assets_not_required:z.boolean().optional(),external_links:z.array(z.string().url().refine(value=>value.startsWith('https://'))).max(10).optional(),music:text.optional(),environment:text.optional(),display_messaging:text.optional(),greeting:text.optional(),phone_placement:text.optional(),signage:text.optional()}).strict();
const protectedFields=['event_type','event_date','start_time','end_time','venue_name','venue_address'];
const confirmed=['CONFIRMED','PREPARING','READY','IN_PROGRESS'];
async function eventRecord(eventId){const event=(await query(`SELECT e.*,c.name AS client_name,c.email AS client_email,c.phone AS client_phone,x.name AS experience_name FROM events e JOIN clients c ON c.id=e.client_id LEFT JOIN experiences x ON x.id=e.experience_id WHERE e.id=$1 AND e.deleted_at IS NULL AND c.deleted_at IS NULL`,[eventId])).rows[0];if(!event)throw new AppError('Event unavailable.',404,'NOT_FOUND');return event;}
async function access(eventId,user){if(!await userCanAccessEvent(user,eventId))throw new AppError('You do not have access to this event.',403,'FORBIDDEN');}
export async function ensureEventPlanning(eventId){
 return transaction(async()=>{
  await query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[eventId]);
  const event=await eventRecord(eventId);if(!confirmed.includes(event.status))return null;
  await assertPlanningPrerequisites(eventId);
  const experiences=(await query('SELECT x.name FROM event_experiences ee JOIN experiences x ON x.id=ee.experience_id WHERE ee.event_id=$1',[eventId])).rows;
  const requirements=planningRequirements(experiences.length?experiences:[{name:event.experience_name||''}],Boolean(event.print_template));
  const brief={event_name:event.event_name||'',event_type:event.event_type||'',event_date:String(event.event_date||''),start_time:event.start_time||'',end_time:event.end_time||'',venue_name:event.venue_name||'',venue_address:event.venue_address||'',guest_count:event.guest_count||0,primary_contact_name:event.client_name||'',primary_contact_email:event.client_email||'',primary_contact_phone:event.client_phone||'',theme:'',moods:[],colors:[]};
  const settings=(await query('SELECT default_planning_due_days,default_creative_due_days FROM business_settings LIMIT 1')).rows[0]||{};
  const row=(await query(`INSERT INTO event_planning(event_id,client_id,brief,requirements,planning_due_at,creative_due_at) VALUES($1,$2,$3,$4,$5::date-$6::int,$5::date-$7::int) ON CONFLICT(event_id) DO NOTHING RETURNING *`,[eventId,event.client_id,JSON.stringify(brief),JSON.stringify(requirements),event.event_date,settings.default_planning_due_days??21,settings.default_creative_due_days??14])).rows[0];
  if(row)await recordActivity({entityType:'event',entityId:eventId,action:'planning_created',summary:'Client event planning created'});
  return row||(await query('SELECT * FROM event_planning WHERE event_id=$1',[eventId])).rows[0];
 });
}
function view(row){return Object.fromEntries(['id','status','brief','change_requests','requirements','backdrop_id','backdrop_path','backdrop_review_status','invited_at','opened_at','started_at','last_saved_at','submitted_at','planning_due_at','creative_due_at','review_notes','reviewed_at','details_review_status'].map(key=>[key,row[key]]));}
async function details(row){const assets=(await query("SELECT id,filename,mime_type,size_bytes FROM files WHERE event_id=$1 AND client_id=$2 AND category='CLIENT_UPLOAD' AND deleted_at IS NULL ORDER BY created_at",[row.event_id,row.client_id])).rows;const backdrops=(await query("SELECT id,name,description,image_url,category,kind,premium,upgrade_price,quantity,status FROM backdrops WHERE status='ACTIVE' OR id=$1 ORDER BY display_order,name",[row.backdrop_id])).rows;return {...view(row),assets,backdrops,progress:planningCompletion(row.brief,row.requirements,Boolean(row.backdrop_id||row.backdrop_path==='OWN'||row.backdrop_path==='CUSTOM'),assets.length)};}
export async function adminPlanning(eventId,user){await access(eventId,user);const row=(await query('SELECT * FROM event_planning WHERE event_id=$1',[eventId])).rows[0];return row?details(row):null;}
async function tokenRecord(token,lock='FOR UPDATE'){
 if(!/^[a-f0-9]{64}$/.test(token))throw new AppError('This planning link is unavailable.',404,'PLANNING_UNAVAILABLE');
 const row=(await query(`SELECT p.* FROM event_planning p JOIN events e ON e.id=p.event_id JOIN clients c ON c.id=p.client_id WHERE p.token_hash=$1 AND p.revoked_at IS NULL AND p.expires_at>now() AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') AND c.deleted_at IS NULL AND c.id=e.client_id ${lock} OF p`,[hashContractValue(token)])).rows[0];
 if(!row)throw new AppError('This planning link is unavailable or expired.',404,'PLANNING_UNAVAILABLE');await assertPlanningPrerequisites(row.event_id);return row;
}
export async function planningInvitation(eventId,req,{regenerate=false}={}){
 await access(eventId,req.user);
 return transaction(async()=>{
  await ensureEventPlanning(eventId);
  let row=(await query('SELECT * FROM event_planning WHERE event_id=$1 FOR UPDATE',[eventId])).rows[0];if(!row)throw new AppError('Confirm the booking before inviting your client.',409,'BOOKING_NOT_CONFIRMED');
  const event=await eventRecord(eventId);
  let token;
  if(!row.token_hash||regenerate||row.revoked_at||new Date(row.expires_at).getTime()<=Date.now()){
   if(row.invitation_communication_id)await query("UPDATE communications SET status='CANCELLED',updated_at=now() WHERE id=$1 AND status IN ('DRAFT','SCHEDULED','FAILED')",[row.invitation_communication_id]);
   token=crypto.randomBytes(32).toString('hex');row=(await query("UPDATE event_planning SET token_hash=$1,token_ciphertext=$2,expires_at=now()+interval '120 days',revoked_at=NULL,invitation_communication_id=NULL WHERE id=$3 RETURNING *",[hashContractValue(token),encryptSecretJson({token}),row.id])).rows[0];
   await writeAudit({req,action:'planning_access_created',entity:'event',entityId:eventId});
  }else token=decryptSecretJson(row.token_ciphertext).token;
  await assertPlanningPrerequisites(eventId);
  const managed=(await query('SELECT booking_journey_managed($1) AS managed',[eventId])).rows[0]?.managed;
  const url=`${env.clientOrigin.replace(/\/$/,'')}/client${managed?'':'/'+token}`;
  if(!row.invitation_communication_id){
   if(!event.client_email)throw new AppError('Add a client email before sending an invitation.',422,'CLIENT_EMAIL_REQUIRED');
   const body=`Hi ${event.client_name?.split(' ')[0]||'there'},\n\nYour LOLA Experience is Booked! Now let's make it yours.\n\n${event.event_name} · ${event.event_date} · ${event.venue_name||'Venue to be confirmed'}\n\nConfirm your event details, tell us about your theme and colors, choose your backdrop and upload logos or images.\n\nCOMPLETE EVENT DETAILS: ${url}\n\nThis only takes a few minutes, and you can save and return anytime.`;
   const communication=await createCommunicationDraft({event_id:eventId,client_id:row.client_id,recipient:event.client_email,subject:"Your LOLA Experience is Booked! Let's Make It Unforgettable. ✨",body,channel:'EMAIL',status:'SCHEDULED',send_mode:'SCHEDULED',scheduled_at:new Date().toISOString(),trigger_key:'PLANNING_INVITATION'});
   await query('UPDATE communications SET idempotency_key=$1 WHERE id=$2',[`planning-invitation:${row.id}:${row.token_hash}`,communication.id]);
   await query("UPDATE event_planning SET invitation_communication_id=$1,invited_at=now(),status=CASE WHEN status='NOT_STARTED' THEN 'INVITED' ELSE status END WHERE id=$2",[communication.id,row.id]);
   await recordActivity({entityType:'event',entityId:eventId,action:'planning_invitation_queued',summary:'Client planning invitation scheduled'});
  }
  return {url,expiresAt:row.expires_at};
 });
}
export async function publicPlanning(token){return transaction(async()=>{const row=await tokenRecord(token);if(!row.opened_at){await query('UPDATE event_planning SET opened_at=now() WHERE id=$1',[row.id]);await recordActivity({entityType:'event',entityId:row.event_id,action:'planning_opened',summary:'Client opened event planning'});}return details(row);});}
export async function savePlanning(token,input,req){
 const brief=briefSchema.parse(input.brief);
 return transaction(async()=>{
  const row=await tokenRecord(token);if(row.details_review_status==='APPROVED'||['APPROVED','COMPLETE'].includes(row.status))throw new AppError('Contact LOLA to change approved event details.',409,'PLANNING_LOCKED');
  const event=await eventRecord(row.event_id),changes={...row.change_requests};
  for(const key of protectedFields){const booked=normalizedPlanningValue(key,event[key]);if(normalizedPlanningValue(key,brief[key])!==booked)changes[key]={booked,requested:brief[key]};else delete changes[key];}
  const result=(await query("UPDATE event_planning SET brief=$1,change_requests=$2,status='IN_PROGRESS',submitted_at=NULL,started_at=COALESCE(started_at,now()),last_saved_at=now(),updated_at=now() WHERE id=$3 RETURNING *",[JSON.stringify(brief),JSON.stringify(changes),row.id])).rows[0];
  if(!row.started_at)await recordActivity({entityType:'event',entityId:row.event_id,action:'planning_started',summary:'Client started event planning'});
  if(JSON.stringify(changes)!==JSON.stringify(row.change_requests)){await writeAudit({req,action:'planning_change_requested',entity:'event',entityId:row.event_id,after:changes});await createNotification({roleTarget:'MANAGERS',category:'EVENTS',title:'Booking detail change requested',body:'Review requested venue, date or time changes before changing the booking.',entityType:'event',entityId:row.event_id,actionUrl:`/events/events/${row.event_id}`});}
  return details(result);
 });
}
export async function submitPlanning(token,req){return transaction(async()=>{
 const row=await tokenRecord(token);if(row.status==='SUBMITTED')return details(row);
 if(row.details_review_status==='APPROVED'||['APPROVED','COMPLETE'].includes(row.status))throw new AppError('This planning submission is locked.',409,'PLANNING_LOCKED');
 const result=await details(row);const missing=missingPlanningFields(row.brief,row.requirements,Boolean(row.backdrop_id||row.backdrop_path==='OWN'||row.backdrop_path==='CUSTOM'),result.assets.length);
 if(missing.length)throw new AppError('Complete the listed required fields before submitting.',422,'PLANNING_INCOMPLETE',{missing});
 await query("UPDATE event_planning SET status='SUBMITTED',submitted_at=now(),updated_at=now() WHERE id=$1",[row.id]);
 if(!row.creative_task_id){
  const task=(await query("INSERT INTO tasks(title,description,event_id,client_id,due_date,priority) VALUES($1,$2,$3,$4,$5,'HIGH') RETURNING id",['Review client planning and prepare creative','Review the submitted brief, protected booking change requests, backdrop and private client assets.',row.event_id,row.client_id,row.creative_due_at])).rows[0];
  await query('UPDATE event_planning SET creative_task_id=$1 WHERE id=$2',[task.id,row.id]);
  await recordActivity({entityType:'event',entityId:row.event_id,action:'planning_creative_task_created',summary:'Creative preparation task created',metadata:{taskId:task.id}});
 }else await query("UPDATE tasks SET status='OPEN',due_date=$1,updated_at=now() WHERE id=$2 AND deleted_at IS NULL",[row.creative_due_at,row.creative_task_id]);
 if(!row.submission_communication_id){
  const event=await eventRecord(row.event_id);
  if(event.client_email){
   const message=await createCommunicationDraft({event_id:row.event_id,client_id:row.client_id,recipient:event.client_email,subject:'Your LOLA event details have been received',body:`Hi ${event.client_name||'there'},\n\nThank you for sharing your event details for ${event.event_name}. Our team will review your style, backdrop and assets and send your creative proof when it is ready. Any date, venue or price changes require separate confirmation.\n\nThe LOLA Booth`,channel:'EMAIL',status:'SCHEDULED',send_mode:'SCHEDULED',scheduled_at:new Date().toISOString(),trigger_key:'PLANNING_SUBMITTED'});
   await query('UPDATE event_planning SET submission_communication_id=$1 WHERE id=$2',[message.id,row.id]);
  }
 }
 await recordActivity({entityType:'event',entityId:row.event_id,action:'planning_submitted',summary:'Client submitted event details'});
 await writeAudit({req,action:'planning_submitted',entity:'event',entityId:row.event_id,after:{planningId:row.id}});
 await createNotification({roleTarget:'MANAGERS',category:'EVENTS',title:'Client event planning submitted',body:'Review the creative brief, backdrop and client assets.',entityType:'event',entityId:row.event_id,actionUrl:`/events/events/${row.event_id}`});return {...result,status:'SUBMITTED'};
});}
export async function selectPlanningBackdrop(token,input,req){return transaction(async()=>{
 const row=await tokenRecord(token);if(row.details_review_status==='APPROVED'||['APPROVED','COMPLETE'].includes(row.status))throw new AppError('Contact LOLA to change an approved backdrop.',409,'PLANNING_LOCKED');
 if(!['COLLECTION','OWN','CUSTOM'].includes(input.path))throw new AppError('Choose a backdrop option.',422,'BACKDROP_INVALID');
 let backdrop=null;
 if(input.path==='COLLECTION'){
  backdrop=(await query("SELECT * FROM backdrops WHERE id=$1 FOR UPDATE",[input.backdrop_id])).rows[0];if(!backdrop||backdrop.status!=='ACTIVE')throw new AppError('This backdrop is unavailable.',409,'BACKDROP_UNAVAILABLE');
  if(backdrop.kind==='PHYSICAL'){
   // Catalog row lock serializes competing reservations. Event windows include overnight timing and configured buffers.
   const count=(await query(`WITH windows AS (
    SELECT e.id,e.event_date+COALESCE(e.setup_time,e.start_time)-make_interval(mins=>s.default_equipment_turnaround_buffer_minutes) AS starts,
      e.event_date+COALESCE(e.breakdown_time,e.end_time)+CASE WHEN COALESCE(e.breakdown_time,e.end_time)<=COALESCE(e.setup_time,e.start_time) THEN interval '1 day' ELSE interval '0' END+make_interval(mins=>s.default_equipment_turnaround_buffer_minutes) AS ends
    FROM events e CROSS JOIN (SELECT default_equipment_turnaround_buffer_minutes FROM business_settings LIMIT 1) s
    WHERE e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED'))
    SELECT count(*)::int AS n FROM event_planning p JOIN windows w ON w.id=p.event_id JOIN windows target ON target.id=$2
    WHERE p.backdrop_id=$1 AND p.event_id<>$2 AND tsrange(w.starts,w.ends,'[)') && tsrange(target.starts,target.ends,'[)')`,[backdrop.id,row.event_id])).rows[0]?.n||0;
   if(count>=backdrop.quantity)throw new AppError('This backdrop is reserved for another event. Choose another option.',409,'BACKDROP_CONFLICT');
  }
 }
 await query("UPDATE event_planning SET backdrop_id=$1,backdrop_path=$2,backdrop_review_status='NEEDS_REVIEW',submitted_at=NULL,status='IN_PROGRESS',updated_at=now() WHERE id=$3",[backdrop?.id||null,input.path,row.id]);
 await recordActivity({entityType:'event',entityId:row.event_id,action:'planning_backdrop_selected',summary:backdrop?`Selected backdrop: ${backdrop.name}`:`Backdrop option: ${input.path}`});
 await writeAudit({req,action:'planning_backdrop_selected',entity:'event',entityId:row.event_id,after:{backdropId:backdrop?.id||null,path:input.path}});
 return details({...row,backdrop_id:backdrop?.id||null,backdrop_path:input.path,backdrop_review_status:'NEEDS_REVIEW',submitted_at:null,status:'IN_PROGRESS'});
});}
export async function planningUpload(token,input,req){
 if(typeof input.base64!=='string'||input.base64.length>12*1024*1024)throw new AppError('File must be 8 MB or smaller.',422,'UPLOAD_INVALID');
 const buffer=Buffer.from(input.base64,'base64');if(!validPlanningUpload(buffer,input.mime_type))throw new AppError('Upload an 8 MB or smaller PNG, JPG or PDF.',422,'UPLOAD_INVALID');
 return transaction(async()=>{
  const row=await tokenRecord(token);if(row.details_review_status==='APPROVED'||['APPROVED','COMPLETE'].includes(row.status))throw new AppError('Planning is locked.',409,'PLANNING_LOCKED');
  const name=String(input.filename||'client-asset').replace(/[^a-zA-Z0-9_.-]/g,'_').slice(-150);
  const stored=await getStorageProvider().put({buffer,filename:name,mimeType:input.mime_type});
  const file=(await query("INSERT INTO files(client_id,event_id,category,filename,storage_provider,storage_key,mime_type,size_bytes,visibility) VALUES($1,$2,'CLIENT_UPLOAD',$3,$4,$5,$6,$7,'PRIVATE') RETURNING id,filename,mime_type,size_bytes",[row.client_id,row.event_id,name,stored.storageProvider,stored.storageKey,input.mime_type,buffer.length])).rows[0];
  await query("UPDATE event_planning SET submitted_at=NULL,status='IN_PROGRESS',updated_at=now() WHERE id=$1",[row.id]);
  await recordActivity({entityType:'event',entityId:row.event_id,action:'planning_asset_uploaded',summary:`Client asset uploaded: ${name}`,metadata:{fileId:file.id}});await writeAudit({req,action:'planning_asset_uploaded',entity:'event',entityId:row.event_id,after:{fileId:file.id}});return file;
 });
}
export async function planningFile(token,fileId){return transaction(async()=>{const row=await tokenRecord(token,'FOR SHARE');const file=(await query("SELECT filename,mime_type,storage_key FROM files WHERE id=$1 AND event_id=$2 AND client_id=$3 AND category='CLIENT_UPLOAD' AND deleted_at IS NULL",[fileId,row.event_id,row.client_id])).rows[0];if(!file)throw new AppError('File unavailable.',404,'NOT_FOUND');return file;});}
export async function revokePlanning(eventId,req){await access(eventId,req.user);return transaction(async()=>{const row=(await query('UPDATE event_planning SET revoked_at=now() WHERE event_id=$1 RETURNING invitation_communication_id',[eventId])).rows[0];if(row?.invitation_communication_id)await query("UPDATE communications SET status='CANCELLED',updated_at=now() WHERE id=$1 AND status IN ('DRAFT','SCHEDULED','FAILED')",[row.invitation_communication_id]);await writeAudit({req,action:'planning_access_revoked',entity:'event',entityId:eventId});return {revoked:true};});}

export async function autoPlanningInvitation(eventId) {
  const row=await ensureEventPlanning(eventId);
  if (!row) return null;
  const event=await eventRecord(eventId);
  if (!event.client_email) return row; // Payment confirmation must not fail because client contact information is incomplete.
  return planningInvitation(eventId,{user:{id:null,permissions:['*']},headers:{}});
}

export async function reviewPlanning(eventId,input,req){
 await access(eventId,req.user);
 return transaction(async()=>{
  const row=(await query('SELECT * FROM event_planning WHERE event_id=$1 FOR UPDATE',[eventId])).rows[0];
  if(!row)throw new AppError('Client planning has not started.',404,'NOT_FOUND');
  if(input.status){
   if(!['SUBMITTED','NEEDS_REVIEW','CHANGES_REQUESTED'].includes(row.status))throw new AppError('Review a submitted planning form before approving it or requesting corrections.',409,'PLANNING_REVIEW_STATE');
   if(input.status==='CHANGES_REQUESTED'&&!input.review_notes?.trim())throw new AppError('Explain which details the client must correct.',422,'REVIEW_NOTES_REQUIRED');
   if(input.status==='APPROVED'){
    await assertPlanningPrerequisites(eventId);
    const current=await details(row);
    const missing=missingPlanningFields(row.brief,row.requirements,Boolean(row.backdrop_id||row.backdrop_path==='OWN'||row.backdrop_path==='CUSTOM'),current.assets.length);
    if(missing.length)throw new AppError('Required client details are incomplete.',422,'PLANNING_INCOMPLETE',{missing});
    const event=await eventRecord(eventId);
    const pending=Object.entries(row.change_requests||{}).filter(([key,value])=>normalizedPlanningValue(key,event[key])!==normalizedPlanningValue(key,value.requested));
    if(pending.length)throw new AppError('Resolve requested date, time and venue changes before planning approval.',409,'BOOKING_CHANGES_PENDING');
    if(row.requirements.includes('backdrop')&&(input.backdrop_review_status||row.backdrop_review_status)!=='CONFIRMED')throw new AppError('Confirm the selected backdrop before planning approval.',422,'BACKDROP_REVIEW_REQUIRED');
   }
  }
  if(input.backdrop_review_status==='CONFIRMED'&&!row.backdrop_path)throw new AppError('Select a backdrop option before confirming it.',422,'BACKDROP_REQUIRED');
  if(input.backdrop_review_status==='CONFIRMED'&&row.backdrop_path==='CUSTOM')await (await import('./backdrop-quote-service.js')).assertBackdropPayment(eventId,row.client_id);
  if(input.backdrop_review_status==='CONFIRMED'&&row.backdrop_id){
   const backdrop=(await query('SELECT status,premium,upgrade_price FROM backdrops WHERE id=$1 FOR SHARE',[row.backdrop_id])).rows[0];
   if(backdrop?.status!=='ACTIVE')throw new AppError('This collection backdrop is unavailable.',409,'BACKDROP_UNAVAILABLE');
   if(backdrop.premium&&Number(backdrop.upgrade_price)>0)await (await import('./backdrop-quote-service.js')).assertBackdropPayment(eventId,row.client_id);
  }
  if(input.backdrop_review_status==='CONFIRMED'&&row.backdrop_path==='CUSTOM')await (await import('./backdrop-quote-service.js')).assertBackdropPayment(eventId,row.client_id);
  const reviewInput={...input,...(input.status?{reviewed_at:new Date().toISOString(),reviewed_by:req.user.id,details_review_status:input.status}:{}),...(input.status==='APPROVED'?{change_requests:{}}:{})};
  const fields=Object.keys(reviewInput).filter(key=>key!=='price_confirmed'),values=fields.map(key=>reviewInput[key]);
  if(!fields.length)throw new AppError('Choose a review status or deadline.',422,'REVIEW_REQUIRED');
  values.push(row.id);
  const updated=(await query(`UPDATE event_planning SET ${fields.map((key,i)=>`${key}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${values.length} RETURNING *`,values)).rows[0];
  if(input.status==='CHANGES_REQUESTED'){
   const event=await eventRecord(eventId);const managed=(await query('SELECT booking_journey_managed($1) AS managed',[eventId])).rows[0]?.managed;
   const url=managed?env.clientOrigin.replace(/\/$/,'')+'/client':env.clientOrigin.replace(/\/$/,'')+'/planning/'+decryptSecretJson(row.token_ciphertext).token;
   await query("UPDATE communications SET status='CANCELLED',updated_at=now() WHERE event_id=$1 AND trigger_key='PLANNING_CORRECTIONS' AND status IN ('DRAFT','SCHEDULED','FAILED')",[eventId]);
   if(event.client_email){const message=await createCommunicationDraft({event_id:eventId,client_id:row.client_id,recipient:event.client_email,subject:'Please update your LOLA event details',body:input.review_notes+'\n\n'+url,trigger_key:'PLANNING_CORRECTIONS',status:'SCHEDULED',send_mode:'SCHEDULED',scheduled_at:new Date().toISOString()});await query('UPDATE communications SET idempotency_key=$2 WHERE id=$1',[message.id,'planning-correction:'+row.id+':'+new Date(updated.reviewed_at).toISOString()]);}
  }
  await writeAudit({req,action:'planning_reviewed',entity:'event',entityId:eventId,before:{backdropReviewStatus:row.backdrop_review_status,planningDueAt:row.planning_due_at,creativeDueAt:row.creative_due_at},after:input});
  await recordActivity({actorUserId:req.user.id,entityType:'event',entityId:eventId,action:'planning_reviewed',summary:'LOLA reviewed planning deadlines / backdrop',metadata:input});
  return details(updated);
 });
}

export async function assertPlanningPrerequisites(eventId){
 const event=await eventRecord(eventId);
 if(!confirmed.includes(event.status))throw new AppError('Planning opens after booking confirmation.',409,'BOOKING_NOT_CONFIRMED');
 if((await query('SELECT booking_journey_managed($1) AS managed',[eventId])).rows[0]?.managed){
  const missing=(await query('SELECT booking_confirmation_missing($1) AS missing',[eventId])).rows[0]?.missing||[];
  if(missing.length)throw new AppError(missing.join(' '),409,'BOOKING_PREREQUISITES_REQUIRED',{missing});
 }
}
