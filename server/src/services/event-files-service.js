import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {getStorageProvider} from './storage-service.js';
import {userCanAccessEvent} from './event-operations-service.js';
import {writeAudit} from './audit-service.js';
import {recordActivity} from './activity-service.js';
import {logger} from '../config/logger.js';
import {validPlanningUpload} from '../../../shared/event-planning.js';
import {EVENT_FILE_MAX_BYTES,eventFileName,managesEventFiles,customerShareableEventFile} from '../../../shared/event-files.js';

const fields='id,filename,category,mime_type,size_bytes,visibility,uploaded_by,created_at,customer_shared_at';
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const restricted=user=>!managesEventFiles(user);
export function eventFileSummary(row){
 return Object.fromEntries([...fields.split(',').map(key=>[key,row[key]]),['hasContent',row.hasContent ?? Boolean(row.storage_key&&['LOCAL','AZURE'].includes(row.storage_provider))],['canShareWithClient',customerShareableEventFile(row)]]);
}
async function access(eventId,user,lock=false){
 if(!user || !await userCanAccessEvent(user,eventId))throw new AppError('You do not have access to this event.',403,'FORBIDDEN');
 const event=(await query('SELECT id,client_id FROM events WHERE id=$1 AND deleted_at IS NULL'+(lock?' FOR SHARE':''),[eventId])).rows[0];
 if(!event)throw notFound('Event');
 return event;
}
function visible(row,user){return !restricted(user) || (row.visibility!=='INTERNAL'&&!['CONTRACT','PROPOSAL','INVOICE','INTERNAL'].includes(row.category));}
export async function listEventFiles(eventId,user){
 await access(eventId,user);
 const rows=(await query(`SELECT ${fields},storage_key,storage_provider,content_sha256 FROM files WHERE event_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id`,[eventId])).rows;
 return rows.filter(row=>visible(row,user)).map(eventFileSummary);
}
export function decodeEventFile(input){
 const filename=eventFileName(input.filename,input.mimeType);
 if(!filename)throw new AppError('Use a PDF, PNG or JPEG filename matching the selected file type, without path characters.',422,'EVENT_FILE_INVALID');
 const data=input.data;
 if(typeof data!=='string'||data.length>Math.ceil(EVENT_FILE_MAX_BYTES/3)*4||data.length%4!==0 || /[^A-Za-z0-9+/=]/.test(data))throw new AppError('Choose a valid file up to 8 MB.',422,'EVENT_FILE_INVALID');
 const buffer=Buffer.from(data,'base64');
 if(buffer.length>EVENT_FILE_MAX_BYTES || buffer.toString('base64')!==data || !validPlanningUpload(buffer,input.mimeType))throw new AppError('File contents must be PDF, PNG or JPEG and no larger than 8 MB.',422,'EVENT_FILE_INVALID');
 return {filename,buffer,sha256:digest(buffer)};
}
export async function uploadEventFile(eventId,input,req,{storage=getStorageProvider()}={}){
 const decoded=decodeEventFile(input);
 if(restricted(req.user))throw new AppError('Event file uploads are managed by Admin.',403,'FORBIDDEN');
 let stored;
 try {
  const result=await transaction(async client=>{
   // Serialize retries for one upload; independent uploads do not lock each other.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,590059))',[`${eventId}:${input.requestId}`]);
   const event=await access(eventId,req.user);
   const previous=(await client.query('SELECT * FROM files WHERE event_id=$1 AND upload_request_id=$2',[eventId,input.requestId])).rows[0];
   if(previous){
    if(previous.deleted_at || previous.content_sha256!==decoded.sha256 || previous.filename!==decoded.filename || previous.category!==input.category || previous.visibility!==input.visibility || previous.mime_type!==input.mimeType)throw new AppError('This upload request was already used for a different file. Choose the file again.',409,'EVENT_FILE_REQUEST_REUSED');
    return {file:eventFileSummary(previous),replayed:true};
   }
   try{stored=await storage.put({buffer:decoded.buffer,filename:decoded.filename,mimeType:input.mimeType});}catch{throw new AppError('Private file storage is temporarily unavailable. Please retry.',503,'EVENT_FILE_STORAGE_UNAVAILABLE');}
   const current=await access(eventId,req.user,true);
   const file=(await client.query(`INSERT INTO files(client_id,event_id,category,filename,storage_provider,storage_key,mime_type,size_bytes,visibility,uploaded_by,upload_request_id,content_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[current.client_id,event.id,input.category,decoded.filename,stored.storageProvider,stored.storageKey,input.mimeType,decoded.buffer.length,input.visibility,req.user.id,input.requestId,decoded.sha256])).rows[0];
   const summary=eventFileSummary(file);
   await writeAudit({req,action:'event_file_uploaded',entity:'file',entityId:file.id,after:{...summary,event_id:eventId}});
   await recordActivity({actorUserId:req.user.id,entityType:'event',entityId:eventId,action:'event_file_uploaded',summary:'Private event file uploaded',metadata:{fileId:file.id,category:input.category}});
   return {file:summary,replayed:false};
  });
  return result;
 }catch(error){
  if(stored)try{
   // A lost COMMIT response is uncertain: preserve an object referenced by committed metadata.
   const committed=await query('SELECT 1 FROM files WHERE event_id=$1 AND upload_request_id=$2 AND storage_key=$3',[eventId,input.requestId,stored.storageKey]);
   if(!committed.rowCount)await storage.delete(stored.storageKey);
  }catch{logger.error({eventId},'Private event file commit or cleanup requires operator review');}
  throw error;
 }
}
export async function downloadEventFile(eventId,fileId,req,{storage=getStorageProvider()}={}){
 await access(eventId,req.user);
 const file=(await query('SELECT * FROM files WHERE id=$1 AND event_id=$2 AND deleted_at IS NULL',[fileId,eventId])).rows[0];
 if(!file || !visible(file,req.user))throw notFound('File');
 if(!eventFileSummary(file).hasContent)throw new AppError('Only file details were recorded; the original file has not been uploaded.',404,'EVENT_FILE_BYTES_MISSING');
 let buffer;
 try{buffer=await storage.get(file.storage_key);}catch{throw new AppError('The original file is currently unavailable. Please retry or ask Admin to restore it.',503,'EVENT_FILE_STORAGE_UNAVAILABLE');}
 if(file.size_bytes!==null&&buffer.length!==Number(file.size_bytes)||file.content_sha256&&digest(buffer)!==file.content_sha256)throw new AppError('File integrity verification failed. Ask Admin to restore the original.',503,'EVENT_FILE_INTEGRITY');
 await access(eventId,req.user);
 if(!(await query('SELECT 1 FROM files WHERE id=$1 AND event_id=$2 AND deleted_at IS NULL',[fileId,eventId])).rowCount)throw notFound('File');
 await writeAudit({req,action:'event_file_downloaded',entity:'file',entityId:file.id,after:{event_id:eventId}});
 return {file:eventFileSummary(file),buffer};
}
