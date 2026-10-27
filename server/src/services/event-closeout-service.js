import {logger} from '../config/logger.js';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {createCommunicationDraft,brandedEmailHtml} from './automation-service.js';
import {createGalleryKey,revealGalleryKey} from './private-gallery-service.js';
import {writeAudit} from './audit-service.js';

export function closeoutBody({clientName,eventName,galleryUrl,discount_code,discount_percent,discount_expires}){
 return `Hi ${clientName},\n\nThank you for choosing The LOLA Booth to be part of ${eventName}! We appreciate you trusting us to help make your celebration memorable.\n\nYour event memories are ready!\nView your event gallery: ${galleryUrl}${discount_code?`\n\nYour exclusive guest discount\nDiscount code: ${discount_code}\nOffer: ${discount_percent}% off\nExpires: ${discount_expires}\nShare this offer with your guests. Any applicable discount will be confirmed in their proposal.`:''}\n\nExplore our experiences: https://thelolabooth.com/connect\nBook another event: https://thelolabooth.com/availability\n${discount_code?`Enter ${discount_code} on the booking form.\n`:''}\nThank you again for celebrating with us. We look forward to creating more memories with you!\n\nThe LOLA Booth\nGood people. Better photos.`;
}
const completed=event=>event.status!=='CANCELLED'&&(event.status==='COMPLETED'||event.operational_status==='COMPLETED');
async function context(id){
 const event=(await query('SELECT e.*,c.name AS client_name,c.email AS client_email FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.id=$1 AND e.deleted_at IS NULL',[id])).rows[0];
 if(!event)throw new AppError('Event not found.',404,'NOT_FOUND');
 const album=(await query("SELECT * FROM gallery_albums WHERE event_id=$1 AND status='PUBLISHED' AND published_at IS NOT NULL AND expires_at>now() ORDER BY published_at DESC LIMIT 1",[id])).rows[0];
 return {event,album};
}
export async function eventCloseout(id){
 const {event,album}=await context(id);
 const row=(await query('SELECT x.*,m.subject,m.rendered_body AS body,m.recipient,m.status AS delivery_status FROM event_closeouts x LEFT JOIN communications m ON m.id=x.communication_id WHERE x.event_id=$1',[id])).rows[0];
 return {record:row||null,galleryReady:Boolean(album),completed:completed(event),eligible:Boolean(row&&new Date(row.due_at)<=new Date()&&album&&completed(event)&&!event.sales_closed_at)};
}
async function prepare(id){
 return transaction(async()=>{
  const row=(await query('SELECT * FROM event_closeouts WHERE event_id=$1 FOR UPDATE',[id])).rows[0];
  if(!row||row.communication_id||new Date(row.due_at)>new Date())return;
  const {event,album}=await context(id);
  if(!completed(event)||event.sales_closed_at||!album||!event.client_email)return;
  const key=(await query("SELECT id FROM gallery_access_keys WHERE album_id=$1 AND type='ALBUM' AND status='ACTIVE' AND (expires_at IS NULL OR expires_at>now()) LIMIT 1",[album.id])).rows[0];
  const access=key?await revealGalleryKey(key.id):await createGalleryKey(album.id,'ALBUM',null,album.expires_at,{});
  const body=closeoutBody({clientName:event.client_name||'there',eventName:event.event_name,galleryUrl:access.url});
  const draft=await createCommunicationDraft({client_id:event.client_id,event_id:id,recipient:event.client_email,subject:`Your memories from ${event.event_name} — The LOLA Booth`,body,html:brandedEmailHtml(body,{kicker:'Thank you for celebrating with us',ctaLabel:'View Your Event Gallery',ctaUrl:access.url}),merge_data:{closeout_gallery_url:access.url,closeout_album_id:album.id,closeout_key_id:access.id},trigger_key:'EVENT_CLOSEOUT_APPROVAL'});
  await query('UPDATE communications SET idempotency_key=$2 WHERE id=$1',[draft.id,'event-closeout:'+id]);
  const task=(await query("INSERT INTO tasks(title,description,event_id,client_id,due_date,priority) VALUES($1,$2,$3,$4,current_date,'NORMAL') RETURNING id",[`Review and send final thank-you — ${event.event_name}`,'Gallery is published. Review the closeout email and optional guest offer, then approve sending from the event overview.',id,event.client_id])).rows[0];
  await query('UPDATE event_closeouts SET communication_id=$2,task_id=$3 WHERE event_id=$1',[id,draft.id,task.id]);
 });
}
export async function queueEventCloseouts(){
 const rows=(await query('SELECT event_id FROM event_closeouts WHERE due_at<=now() AND communication_id IS NULL ORDER BY due_at LIMIT 50')).rows;
 let prepared=0;
 for(const row of rows){try{await prepare(row.event_id);prepared++;}catch(error){logger.error({eventId:row.event_id,code:error.code||'CLOSEOUT_PREPARATION_FAILED'},'Closeout draft needs operator review');}}
 await transaction(async()=>{
  const sent=(await query("UPDATE event_closeouts x SET closed_at=now() FROM communications c WHERE c.id=x.communication_id AND c.status IN ('SENT','SENT_TO_PROVIDER','DELIVERED') AND x.closed_at IS NULL RETURNING x.task_id")).rows;
  for(const row of sent)await query("UPDATE tasks SET status='DONE',closed_at=now(),closure_reason='Customer closeout email accepted by provider' WHERE id=$1 AND status IN ('OPEN','IN_PROGRESS')",[row.task_id]);
 });
 return {prepared};
}
export async function saveEventCloseout(id,input,req){
 return transaction(async()=>{
  const current=(await eventCloseout(id));
  if(!current.eligible||!current.record?.communication_id)throw new AppError('Closeout requires event completion, 24 hours elapsed, and a published available gallery.',409,'CLOSEOUT_NOT_READY');
  const row=(await query('SELECT * FROM event_closeouts WHERE event_id=$1 FOR UPDATE',[id])).rows[0];
  const message=(await query('SELECT * FROM communications WHERE id=$1 FOR UPDATE',[row.communication_id])).rows[0];
  if(row.approved_at||message.status!=='DRAFT')throw new AppError('This closeout was already approved or sent. Review delivery in Communications.',409,'CLOSEOUT_ALREADY_APPROVED');
  const {event,album}=await context(id);
  if(album?.id!==message.merge_data?.closeout_album_id)throw new AppError('Gallery changed. Review closeout access before sending.',409,'CLOSEOUT_GALLERY_CHANGED');
  const offer=Object.fromEntries(['discount_code','discount_percent','discount_expires'].map(key=>[key,Object.hasOwn(input,key)?input[key]:row[key]]));
  if(offer.discount_expires instanceof Date)offer.discount_expires=offer.discount_expires.toISOString().slice(0,10);
  const galleryUrl=message.merge_data.closeout_gallery_url;
  const body=input.body||closeoutBody({clientName:event.client_name||'there',eventName:event.event_name,galleryUrl,...offer});
  const finalBody=body.includes(galleryUrl)?body:body+'\n\nView your event gallery: '+galleryUrl;
  await query('UPDATE communications SET recipient=$2,subject=$3,rendered_subject=$3,rendered_body=$4,message_summary=$5,rendered_html=$6,status=$7,send_mode=$8,scheduled_at=$9 WHERE id=$1',[message.id,event.client_email,input.subject||message.subject,finalBody,finalBody.slice(0,500),brandedEmailHtml(finalBody,{kicker:'Thank you',ctaLabel:'View Your Event Gallery',ctaUrl:galleryUrl}),input.approve?'SCHEDULED':'DRAFT',input.approve?'SCHEDULED':'CREATE_DRAFT',input.approve?new Date():null]);
  await query('UPDATE event_closeouts SET discount_code=$2,discount_percent=$3,discount_expires=$4,approved_by=$5,approved_at=$6 WHERE event_id=$1',[id,offer.discount_code||null,offer.discount_percent||null,offer.discount_expires||null,input.approve?req.user.id:null,input.approve?new Date():null]);
  await writeAudit({req,action:input.approve?'event_closeout_approved':'event_closeout_draft_updated',entity:'event',entityId:id,after:{communication_id:message.id}});
  return eventCloseout(id);
 });
}
