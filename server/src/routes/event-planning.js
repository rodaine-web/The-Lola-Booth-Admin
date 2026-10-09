import {Router} from 'express';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {asyncHandler} from '../utils/async-handler.js';
import {requirePermission} from '../middleware/auth.js';
import {writeAudit} from '../services/audit-service.js';
import {AppError} from '../utils/errors.js';
import {userCanAccessEvent} from "../services/event-operations-service.js";
import {validPlanningUpload,requiredCreativeComponents} from "../../../shared/event-planning.js";
import {recordActivity} from "../services/activity-service.js";
import {createBookingHold,releaseBookingHold} from '../services/booking-hold-service.js';
import {issueBackdropQuote,currentBackdropQuote,linkBackdropInvoice,publicBackdropQuote,acceptBackdropQuote,voidBackdropQuote} from '../services/backdrop-quote-service.js';
import {getStorageProvider} from '../services/storage-service.js';
import {reviewPlanning,adminPlanning,planningInvitation,revokePlanning,publicPlanning,savePlanning,submitPlanning,selectPlanningBackdrop,planningUpload,planningFile} from '../services/event-planning-service.js';
export const adminPlanningRouter=Router(),publicPlanningRouter=Router();
const uuid=value=>z.string().uuid().parse(value);
adminPlanningRouter.get('/events/:id/booking-hold',requirePermission('read:events'),asyncHandler(async(req,res)=>{
 const id=uuid(req.params.id);if(!await userCanAccessEvent(req.user,id))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 const hold=(await query("SELECT id,status,expires_at FROM booking_holds WHERE event_id=$1 ORDER BY (status='ACTIVE') DESC,created_at DESC,id DESC LIMIT 1",[id])).rows[0];
 res.json(hold||null);
}));
adminPlanningRouter.get('/events/:id/backdrop-quote',requirePermission('read:events'),asyncHandler(async(req,res)=>{
 const id=uuid(req.params.id);if(!await userCanAccessEvent(req.user,id))throw new AppError('Event unavailable.',403,'FORBIDDEN');res.json(await currentBackdropQuote(id));
}));
adminPlanningRouter.post('/events/:id/backdrop-quote',requirePermission('write:operations'),asyncHandler(async(req,res)=>{
 const input=z.object({description:z.string().trim().min(10).max(3000),total:z.number().positive().multipleOf(.01).max(100000),requiredPayment:z.number().positive().multipleOf(.01)}).strict().refine(body=>body.requiredPayment<=body.total).parse(req.body);
 res.status(201).json(await issueBackdropQuote(uuid(req.params.id),input,req));
}));
adminPlanningRouter.post('/events/:id/backdrop-quote/invoice',requirePermission('write:sales'),asyncHandler(async(req,res)=>res.json(await linkBackdropInvoice(uuid(req.params.id),z.object({invoiceId:z.string().uuid()}).strict().parse(req.body).invoiceId,req))));
adminPlanningRouter.post('/events/:id/backdrop-quote/void',requirePermission('write:operations'),asyncHandler(async(req,res)=>res.json(await voidBackdropQuote(uuid(req.params.id),z.object({quoteId:z.string().uuid()}).strict().parse(req.body).quoteId,req))));
adminPlanningRouter.get('/events/:id/creative-components',requirePermission('read:events'),asyncHandler(async(req,res)=>{
 const id=uuid(req.params.id);if(!await userCanAccessEvent(req.user,id))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 const experiences=(await query('SELECT x.id,x.name FROM event_experiences ee JOIN experiences x ON x.id=ee.experience_id WHERE ee.event_id=$1 UNION SELECT x.id,x.name FROM events e JOIN experiences x ON x.id=e.experience_id WHERE e.id=$1',[id])).rows;
 const planning=(await query('SELECT requirements FROM event_planning WHERE event_id=$1',[id])).rows[0];
 res.json({components:requiredCreativeComponents(experiences,planning?.requirements?.includes('print_design'))});
}));
const holdSchema=z.object({equipmentIds:z.array(z.string().uuid()).max(40).default([]),backdropIds:z.array(z.string().uuid()).max(1).default([]),minutes:z.number().int().min(5).max(30).default(15)}).strict();
adminPlanningRouter.post('/events/:id/booking-hold',requirePermission('write:events'),asyncHandler(async(req,res)=>{
 const id=uuid(req.params.id);if(!await userCanAccessEvent(req.user,id))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 try{res.status(201).json(await createBookingHold(id,{...holdSchema.parse(req.body),actorUserId:req.user.id}));}
 catch(error){if(error.code==='23514')throw new AppError('The selected resources are unavailable for this event window.',409,'RESERVATION_CONFLICT');throw error;}
}));
adminPlanningRouter.delete('/events/:id/booking-hold',requirePermission('write:events'),asyncHandler(async(req,res)=>{
 const id=uuid(req.params.id);if(!await userCanAccessEvent(req.user,id))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 res.json({hold:await releaseBookingHold(id)});
}));
adminPlanningRouter.get('/events/:id/planning',requirePermission('read:events'),asyncHandler(async(req,res)=>res.json(await adminPlanning(uuid(req.params.id),req.user))));
const planningReviewSchema=z.object({status:z.enum(['APPROVED','CHANGES_REQUESTED']).optional(),review_notes:z.string().trim().max(3000).optional(),backdrop_review_status:z.enum(['NEEDS_REVIEW','CONFIRMED','CHANGES_REQUIRED']).optional(),price_confirmed:z.boolean().optional(),planning_due_at:z.string().date().nullable().optional(),creative_due_at:z.string().date().nullable().optional()}).strict();
adminPlanningRouter.patch('/events/:id/planning/review',requirePermission('write:operations'),asyncHandler(async(req,res)=>res.json(await reviewPlanning(uuid(req.params.id),planningReviewSchema.parse(req.body),req))));
adminPlanningRouter.post('/events/:id/planning/invite',requirePermission('write:events'),asyncHandler(async(req,res)=>res.json(await planningInvitation(uuid(req.params.id),req,{regenerate:req.body.regenerate===true}))));
adminPlanningRouter.post('/events/:id/planning/revoke',requirePermission('write:events'),asyncHandler(async(req,res)=>res.json(await revokePlanning(uuid(req.params.id),req))));
adminPlanningRouter.post('/events/:id/creative-assets',requirePermission('write:operations'),asyncHandler(async(req,res)=>{
 const id=uuid(req.params.id);if(!await userCanAccessEvent(req.user,id))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 const body=z.object({filename:z.string().min(1).max(200),mime_type:z.enum(['image/png','image/jpeg','application/pdf']),base64:z.string().max(12*1024*1024)}).strict().parse(req.body);
 const buffer=Buffer.from(body.base64,'base64');if(!validPlanningUpload(buffer,body.mime_type))throw new AppError('Upload an 8 MB or smaller PNG, JPG or PDF.',422,'UPLOAD_INVALID');
 const filename=body.filename.replace(/[^a-zA-Z0-9_.-]/g,'_');
 const result=await transaction(async()=>{
  const event=(await query('SELECT client_id FROM events WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[id])).rows[0];if(!event)throw new AppError('Event unavailable.',404,'NOT_FOUND');
  const stored=await getStorageProvider().put({buffer,filename,mimeType:body.mime_type});
  const row=(await query("INSERT INTO files(event_id,client_id,category,filename,mime_type,size_bytes,storage_provider,storage_key,visibility,uploaded_by) VALUES($1,$2,'DESIGN',$3,$4,$5,$6,$7,'PRIVATE',$8) RETURNING id,filename",[id,event.client_id,filename,body.mime_type,buffer.length,stored.storageProvider,stored.storageKey,req.user.id])).rows[0];
  await writeAudit({req,action:'creative_asset_uploaded',entity:'event',entityId:id,after:{fileId:row.id}});return row;
 });res.status(201).json(result);
}));
adminPlanningRouter.get('/events/:id/planning/assets/:fileId',requirePermission('read:events'),asyncHandler(async(req,res)=>{
 const id=uuid(req.params.id);if(!await userCanAccessEvent(req.user,id))throw new AppError('Event unavailable.',403,'FORBIDDEN');
 const file=(await query("SELECT f.filename,f.mime_type,f.storage_key FROM files f JOIN events e ON e.id=f.event_id AND e.client_id=f.client_id WHERE f.id=$1 AND f.event_id=$2 AND f.deleted_at IS NULL AND e.deleted_at IS NULL AND f.mime_type IN ('image/png','image/jpeg','application/pdf')",[uuid(req.params.fileId),id])).rows[0];if(!file?.storage_key)throw new AppError('File unavailable.',404,'NOT_FOUND');
 res.set({'Cache-Control':'private, no-store','Content-Security-Policy':'sandbox'}).type(file.mime_type).attachment(file.filename).send(await getStorageProvider().get(file.storage_key));
}));
adminPlanningRouter.get('/backdrops',requirePermission('read:events'),asyncHandler(async(req,res)=>res.json({data:(await query('SELECT * FROM backdrops ORDER BY display_order,name')).rows})));
const backdropSchema=z.object({name:z.string().trim().min(2).max(160),description:z.string().max(3000).default(''),image_url:z.string().url().refine(value=>value.startsWith('https://')).nullable().optional(),category:z.enum(['CLASSIC','GLAM','MODERN','FLORAL','CORPORATE']),kind:z.enum(['PHYSICAL','DIGITAL']),premium:z.boolean(),upgrade_price:z.coerce.number().min(0).max(100000),quantity:z.coerce.number().int().min(0).max(10000),status:z.enum(['ACTIVE','INACTIVE','MAINTENANCE','ARCHIVED']),dimensions:z.string().max(200).optional(),notes:z.string().max(3000).optional(),tags:z.array(z.string().max(80)).max(20).default([]),display_order:z.coerce.number().int().min(0).max(10000)}).strict();
async function saveBackdrop(req){const body=backdropSchema.parse(req.body);if(body.status==='ACTIVE'&&(!body.image_url||(body.kind==='PHYSICAL'&&body.quantity<1)))throw new AppError('Add a final image and available stock before activating a physical backdrop.',422,'BACKDROP_NOT_READY');return transaction(async()=>{
 let before=null;if(req.params.id){before=(await query('SELECT * FROM backdrops WHERE id=$1 FOR UPDATE',[uuid(req.params.id)])).rows[0];if(!before)throw new AppError('Backdrop not found.',404,'NOT_FOUND');}
 const fields=Object.keys(body),values=fields.map(key=>body[key]);let after;
 if(before){values.push(before.id);after=(await query(`UPDATE backdrops SET ${fields.map((key,i)=>`${key}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${values.length} RETURNING *`,values)).rows[0];}
 else after=(await query(`INSERT INTO backdrops(${fields.join(',')}) VALUES(${fields.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,values)).rows[0];
 await writeAudit({req,action:before?'backdrop_updated':'backdrop_created',entity:'backdrop',entityId:after.id,before,after});return after;
});}
adminPlanningRouter.post('/backdrops',requirePermission('write:operations'),asyncHandler(async(req,res)=>res.status(201).json(await saveBackdrop(req))));
adminPlanningRouter.patch('/backdrops/:id',requirePermission('write:operations'),asyncHandler(async(req,res)=>res.json(await saveBackdrop(req))));
publicPlanningRouter.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});next();});
publicPlanningRouter.get('/:token',asyncHandler(async(req,res)=>res.json(await publicPlanning(req.params.token))));
publicPlanningRouter.get('/:token/quote',asyncHandler(async(req,res)=>res.json(await publicBackdropQuote(req.params.token))));
publicPlanningRouter.post('/:token/quote/accept',asyncHandler(async(req,res)=>{
 const body=z.object({quoteId:z.string().uuid(),name:z.string().trim().min(2).max(200),consent:z.literal(true)}).strict().parse(req.body);
 res.json(await acceptBackdropQuote(req.params.token,body.quoteId,body.name,req));
}));
publicPlanningRouter.patch('/:token',asyncHandler(async(req,res)=>res.json(await savePlanning(req.params.token,req.body,req))));
publicPlanningRouter.post('/:token/submit',asyncHandler(async(req,res)=>res.json(await submitPlanning(req.params.token,req))));
publicPlanningRouter.post('/:token/backdrop',asyncHandler(async(req,res)=>{const body=z.object({path:z.enum(['COLLECTION','OWN','CUSTOM']),backdrop_id:z.string().uuid().optional()}).strict().parse(req.body);res.json(await selectPlanningBackdrop(req.params.token,body,req));}));
publicPlanningRouter.post('/:token/assets',asyncHandler(async(req,res)=>res.status(201).json(await planningUpload(req.params.token,req.body,req))));
publicPlanningRouter.get('/:token/assets/:id',asyncHandler(async(req,res)=>{const file=await planningFile(req.params.token,uuid(req.params.id));res.set('Content-Security-Policy','sandbox').type(file.mime_type).attachment(file.filename).send(await getStorageProvider().get(file.storage_key));}));
