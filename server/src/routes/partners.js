import {Router} from 'express';
import {z} from 'zod';
import {authenticate,requirePermission} from '../middleware/auth.js';
import {asyncHandler} from '../utils/async-handler.js';
import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {writeAudit} from '../middleware/audit.js';
import {partnerDetail,partnershipEvent,createPartnershipEvent,convertPartnershipLead,grantPartnerGallery,partnerGrantAction} from '../services/partnership-service.js';
export const partnersRouter=Router();
partnersRouter.use(['/partners','/pickers/partners','/partnership-events','/partnership-leads','/partner-gallery-grants'],authenticate);
const read=requirePermission('read:sales'),write=requirePermission('write:sales'),eventRead=requirePermission('read:events'),eventWrite=requirePermission('write:events'),galleryWrite=requirePermission('write:operations');
const id=z.string().uuid(),role=z.enum(['ORGANIZER','SPONSOR','VENUE','COLLABORATOR']);
const optional=z.string().trim().max(500).nullable().optional();
const partnerInput=z.object({name:z.string().trim().min(1).max(200),contact_name:optional,email:z.union([z.string().trim().email().max(254),z.literal('')]).nullable().optional(),phone:optional,website:z.union([z.string().url().refine(s=>['https:','http:'].includes(new URL(s).protocol)),z.literal('')]).nullable().optional(),notes:z.string().max(10000).nullable().optional(),status:z.enum(['ACTIVE','ARCHIVED']).default('ACTIVE')}).strict();
partnersRouter.get('/partners',read,asyncHandler(async(req,res)=>{
 const status=z.enum(['ACTIVE','ARCHIVED','ALL']).default('ACTIVE').parse(req.query.status),search=z.string().max(200).default('').parse(req.query.search);
 const result=await query("SELECT p.* FROM partners p WHERE ($1='ALL' OR status=$1) AND (name ILIKE $2 OR partner_number ILIKE $2 OR email ILIKE $2) ORDER BY updated_at DESC LIMIT 200",[status,'%'+search+'%']);res.json({data:result.rows});
}));
partnersRouter.get('/pickers/partners',read,asyncHandler(async(req,res)=>res.json({data:(await query("SELECT id,name AS label,partner_number AS description FROM partners WHERE status='ACTIVE' AND name ILIKE $1 ORDER BY name LIMIT 100",['%'+String(req.query.q||'').slice(0,200)+'%'])).rows})));
partnersRouter.post('/partners',write,asyncHandler(async(req,res)=>{
 const b=partnerInput.parse(req.body);const partner=await transaction(async()=>{const row=(await query('INSERT INTO partners(name,contact_name,email,phone,website,notes,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.name,b.contact_name||null,b.email||null,b.phone||null,b.website||null,b.notes||null,b.status])).rows[0];await writeAudit({req,action:'partner_created',entity:'partner',entityId:row.id,after:row});return row;});res.status(201).json(partner);
}));
partnersRouter.get('/partners/:id',read,eventRead,asyncHandler(async(req,res)=>res.json(await partnerDetail(id.parse(req.params.id)))));
partnersRouter.patch('/partners/:id',write,asyncHandler(async(req,res)=>{
 const b=partnerInput.partial().parse(req.body);if(!Object.keys(b).length)throw new AppError('Choose fields to update.',422,'NO_FIELDS');
 const partner=await transaction(async()=>{const before=(await query('SELECT * FROM partners WHERE id=$1 FOR UPDATE',[id.parse(req.params.id)])).rows[0];if(!before)throw notFound('Partner');const fields=Object.keys(b),values=Object.values(b);const row=(await query(`UPDATE partners SET ${fields.map((f,i)=>f+'=$'+(i+1)).join(',')},updated_at=now() WHERE id=$${values.length+1} RETURNING *`,[...values,before.id])).rows[0];
 if(b.status==='ARCHIVED')await query("UPDATE gallery_access_keys k SET status='REVOKED',revoked_at=now() FROM partner_gallery_grants g JOIN event_partners ep ON ep.id=g.event_partner_id WHERE ep.partner_id=$1 AND g.access_key_id=k.id AND k.status='ACTIVE'",[row.id]);
 await writeAudit({req,action:'partner_updated',entity:'partner',entityId:row.id,before,after:row});return row;});res.json(partner);
}));
partnersRouter.post('/partnership-leads/:id/convert',write,asyncHandler(async(req,res)=>res.json(await convertPartnershipLead(id.parse(req.params.id),req))));
const eventInput=z.object({event_name:z.string().trim().min(1).max(200),event_type:z.string().trim().min(1).max(120),event_date:z.iso.date(),start_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),end_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),venue_name:optional,venue_address:optional,city:optional,state:optional,internal_notes:z.string().max(10000).optional(),status:z.enum(['TENTATIVE','CONFIRMED','COMPLETED']).default('TENTATIVE'),partners:z.array(z.object({partner_id:id,role,notes:optional}).strict()).min(1).max(30)}).strict().refine(b=>(!b.start_time&&!b.end_time)||(b.start_time&&b.end_time&&b.end_time>b.start_time),{message:'Supply both times, with the end after the start.'});
partnersRouter.post('/partnership-events',write,eventWrite,asyncHandler(async(req,res)=>res.status(201).json(await createPartnershipEvent(eventInput.parse(req.body),req))));
partnersRouter.get('/partnership-events/:id',read,eventRead,asyncHandler(async(req,res)=>res.json(await partnershipEvent(id.parse(req.params.id)))));
partnersRouter.post('/partnership-events/:id/partners',write,eventWrite,asyncHandler(async(req,res)=>{
 const eventId=id.parse(req.params.id),b=z.object({partner_id:id,role,notes:optional}).strict().parse(req.body);
 const link=await transaction(async()=>{await partnershipEvent(eventId);if(!(await query("SELECT id FROM partners WHERE id=$1 AND status='ACTIVE' FOR SHARE",[b.partner_id])).rowCount)throw notFound('Active partner');const row=(await query('INSERT INTO event_partners(event_id,partner_id,role,notes) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,partner_id,role) DO UPDATE SET notes=EXCLUDED.notes RETURNING *',[eventId,b.partner_id,b.role,b.notes||null])).rows[0];await writeAudit({req,action:'event_partner_added',entity:'event',entityId:eventId,after:row});return row;});res.status(201).json(link);
}));
partnersRouter.post('/partnership-events/:id/partners/:linkId/gallery-access',write,eventRead,galleryWrite,asyncHandler(async(req,res)=>{
 const input=z.object({scope:z.enum(['FULL','SELECTED']),media_ids:z.array(id).max(1000).default([])}).strict().parse(req.body);
 res.status(201).json(await grantPartnerGallery(id.parse(req.params.id),id.parse(req.params.linkId),input,req));
}));
partnersRouter.post('/partner-gallery-grants/:id/reveal',write,eventRead,galleryWrite,asyncHandler(async(req,res)=>res.json(await partnerGrantAction(id.parse(req.params.id),req))));
partnersRouter.post('/partner-gallery-grants/:id/revoke',write,eventRead,galleryWrite,asyncHandler(async(req,res)=>res.json(await partnerGrantAction(id.parse(req.params.id),req,true))));
