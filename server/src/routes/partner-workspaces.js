import {getStorageProvider} from '../services/storage-service.js';
import {assertClientOrigin} from '../services/client-session-service.js';
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { query, transaction } from '../db/pool.js';
import { AppError, notFound } from '../utils/errors.js';
import { writeAudit } from '../middleware/audit.js';

export const partnerWorkspacesRouter = Router();
export const publicPartnerWorkspaceRouter = Router();
const uuid = z.string().uuid();
const adminRead = [authenticate, requirePermission('read:sales'), requirePermission('read:events')];
const adminWrite = [authenticate, requirePermission('write:sales'), requirePermission('read:events')];
const hash = token => createHash('sha256').update(token).digest('hex');
const denied = () => new AppError('Partner workspace access is unavailable.', 404, 'NOT_FOUND');
// LOLA_PARTNER_COOKIE_SESSION_V2: scoped HttpOnly re-entry cookie. Every view still checks invitation
// expiry/revocation, workspace state and current event grants. No independent partner privilege.
const inviteCookie='lola_partner_workspace_invite';
const inviteCookiePath='/api/partner-workspaces';
const readInviteCookie=req=>{
  const raw=String(req.headers.cookie||'');
  const pair=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(inviteCookie+'='));
  if(!pair)return '';
  try{return decodeURIComponent(pair.slice(inviteCookie.length+1));}catch{return '';}
};
publicPartnerWorkspaceRouter.use('/view', rateLimit({windowMs:60_000,limit:30,standardHeaders:true,legacyHeaders:false}));
publicPartnerWorkspaceRouter.post('/logout', (req,res)=>{
  res.clearCookie(inviteCookie,{httpOnly:true,secure:process.env.APP_ENV==='staging'||process.env.APP_ENV==='production',sameSite:'lax',path:inviteCookiePath});
  res.set('Cache-Control','no-store').json({signedOut:true});
});

