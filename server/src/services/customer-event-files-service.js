import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {getStorageProvider} from './storage-service.js';
import {userCanAccessEvent} from './event-operations-service.js';
import {clientEventGrant} from './client-session-workspace-service.js';
import {writeAudit} from './audit-service.js';
import {recordActivity} from './activity-service.js';
import {managesEventFiles,customerShareableEventFile} from '../../../shared/event-files.js';

const summary=file=>({id:file.id,filename:file.filename,category:file.category,mimeType:file.mime_type,sizeBytes:file.size_bytes,sharedAt:file.customer_shared_at});
async function customerAccess(session,eventId){
 await clientEventGrant(session,eventId);
 const event=await query("SELECT 1 FROM events WHERE id=$1 AND client_id=$2 AND deleted_at IS NULL AND sales_closed_at IS NULL AND status<>'CANCELLED'",[eventId,session.client_id]);
 if(!event.rowCount)throw notFound('Event');
}
export async function shareEventFile(eventId,fileId,shared,req){
 if(!managesEventFiles(req.user)||!await userCanAccessEvent(req.user,eventId))throw new AppError('Only authorized Admin can share event files.',403,'FORBIDDEN');
 return transaction(async()=>{
  const file=(await query('SELECT f.* FROM files f JOIN events e ON e.id=f.event_id WHERE f.id=$1 AND f.event_id=$2 AND f.deleted_at IS NULL AND e.deleted_at IS NULL FOR UPDATE OF f',[fileId,eventId])).rows[0];
  if(!file)throw notFound('File');
  if(shared&&!customerShareableEventFile(file))throw new AppError('Only uploaded private design, venue, client or other files can be shared. Internal and financial documents stay private.',422,'CUSTOMER_FILE_NOT_SHAREABLE');
  if(Boolean(file.customer_shared_at)===shared)return {shared,fileId};
  await query('UPDATE files SET customer_shared_at=CASE WHEN $2 THEN now() ELSE NULL END,customer_shared_by=CASE WHEN $2 THEN $3::uuid ELSE NULL END WHERE id=$1',[fileId,shared,req.user.id]);
  await writeAudit({req,action:shared?'event_file_customer_shared':'event_file_customer_unshared',entity:'file',entityId:fileId,before:{shared:!shared},after:{event_id:eventId,shared}});
  await recordActivity({actorUserId:req.user.id,entityType:'event',entityId:eventId,action:shared?'event_file_customer_shared':'event_file_customer_unshared',summary:shared?'File shared in The Client Workspace':'Customer file access removed',metadata:{fileId}});
  return {shared,fileId};
 });
}
async function customerFile(session,eventId,fileId){
 await customerAccess(session,eventId);
 const file=(await query('SELECT * FROM files WHERE id=$1 AND event_id=$2 AND client_id=$3 AND customer_shared_at IS NOT NULL AND deleted_at IS NULL',[fileId,eventId,session.client_id])).rows[0];
 if(!file||!customerShareableEventFile(file))throw notFound('File');return file;
}
export async function listCustomerEventFiles(session,eventId){
 await customerAccess(session,eventId);
 const rows=(await query('SELECT * FROM files WHERE event_id=$1 AND client_id=$2 AND customer_shared_at IS NOT NULL AND deleted_at IS NULL ORDER BY customer_shared_at DESC,id',[eventId,session.client_id])).rows;
 return rows.filter(customerShareableEventFile).map(summary);
}
export async function downloadCustomerEventFile(session,eventId,fileId,req,{storage=getStorageProvider(),revalidateSession=async()=>{}}={}){
 const file=await customerFile(session,eventId,fileId);let buffer;
 try{buffer=await storage.get(file.storage_key);}catch{throw new AppError('This file is temporarily unavailable. Contact LOLA or retry.',503,'EVENT_FILE_STORAGE_UNAVAILABLE');}
 if(buffer.length!==Number(file.size_bytes)||crypto.createHash('sha256').update(buffer).digest('hex')!==file.content_sha256)throw new AppError('The original file could not be verified. Contact LOLA.',503,'EVENT_FILE_INTEGRITY');
 // Recheck access after storage IO. Unsharing, event changes and session revocation
 // during a slow read must prevent delivery. Already downloaded copies cannot be recalled.
 await revalidateSession();await customerFile(session,eventId,fileId);
 await writeAudit({req,action:'event_file_customer_downloaded',entity:'file',entityId:fileId,after:{event_id:eventId,client_id:session.client_id}});
 return {file:summary(file),buffer};
}
