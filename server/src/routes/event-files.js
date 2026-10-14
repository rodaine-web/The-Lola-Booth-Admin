import {Router} from 'express';
import {shareEventFile} from '../services/customer-event-files-service.js';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {requirePermission} from '../middleware/auth.js';
import {asyncHandler} from '../utils/async-handler.js';
import {listEventFiles,uploadEventFile,downloadEventFile} from '../services/event-files-service.js';
import {EVENT_FILE_MAX_BYTES,EVENT_FILE_CATEGORIES,EVENT_FILE_MIME_TYPES} from '../../../shared/event-files.js';
export const eventFilesRouter=Router();
const uuid=value=>z.string().uuid().parse(value);
const schema=z.object({requestId:z.string().uuid(),filename:z.string().min(1).max(160),mimeType:z.enum(EVENT_FILE_MIME_TYPES),category:z.enum(EVENT_FILE_CATEGORIES),visibility:z.enum(['INTERNAL','PRIVATE']).default('INTERNAL'),data:z.string().min(1).max(Math.ceil(EVENT_FILE_MAX_BYTES/3)*4)}).strict();
eventFilesRouter.get('/events/:id/files',requirePermission('read:events'),asyncHandler(async(req,res)=>{
 res.set('Cache-Control','private, no-store').json({data:await listEventFiles(uuid(req.params.id),req.user)});
}));
eventFilesRouter.post('/events/:id/files/:fileId/customer-access',requirePermission('write:events'),asyncHandler(async(req,res)=>{
 const input=z.object({shared:z.boolean()}).strict().parse(req.body);
 res.set('Cache-Control','private, no-store').json(await shareEventFile(uuid(req.params.id),uuid(req.params.fileId),input.shared,req));
}));
eventFilesRouter.post('/events/:id/files',requirePermission('write:events'),rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false}),asyncHandler(async(req,res)=>{
 const result=await uploadEventFile(uuid(req.params.id),schema.parse(req.body),req);
 res.status(result.replayed?200:201).json(result);
}));
eventFilesRouter.get('/events/:id/files/:fileId/download',requirePermission('read:events'),asyncHandler(async(req,res)=>{
 const result=await downloadEventFile(uuid(req.params.id),uuid(req.params.fileId),req);
 res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
 res.attachment(result.file.filename).type(result.file.mime_type || 'application/octet-stream').send(result.buffer);
}));