async function partnerById(id) {
  const partner = (await query('SELECT id,name,email,status FROM partners WHERE id=$1', [id])).rows[0];
  if (!partner) throw notFound('Partner');
  return partner;
}
async function snapshot(partnerId) {
  const workspace = (await query('SELECT id,partner_id,contact_email,status,created_at,updated_at FROM partner_workspaces WHERE partner_id=$1', [partnerId])).rows[0] || null;
  const available = (await query(`SELECT DISTINCT e.id,e.event_name,e.event_date,e.status FROM event_partners ep JOIN events e ON e.id=ep.event_id WHERE ep.partner_id=$1 AND e.deleted_at IS NULL ORDER BY e.event_date DESC,e.event_name`, [partnerId])).rows;
  const granted = workspace ? (await query(`SELECT e.id,e.event_name,e.event_date,e.status FROM partner_workspace_events g JOIN events e ON e.id=g.event_id JOIN event_partners ep ON ep.event_id=e.id AND ep.partner_id=$2 WHERE g.workspace_id=$1 AND e.deleted_at IS NULL ORDER BY e.event_date DESC`, [workspace.id, partnerId])).rows : [];
  return { workspace, available, granted };
}
partnerWorkspacesRouter.get('/partners/:id/workspace', ...adminRead, asyncHandler(async (req,res) => {
  const partnerId = uuid.parse(req.params.id);
  const partner = await partnerById(partnerId);
  res.json({ partner, ...(await snapshot(partnerId)) });
}));
partnerWorkspacesRouter.post('/partners/:id/workspace', ...adminWrite, asyncHandler(async (req,res) => {
  const partnerId = uuid.parse(req.params.id), partner = await partnerById(partnerId);
  if (partner.status !== 'ACTIVE') throw new AppError('Activate the partner before creating a workspace.',409,'PARTNER_INACTIVE');
  const email = z.string().email().max(254).parse(partner.email || '');
  const workspace = await transaction(async () => {
    const existing = (await query('SELECT id FROM partner_workspaces WHERE partner_id=$1 FOR UPDATE',[partnerId])).rows[0];
    if (existing) throw new AppError('This partner already has a workspace.',409,'WORKSPACE_EXISTS');
    const row = (await query('INSERT INTO partner_workspaces(partner_id,contact_email,created_by) VALUES($1,$2,$3) RETURNING id,partner_id,contact_email,status,created_at',[partnerId,email.toLowerCase(),req.user.id])).rows[0];
    await writeAudit({req,action:'partner_workspace_created',entity:'partner',entityId:partnerId,after:{workspace_id:row.id}});
    return row;
  });
  res.status(201).json({workspace});
}));
partnerWorkspacesRouter.put('/partners/:id/workspace/events', ...adminWrite, asyncHandler(async (req,res) => {
  const partnerId = uuid.parse(req.params.id);
  const {eventIds} = z.object({eventIds:z.array(uuid).max(100)}).strict().parse(req.body);
  const ids = [...new Set(eventIds)];
  const result = await transaction(async () => {
    const workspace = (await query('SELECT * FROM partner_workspaces WHERE partner_id=$1 FOR UPDATE',[partnerId])).rows[0];
    if (!workspace || workspace.status !== 'ACTIVE') throw denied();
    const valid = (await query(`SELECT DISTINCT ep.event_id FROM event_partners ep JOIN events e ON e.id=ep.event_id WHERE ep.partner_id=$1 AND ep.event_id=ANY($2::uuid[]) AND e.deleted_at IS NULL`,[partnerId,ids])).rows;
    if (valid.length !== ids.length) throw new AppError('One or more events are not associated with this partner.',422,'PARTNER_EVENT_SCOPE');
    await query('DELETE FROM partner_workspace_events WHERE workspace_id=$1',[workspace.id]);
    for (const eventId of ids) await query('INSERT INTO partner_workspace_events(workspace_id,event_id) VALUES($1,$2)',[workspace.id,eventId]);
    await query('UPDATE partner_workspaces SET updated_at=now() WHERE id=$1',[workspace.id]);
    // Existing invitation links should never silently expand to newly authorized events.
    await query('UPDATE partner_workspace_invitations SET revoked_at=now() WHERE workspace_id=$1 AND revoked_at IS NULL',[workspace.id]);
    await writeAudit({req,action:'partner_workspace_events_changed',entity:'partner',entityId:partnerId,after:{workspace_id:workspace.id,event_count:ids.length}});
    return {updated:true,invitesRevoked:true};
  });
  res.json(result);
}));
partnerWorkspacesRouter.post('/partners/:id/workspace/invite', ...adminWrite, asyncHandler(async (req,res) => {
  const partnerId = uuid.parse(req.params.id);
  const token = randomBytes(32).toString('hex');
  const result = await transaction(async () => {
    const partner = await partnerById(partnerId);
    const workspace = (await query('SELECT * FROM partner_workspaces WHERE partner_id=$1 FOR UPDATE',[partnerId])).rows[0];
    if (!workspace || workspace.status !== 'ACTIVE' || partner.status !== 'ACTIVE') throw denied();
    if (!partner.email || partner.email.toLowerCase() !== workspace.contact_email.toLowerCase()) throw new AppError('Partner email changed. Review workspace access before inviting.',409,'PARTNER_EMAIL_CHANGED');
    const count = (await query('SELECT count(*)::int AS total FROM partner_workspace_events WHERE workspace_id=$1',[workspace.id])).rows[0].total;
    if (!count) throw new AppError('Choose at least one authorized event first.',409,'WORKSPACE_NO_EVENTS');
    await query('UPDATE partner_workspace_invitations SET revoked_at=now() WHERE workspace_id=$1 AND revoked_at IS NULL',[workspace.id]);
    const invite = (await query("INSERT INTO partner_workspace_invitations(workspace_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days') RETURNING expires_at",[workspace.id,hash(token)])).rows[0];
    await writeAudit({req,action:'partner_workspace_invite_created',entity:'partner',entityId:partnerId,after:{workspace_id:workspace.id,expires_at:invite.expires_at}});
    return {expiresAt:invite.expires_at};
  });
  // Fragment is not transmitted to servers via HTTP Referer/request URL. The client removes it on load.
  res.status(201).json({...result, invitationPath:'/partner-workspace#token='+token, recipientEmail:(await partnerById(partnerId)).email});
}));
partnerWorkspacesRouter.post('/partners/:id/workspace/revoke', ...adminWrite, asyncHandler(async (req,res) => {
  const partnerId = uuid.parse(req.params.id);
  await transaction(async()=>{
    const workspace=(await query('UPDATE partner_workspaces SET status=\'REVOKED\',updated_at=now() WHERE partner_id=$1 RETURNING id',[partnerId])).rows[0];
    if(!workspace) throw denied();
    await query('UPDATE partner_workspace_invitations SET revoked_at=now() WHERE workspace_id=$1 AND revoked_at IS NULL',[workspace.id]);
    await writeAudit({req,action:'partner_workspace_revoked',entity:'partner',entityId:partnerId,after:{workspace_id:workspace.id}});
  });
  res.json({revoked:true});
}));
publicPartnerWorkspaceRouter.post('/view', asyncHandler(async (req,res) => {
  res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});
  const presented=req.body?.token || readInviteCookie(req);
  const token = z.string().regex(/^[a-f0-9]{64}$/).parse(presented);
  const row = (await query(`SELECT w.id,w.partner_id,p.name,w.contact_email FROM partner_workspace_invitations i JOIN partner_workspaces w ON w.id=i.workspace_id JOIN partners p ON p.id=w.partner_id WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND i.expires_at>now() AND w.status='ACTIVE' AND p.status='ACTIVE' AND lower(p.email)=lower(w.contact_email)`,[hash(token)])).rows[0];
  if (!row) throw denied();
  if(req.body?.token){
    res.cookie(inviteCookie, token, {httpOnly:true,secure:process.env.APP_ENV==='staging'||process.env.APP_ENV==='production',sameSite:'lax',path:inviteCookiePath,maxAge:8*60*60*1000});
  }
  const events=(await query(`SELECT DISTINCT e.id,e.event_name,e.event_date,e.status FROM partner_workspace_events g JOIN events e ON e.id=g.event_id JOIN event_partners ep ON ep.event_id=e.id AND ep.partner_id=$2 WHERE g.workspace_id=$1 AND e.deleted_at IS NULL ORDER BY e.event_date DESC`,[row.id,row.partner_id])).rows;
  res.json({partnerName:row.name,events,access:'EVENT_SUMMARY_ONLY'});
}));

