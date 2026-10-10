import {adminWorkspaceInvitation} from '../services/client-session-service.js';
import {approveBookingPaymentException} from '../services/booking-payment-exceptions.js';
import {validDrawnSignature} from '../../../shared/signature.js';
import {workspaceAccess,revokeWorkspace,publicWorkspace} from '../services/client-workspace-service.js';
import {sendContract} from '../services/contract-delivery-service.js';
import {Router} from 'express';
import {z} from 'zod';
import {requirePermission} from '../middleware/auth.js';
import {asyncHandler} from '../utils/async-handler.js';
import {validate,uuid} from '../utils/validation.js';
import {AppError} from '../utils/errors.js';
import {contractsEnabled} from '../../../shared/contracts.js';
import {searchContracts,listContracts,createContract,updateContract,issueContract,revokeContract,publicContract,signContract,getContract,contractPdf,contractSigningUrl,extendSigningDeadline} from '../services/contract-service.js';
export const contractsRouter=Router(), publicContractsRouter=Router();
function gate(_req,res,next){res.set('Cache-Control','no-store');return contractsEnabled(process.env)?next():next(new AppError('Client agreements and workspace are not enabled in this environment.',404,'NOT_FOUND'));}
contractsRouter.use(['/contracts','/proposals/:id/contracts','/proposals/:id/workspace'],gate);publicContractsRouter.use(gate);
const draft=z.object({title:z.string().trim().min(3).max(200),terms:z.string().trim().min(20).max(50000)});
contractsRouter.get('/contracts',requirePermission('read:sales'),validate(z.object({search:z.string().trim().max(200).default(''),status:z.enum(['DRAFT','ISSUED','SIGNED','REVOKED']).optional(),clientId:uuid.optional(),eventId:uuid.optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)}),'query'),asyncHandler(async(req,res)=>res.json(await searchContracts(req.validatedQuery))));
const id=validate(z.object({id:uuid}),'params');
contractsRouter.get('/proposals/:id/contracts',requirePermission('read:sales'),id,asyncHandler(async(req,res)=>res.json(await listContracts(req.params.id))));
contractsRouter.post('/proposals/:id/contracts',requirePermission('write:sales'),id,validate(draft),asyncHandler(async(req,res)=>res.status(201).json(await createContract(req.params.id,req.body,req))));
contractsRouter.patch('/contracts/:id',requirePermission('write:sales'),id,validate(draft),asyncHandler(async(req,res)=>res.json(await updateContract(req.params.id,req.body,req))));
contractsRouter.post('/contracts/:id/issue',requirePermission('write:sales'),id,asyncHandler(async(req,res)=>res.json(await issueContract(req.params.id,req))));
contractsRouter.post('/contracts/:id/revoke',requirePermission('write:sales'),id,asyncHandler(async(req,res)=>res.json(await revokeContract(req.params.id,req))));
contractsRouter.get('/contracts/:id/pdf',requirePermission('read:sales'),id,asyncHandler(async(req,res)=>res.type('pdf').set('Content-Disposition','attachment; filename="LOLA-agreement.pdf"').send(await contractPdf(await getContract(req.params.id)))));
contractsRouter.post('/contracts/:id/send',requirePermission('write:sales'),id,asyncHandler(async(req,res)=>res.json(await sendContract(req.params.id,req))));
contractsRouter.post('/contracts/:id/access',requirePermission('write:sales'),id,asyncHandler(async(req,res)=>res.json({signing_url:await contractSigningUrl(req.params.id)})));
contractsRouter.post('/proposals/:id/workspace/invite',requirePermission('write:sales'),id,asyncHandler(async(req,res)=>res.json(await adminWorkspaceInvitation(req.params.id,req))));
contractsRouter.post('/proposals/:id/workspace',requirePermission('write:sales'),id,asyncHandler(async(req,res)=>res.json(await workspaceAccess(req.params.id,req))));
contractsRouter.post('/proposals/:id/workspace/revoke',requirePermission('write:sales'),id,asyncHandler(async(req,res)=>res.json(await revokeWorkspace(req.params.id,req))));
export const publicWorkspaceRouter=Router();publicWorkspaceRouter.use(gate);
const token=validate(z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}),'params');
publicContractsRouter.get('/:token',token,asyncHandler(async(req,res)=>res.json(await publicContract(req.params.token))));
publicContractsRouter.post('/:token/sign',token,validate(z.object({name:z.string().trim().min(2).max(200),email:z.string().trim().email().max(254),consent:z.literal(true),documentHash:z.string().regex(/^[a-f0-9]{64}$/),signatureMethod:z.enum(['TYPED','DRAWN']).default('TYPED'),signatureStrokes:z.array(z.array(z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])).min(2).max(1200)).max(80).refine(validDrawnSignature).optional()})),asyncHandler(async(req,res)=>res.json(await signContract(req.params.token,req.body,req))));
publicContractsRouter.get('/:token/pdf',token,asyncHandler(async(req,res)=>res.type('pdf').set('Content-Disposition','attachment; filename="LOLA-agreement.pdf"').send(await contractPdf(await publicContract(req.params.token)))));

publicWorkspaceRouter.get('/:token',token,asyncHandler(async(req,res)=>res.json(await publicWorkspace(req.params.token))));

contractsRouter.post('/contracts/:id/signing-extension',requirePermission('write:sales'),id,validate(z.object({dueAt:z.iso.datetime().refine(value=>new Date(value)>new Date(),'Choose a future signing deadline.'),reason:z.string().trim().min(20).max(3000)}).strict()),asyncHandler(async(req,res)=>res.json(await extendSigningDeadline(req.params.id,req.body,req))));

contractsRouter.post('/events/:id/payment-exception',requirePermission('write:finance'),id,validate(z.object({minimum_before_agreement:z.coerce.number().min(0).max(1000000).multipleOf(.01),minimum_before_confirmation:z.coerce.number().min(0).max(1000000).multipleOf(.01),balance_due_date:z.iso.date(),reason:z.string().trim().min(20).max(3000)}).strict()),asyncHandler(async(req,res)=>res.json(await approveBookingPaymentException(req.params.id,req.body,req))));

contractsRouter.post('/events/:id/confirm-booking',gate,requirePermission('write:events'),id,asyncHandler(async(req,res)=>{
 const {applyBookingConfirmationPolicy}=await import('../services/payment-reconciliation-service.js');
 const event=await applyBookingConfirmationPolicy(req.params.id,{signedAgreement:true});
 if(!event){const current=(await import('../db/pool.js')).query;const row=(await current('SELECT status FROM events WHERE id=$1 AND deleted_at IS NULL',[req.params.id])).rows[0];if(!row)throw new AppError('Event not found.',404,'NOT_FOUND');if(!['CONFIRMED','PREPARING','READY','IN_PROGRESS'].includes(row.status))throw new AppError('This event cannot be confirmed in its current state.',409,'BOOKING_STATE');}
 const {writeAudit}=await import('../services/audit-service.js');await writeAudit({req,action:'booking_confirmation_reviewed',entity:'event',entityId:req.params.id,after:{status:event?.status||'ALREADY_CONFIRMED'}});
 await (await import('../db/pool.js')).query("UPDATE tasks SET status='DONE',updated_at=now() WHERE lifecycle_key=$1",['booking-confirmation:'+req.params.id]);
 res.json({status:event?.status||'ALREADY_CONFIRMED'});
}));
