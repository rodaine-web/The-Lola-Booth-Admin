import {query,transaction} from '../db/pool.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {fulfillmentData} from './postcard-fulfillment-service.js';
import {assertFiestaReviewAccess} from './fiesta-survey-review-service.js';
import {clientEventGrant} from './client-session-workspace-service.js';
import {photoLink} from './gallery-photo-link-service.js';
import {sendEmail} from './email-service.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {buildPostcardWorkbook} from './postcard-report-workbook.js';
import {mailingHistory} from './gallery-mailing-service.js';
import {z} from 'zod';
export const postcardNotificationRequestSchema=z.object({requestKey:z.string().uuid(),confirmResend:z.boolean().default(false)}).strict();
const financial=/\$|\b(cost|price|budget|payment|funds|balance|margin|charge|credit)\b/i;
export async function createPostcardReport(albumId,user=null,batchId=null){
 if(user)await assertFiestaReviewAccess(albumId,user);
 const data=await fulfillmentData(albumId),urls=new Map();
 for(const row of data.rows)if(row.media_id&&!urls.has(row.media_id)){
  try{urls.set(row.media_id,(await photoLink(albumId,row.media_id)).url);}catch(e){if(e.statusCode!==404&&e.status!==404&&e.code!=='GALLERY_UNAVAILABLE')throw e;urls.set(row.media_id,null);}
 }
 const snapshot={eventName:data.album.event_name||data.album.title,eventDate:data.album.event_date,eventId:data.album.event_id,createdAt:new Date().toISOString(),summary:data.summary,
  rows:data.rows.map(r=>({filename:r.filename,photoUrl:urls.get(r.media_id)||null,name:r.recipient?.name||'',email:r.email||'',phone:r.phone||'',address:r.recipient||{},status:r.result.status,
   reason:financial.test(r.result.reason)?'Processing requires review by The Lola Booth.':r.result.reason,
   submittedAt:r.submitted_at||null,mailedAt:r.mailed_at||null,expectedDelivery:r.expected_delivery_date||null,deliveredAt:r.delivered_at||null,scheduledReleaseAt:r.scheduled_release_at||null}))};
 const row=(await query('INSERT INTO gallery_postcard_reports(album_id,batch_id,snapshot_ciphertext,created_by) VALUES($1,$2,$3,$4) RETURNING id,created_at',[albumId,batchId,encryptSecretJson(snapshot),user?.id||null])).rows[0];
 return {...row,snapshot};
}
export async function adminReportDownload(albumId,id,user){
 await assertFiestaReviewAccess(albumId,user);return reportDownload(albumId,id);
}
async function reportDownload(albumId,id){
 const row=(await query('SELECT snapshot_ciphertext FROM gallery_postcard_reports WHERE album_id=$1 AND id=$2',[albumId,id])).rows[0];
 if(!row)throw new AppError('Report unavailable.',404,'NOT_FOUND');
 return buildPostcardWorkbook(decryptSecretJson(row.snapshot_ciphertext));
}
export async function clientPostcardReports(session,eventId){
 await clientEventGrant(session,eventId);
 const album=(await query('SELECT id FROM gallery_albums WHERE event_id=$1',[eventId])).rows[0];
 if(!album)return {reports:[],progress:{}};
 const reports=(await query('SELECT id,created_at FROM gallery_postcard_reports WHERE album_id=$1 ORDER BY created_at DESC LIMIT 30',[album.id])).rows;
 const counts=(await query(`SELECT count(*) FILTER(WHERE status='SUBMITTED')::int submitted,count(*) FILTER(WHERE mailed_at IS NOT NULL)::int mailed,
 count(*) FILTER(WHERE delivered_at IS NOT NULL)::int delivered,count(*) FILTER(WHERE status='NEEDS_REVIEW')::int needs_review FROM gallery_live_mailing_jobs WHERE album_id=$1`,[album.id])).rows[0];
 return {reports,progress:counts};
}
export async function clientReportDownload(session,eventId,id){
 await clientEventGrant(session,eventId);
 const album=(await query('SELECT id FROM gallery_albums WHERE event_id=$1',[eventId])).rows[0];
 if(!album)throw new AppError('Report unavailable.',404,'NOT_FOUND');
 return reportDownload(album.id,id);
}
export async function enqueuePostcardNotifications(){
 await query(`INSERT INTO gallery_postcard_notifications(album_id,batch_id)
 SELECT b.album_id,b.id FROM gallery_live_mailing_batches b WHERE b.report_notification_eligible=true
 AND b.status IN('COMPLETE','NEEDS_REVIEW')
 AND EXISTS(SELECT 1 FROM gallery_live_mailing_jobs j WHERE j.batch_id=b.id AND j.status='SUBMITTED')
 AND NOT EXISTS(SELECT 1 FROM gallery_live_mailing_jobs j WHERE j.batch_id=b.id AND j.status IN('DRAFT','QUEUED','PROCESSING'))
 AND NOT EXISTS(SELECT 1 FROM gallery_postcard_notifications n WHERE n.batch_id=b.id)
 ON CONFLICT DO NOTHING`);
}
export async function requestPostcardNotification(albumId,user,input){
 await assertFiestaReviewAccess(albumId,user);
 const {requestKey,confirmResend}=postcardNotificationRequestSchema.parse(input);
 return transaction(async()=>{
 const replay=(await query('SELECT id,status FROM gallery_postcard_notifications WHERE album_id=$1 AND request_key=$2',[albumId,requestKey])).rows[0];
 if(replay)return {...replay,queued:false,deduplicated:true};
 const batch=(await query(`SELECT b.id FROM gallery_live_mailing_batches b WHERE b.album_id=$1 AND b.status IN('COMPLETE','NEEDS_REVIEW')
 AND EXISTS(SELECT 1 FROM gallery_live_mailing_jobs j WHERE j.batch_id=b.id AND j.status='SUBMITTED')
 AND NOT EXISTS(SELECT 1 FROM gallery_live_mailing_jobs j WHERE j.batch_id=b.id AND j.status IN('DRAFT','QUEUED','PROCESSING')) ORDER BY b.created_at DESC LIMIT 1 FOR UPDATE OF b`,[albumId])).rows[0];
 if(!batch)throw new AppError('A confirmed production submission is required before notifying the client.',409,'POSTCARD_REPORT_NOT_READY');
 const prior=(await query('SELECT id,status,request_key FROM gallery_postcard_notifications WHERE batch_id=$1 ORDER BY created_at DESC',[batch.id])).rows;
 const same=prior.find(n=>n.request_key===requestKey),active=prior.find(n=>['PENDING','SENDING'].includes(n.status));
 if(same||active)return {id:(same||active).id,status:(same||active).status,queued:false,deduplicated:true};
 if(prior.length&&!confirmResend)throw new AppError('A previous email attempt exists. Review its status and confirm sending another report email.',409,'POSTCARD_REPORT_RESEND_CONFIRMATION_REQUIRED');
 const row=(await query(`INSERT INTO gallery_postcard_notifications(album_id,batch_id,request_key,requested_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id,status`,[albumId,batch.id,requestKey,user.id])).rows[0];
 if(!row){const active=(await query("SELECT id,status FROM gallery_postcard_notifications WHERE batch_id=$1 AND status IN('PENDING','SENDING')",[batch.id])).rows[0];if(active)return {...active,queued:false,deduplicated:true};throw new AppError('The report email changed while requesting it. Refresh before trying again.',409,'POSTCARD_REPORT_REQUEST_CHANGED');}
 await mailingHistory(albumId,null,'CLIENT_REPORT_NOTIFICATION_REQUESTED',user,{batchId:batch.id,notificationId:row.id,requestKey,confirmedResend:confirmResend});
 return {...row,queued:true,deduplicated:false};
 });
}
export async function processPostcardNotifications({send=sendEmail,limit=3}={}){
 // Staging never emails clients automatically; qualification uses an injected transport.
 if(send===sendEmail&&process.env.APP_ENV!=='production')return [];
 if(process.env.GALLERY_POSTCARD_REPORT_EMAIL_ENABLED==='false')return [];
 await enqueuePostcardNotifications();
 await query("UPDATE gallery_postcard_notifications SET status='NEEDS_REVIEW',last_error='Email attempt interrupted. Check provider history before retrying.' WHERE status='SENDING' AND started_at<now()-interval '10 minutes'");
 const results=[];
 for(let i=0;i<limit;i++){
  const job=await transaction(async()=>{const row=(await query("SELECT * FROM gallery_postcard_notifications WHERE status='PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!row)return null;await query("UPDATE gallery_postcard_notifications SET status='SENDING',started_at=now() WHERE id=$1",[row.id]);return row;});
  if(!job)break;
  try{
   const contact=(await query(`SELECT c.email,a.event_id,e.event_name FROM gallery_albums a JOIN events e ON e.id=a.event_id JOIN clients c ON c.id=e.client_id WHERE a.id=$1 AND c.deleted_at IS NULL AND e.deleted_at IS NULL AND e.status<>'CANCELLED'`,[job.album_id])).rows[0];
   if(!contact?.email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))throw Error('Designated client email is missing or invalid.');
   const report=await createPostcardReport(job.album_id,null,job.batch_id),buffer=await buildPostcardWorkbook(report.snapshot);
   await query('UPDATE gallery_postcard_notifications SET report_id=$2,recipient_ciphertext=$3 WHERE id=$1',[job.id,report.id,encryptSecretJson({email:contact.email})]);
   const origin=env.clientOrigin,url=`${origin.replace(/\/$/,'')}/client/events/${contact.event_id}#postcards`;
   const text=`Your postcards have been submitted for printing and mailing for ${contact.event_name}.\n\nPlease see the attached Excel report for each image, recipient, mailing result, and estimated delivery date. Held and excluded records are included with their reasons.\n\nDownload reports securely from your client workspace: ${url}\n\nThe Lola Booth`;
   const {brandedEmailHtml}=await import('./automation-service.js');
   const html=brandedEmailHtml(text,{kicker:'POSTCARD MAILING UPDATE',ctaUrl:url,ctaLabel:'View mailing reports',event:{title:contact.event_name}});
   const result=await send({to:contact.email,subject:`Your postcards have been submitted — ${contact.event_name}`,text,html,attachments:[{filename:'Postcard_Mailing_Report.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer}]});
   if(!result.deliveredExternally&&send===sendEmail)throw Error('Email provider did not confirm external acceptance.');
   await query("UPDATE gallery_postcard_notifications SET status='SENT',sent_at=now(),last_error=NULL WHERE id=$1",[job.id]);results.push({id:job.id,status:'SENT'});
  }catch(e){await query("UPDATE gallery_postcard_notifications SET status='NEEDS_REVIEW',last_error=$2 WHERE id=$1",[job.id,e.message?.startsWith('Designated')?e.message:'Report or email processing needs review. Check provider history before any resend.']);results.push({id:job.id,status:'NEEDS_REVIEW'});}
 }
 return results;
}