async function partnerEventAccess(req,eventId){
 const token=z.string().regex(/^[a-f0-9]{64}$/).safeParse(readInviteCookie(req));if(!token.success)throw denied();
 const row=(await query(`SELECT w.id,w.partner_id FROM partner_workspace_invitations i JOIN partner_workspaces w ON w.id=i.workspace_id JOIN partners p ON p.id=w.partner_id JOIN partner_workspace_events g ON g.workspace_id=w.id JOIN event_partners ep ON ep.event_id=g.event_id AND ep.partner_id=w.partner_id JOIN events e ON e.id=g.event_id WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND i.expires_at>now() AND w.status='ACTIVE' AND p.status='ACTIVE' AND lower(p.email)=lower(w.contact_email) AND g.event_id=$2 AND e.deleted_at IS NULL`,[hash(token.data),eventId])).rows[0];
 if(!row)throw denied();return row;
}
publicPartnerWorkspaceRouter.use('/events',(req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'});next();});
publicPartnerWorkspaceRouter.get('/events/:eventId',asyncHandler(async(req,res)=>{
 const eventId=uuid.parse(req.params.eventId),workspace=await partnerEventAccess(req,eventId);
 const event=(await query('SELECT id,event_name,event_date,status,start_time,end_time,venue_name FROM events WHERE id=$1',[eventId])).rows[0];
 const files=(await query(`SELECT f.id,f.filename,f.mime_type FROM partner_workspace_shared_files s JOIN files f ON f.id=s.file_id AND f.event_id=s.event_id WHERE s.workspace_id=$1 AND s.event_id=$2 AND f.deleted_at IS NULL AND f.visibility='PRIVATE' AND f.category IN('DESIGN','VENUE','OTHER')`,[workspace.id,eventId])).rows;
 const requests=(await query('SELECT id,message,status,created_at FROM partner_workspace_requests WHERE workspace_id=$1 AND event_id=$2 ORDER BY created_at DESC LIMIT 100',[workspace.id,eventId])).rows;
 res.json({event,files,requests});
}));
publicPartnerWorkspaceRouter.post('/events/:eventId/requests',rateLimit({windowMs:60000,limit:10,standardHeaders:true,legacyHeaders:false}),asyncHandler(async(req,res)=>{
 assertClientOrigin(req);const eventId=uuid.parse(req.params.eventId),workspace=await partnerEventAccess(req,eventId);
 const {message}=z.object({message:z.string().trim().min(3).max(3000)}).strict().parse(req.body);
 const result=await query('INSERT INTO partner_workspace_requests(workspace_id,event_id,message) VALUES($1,$2,$3) RETURNING id',[workspace.id,eventId,message]);
 res.status(201).json(result.rows[0]);
}));
publicPartnerWorkspaceRouter.get('/events/:eventId/files/:fileId',asyncHandler(async(req,res)=>{
 const eventId=uuid.parse(req.params.eventId),fileId=uuid.parse(req.params.fileId),workspace=await partnerEventAccess(req,eventId);
 const lookup=async()=> (await query(`SELECT f.* FROM partner_workspace_shared_files s JOIN files f ON f.id=s.file_id AND f.event_id=s.event_id WHERE s.workspace_id=$1 AND s.event_id=$2 AND f.id=$3 AND f.deleted_at IS NULL AND f.visibility='PRIVATE' AND f.category IN('DESIGN','VENUE','OTHER')`,[workspace.id,eventId,fileId])).rows[0];
 const file=await lookup();if(!file||!file.content_sha256)throw denied();
 const bytes=await getStorageProvider().get(file.storage_key);
 if(bytes.length!==Number(file.size_bytes)||crypto.createHash('sha256').update(bytes).digest('hex')!==file.content_sha256)throw denied();
 await partnerEventAccess(req,eventId);if(!await lookup())throw denied();
 await writeAudit({req,action:'partner_shared_file_downloaded',entity:'file',entityId:fileId,after:{workspaceId:workspace.id,eventId}});
 res.set({'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).attachment(file.filename).type(file.mime_type).send(bytes);
}));
partnerWorkspacesRouter.get('/partners/:id/workspace/review',...adminRead,asyncHandler(async(req,res)=>{
 const workspace=(await query('SELECT id FROM partner_workspaces WHERE partner_id=$1',[uuid.parse(req.params.id)])).rows[0];if(!workspace)throw denied();
 const requests=(await query('SELECT r.*,e.event_name FROM partner_workspace_requests r JOIN events e ON e.id=r.event_id WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100',[workspace.id])).rows;
 const shared=(await query('SELECT file_id,event_id FROM partner_workspace_shared_files WHERE workspace_id=$1',[workspace.id])).rows;res.json({requests,shared});
}));
partnerWorkspacesRouter.post('/partners/:id/workspace/files',...adminWrite,asyncHandler(async(req,res)=>{
 const {fileId,shared}=z.object({fileId:uuid,shared:z.boolean()}).strict().parse(req.body);
 const workspace=(await query('SELECT id FROM partner_workspaces WHERE partner_id=$1',[uuid.parse(req.params.id)])).rows[0];if(!workspace)throw denied();
 const file=(await query("SELECT f.id,f.event_id FROM files f JOIN partner_workspace_events g ON g.event_id=f.event_id AND g.workspace_id=$2 JOIN event_partners ep ON ep.event_id=f.event_id AND ep.partner_id=$3 WHERE f.id=$1 AND f.deleted_at IS NULL AND f.visibility='PRIVATE' AND f.category IN('DESIGN','VENUE','OTHER') AND f.content_sha256 IS NOT NULL",[fileId,workspace.id,req.params.id])).rows[0];
 if(!file)throw denied();
 if(shared)await query('INSERT INTO partner_workspace_shared_files(workspace_id,event_id,file_id,shared_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[workspace.id,file.event_id,file.id,req.user.id]);else await query('DELETE FROM partner_workspace_shared_files WHERE workspace_id=$1 AND file_id=$2',[workspace.id,file.id]);
 await writeAudit({req,action:shared?'partner_file_shared':'partner_file_unshared',entity:'file',entityId:fileId,after:{workspaceId:workspace.id}});res.json({shared});
}));
partnerWorkspacesRouter.post('/partners/:id/workspace/requests/:requestId/resolve',...adminWrite,asyncHandler(async(req,res)=>{
 const result=await query("UPDATE partner_workspace_requests r SET status='RESOLVED',resolved_by=$3 FROM partner_workspaces w WHERE r.workspace_id=w.id AND w.partner_id=$1 AND r.id=$2 RETURNING r.id",[uuid.parse(req.params.id),uuid.parse(req.params.requestId),req.user.id]);if(!result.rowCount)throw denied();res.json({resolved:true});
}));
