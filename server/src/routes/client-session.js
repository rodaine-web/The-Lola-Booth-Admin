import {publicCreativeApproval,publicCreativeProof,respondToCreativeApproval} from '../services/creative-approval-service.js';
import {listCustomerEventFiles,downloadCustomerEventFile} from '../services/customer-event-files-service.js';
import {publicPlanning,savePlanning,submitPlanning,selectPlanningBackdrop,planningUpload,planningFile} from '../services/event-planning-service.js';
import {publicBackdropQuote,acceptBackdropQuote} from '../services/backdrop-quote-service.js';
import {getStorageProvider} from '../services/storage-service.js';
import {createPaymentSession,publicPaymentOptions} from '../services/payment-service.js';
import {Router} from 'express';
import {z} from 'zod';
import {asyncHandler} from '../utils/async-handler.js';
import {validate,uuid} from '../utils/validation.js';
import {AppError} from '../utils/errors.js';
import {contractsEnabled} from '../../../shared/contracts.js';
import {assertClientOrigin,consumeClientInvitation,setClientCookie,clearClientCookie,authenticateClient,endClientSession,requestClientSignIn} from '../services/client-session-service.js';
import {clientEvents,sessionProposalPdf,sessionWorkspace,sessionContract,sessionInvoice,sessionPlanningToken,sessionCreativeToken} from '../services/client-session-workspace-service.js';
import {contractPdf} from '../services/contract-service.js';
import {getInvoice} from '../services/invoice-service.js';
import {generateInvoicePdf,generatePaymentReceiptPdf} from '../services/document-service.js';
import {getReceiptView} from '../services/receipt-service.js';
import {customerGalleryAccess,customerGalleryView,customerGalleryMedia} from '../services/customer-gallery-service.js';
import {verifiedGalleryBytes} from '../services/gallery-media-delivery.js';
import {query} from '../db/pool.js';
import {ZipArchive} from 'archiver';
export const clientSessionRouter=Router();
clientSessionRouter.use((req,res,next)=>{if(req.headers.origin)assertClientOrigin(req);res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});next(contractsEnabled(process.env)?undefined:new AppError('Workspace unavailable.',404,'NOT_FOUND'));});
clientSessionRouter.post('/access',validate(z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict()),asyncHandler(async(req,res)=>{
 assertClientOrigin(req);const access=await consumeClientInvitation(req.body.token);setClientCookie(res,access.token);res.json({csrfToken:access.csrfToken});
}));
clientSessionRouter.post('/sign-in',validate(z.object({email:z.string().trim().email().max(254)}).strict()),asyncHandler(async(req,res)=>{assertClientOrigin(req);res.status(202).json(await requestClientSignIn(req.body.email));}));
clientSessionRouter.get('/session',asyncHandler(async(req,res)=>{const session=await authenticateClient(req);res.json({email:session.email,csrfToken:session.csrfToken,events:await clientEvents(session)});}));
clientSessionRouter.post('/logout',asyncHandler(async(req,res)=>{await endClientSession(req);clearClientCookie(res);res.sendStatus(204);}));
const event=validate(z.object({eventId:uuid}),'params');
clientSessionRouter.get('/events/:eventId/gallery',event,asyncHandler(async(req,res)=>res.json(await customerGalleryView(await authenticateClient(req),req.params.eventId))));
async function clientCapture(req,res,download){
 const session=await authenticateClient(req,{fresh:download}),media=await customerGalleryMedia(session,req.params.eventId,req.params.mediaId,download);
 const bytes=await verifiedGalleryBytes(media,async()=>customerGalleryMedia(await authenticateClient(req,{fresh:download}),req.params.eventId,req.params.mediaId,download));
 res.set({'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
 if(download)res.attachment(media.filename);res.type(media.mime_type).send(bytes);
}
const captureParams=validate(z.object({eventId:uuid,mediaId:uuid}),'params');
clientSessionRouter.get('/events/:eventId/gallery/media/:mediaId',captureParams,asyncHandler(async(req,res)=>clientCapture(req,res,false)));
clientSessionRouter.get('/events/:eventId/gallery/media/:mediaId/download',captureParams,asyncHandler(async(req,res)=>clientCapture(req,res,true)));
clientSessionRouter.get('/events/:eventId/gallery/zip',event,asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{fresh:true}),album=await customerGalleryAccess(session,req.params.eventId);
 if(!album.allow_zip)throw new AppError('Gallery ZIP unavailable.',403,'FORBIDDEN');
 const media=(await query("SELECT * FROM gallery_media WHERE album_id=$1 AND status='VISIBLE' ORDER BY sort_order,created_at",[album.id])).rows;
 if(media.length>1000||media.reduce((n,m)=>n+Number(m.size_bytes),0)>1024**3)throw new AppError('Download individual captures or contact LOLA for this large gallery.',422,'GALLERY_ZIP_LIMIT');
 res.type('application/zip').attachment('LOLA-Event-Gallery.zip');const archive=new ZipArchive({zlib:{level:0}});
 archive.on('error',()=>res.destroy());res.on('close',()=>archive.abort());archive.pipe(res);
 try{for(const [index,m]of media.entries()){
  if(res.destroyed){archive.abort();return;}
  const bytes=await verifiedGalleryBytes(m,async()=>{const current=await customerGalleryAccess(await authenticateClient(req,{fresh:true}),req.params.eventId);if(!current.allow_zip)throw new AppError('Gallery ZIP unavailable.',403,'FORBIDDEN');await customerGalleryMedia(session,req.params.eventId,m.id);});
  archive.append(bytes,{name:`${String(index+1).padStart(4,'0')}-${m.filename.replace(/[^A-Za-z0-9._-]/g,'_')}`});
 }await archive.finalize();}catch(error){archive.abort();res.destroy();throw error;}
}));
clientSessionRouter.get('/events/:eventId/files',event,asyncHandler(async(req,res)=>{
 res.json({data:await listCustomerEventFiles(await authenticateClient(req),req.params.eventId)});
}));
clientSessionRouter.get('/events/:eventId/files/:fileId/download',validate(z.object({eventId:uuid,fileId:uuid}),'params'),asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{fresh:true});
 const result=await downloadCustomerEventFile(session,req.params.eventId,req.params.fileId,req,{revalidateSession:()=>authenticateClient(req,{fresh:true})});
 res.set({'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).attachment(result.file.filename).type(result.file.mimeType).send(result.buffer);
}));
clientSessionRouter.get('/events/:eventId',event,asyncHandler(async(req,res)=>res.json(await sessionWorkspace(await authenticateClient(req),req.params.eventId))));
clientSessionRouter.get('/events/:eventId/proposal/pdf',event,asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{fresh:true});
 res.type('pdf').attachment('LOLA-proposal.pdf').send(await sessionProposalPdf(session,req.params.eventId));
}));
clientSessionRouter.get('/events/:eventId/contracts/:id/pdf',validate(z.object({eventId:uuid,id:uuid}),'params'),asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{fresh:true});const contract=await sessionContract(session,req.params.eventId,req.params.id);
 res.type('pdf').attachment('LOLA-signed-agreement.pdf').send(await contractPdf(contract));
}));
clientSessionRouter.get('/events/:eventId/invoices/:id/pdf',validate(z.object({eventId:uuid,id:uuid}),'params'),asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{fresh:true});await sessionInvoice(session,req.params.eventId,req.params.id);
 res.type('pdf').attachment('LOLA-invoice.pdf').send(await generateInvoicePdf(await getInvoice(req.params.id)));
}));
clientSessionRouter.get('/events/:eventId/invoices/:id/receipts/:paymentId/pdf',validate(z.object({eventId:uuid,id:uuid,paymentId:uuid}),'params'),asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{fresh:true});await sessionInvoice(session,req.params.eventId,req.params.id);
 const receipt=await getReceiptView(await getInvoice(req.params.id),req.params.paymentId);
 res.type('pdf').attachment('LOLA-receipt.pdf').send(await generatePaymentReceiptPdf(receipt));
}));

clientSessionRouter.get('/events/:eventId/invoices/:id/payment-options',validate(z.object({eventId:uuid,id:uuid}),'params'),asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{fresh:true});await sessionInvoice(session,req.params.eventId,req.params.id);
 res.json(await publicPaymentOptions(await getInvoice(req.params.id)));
}));
clientSessionRouter.post('/events/:eventId/invoices/:id/payment-session',validate(z.object({eventId:uuid,id:uuid}),'params'),validate(z.object({provider:z.enum(['STRIPE','PAYPAL']),amountChoice:z.enum(['DEPOSIT','FULL','CUSTOM']),customAmount:z.coerce.number().positive().optional(),idempotencyKey:z.string().trim().min(8).max(200)}).strict()),asyncHandler(async(req,res)=>{
 const session=await authenticateClient(req,{mutation:true,fresh:true});await sessionInvoice(session,req.params.eventId,req.params.id);
 const invoice=await getInvoice(req.params.id);
 res.status(201).json(await createPaymentSession({token:invoice.secure_token,...req.body,workspaceEventId:req.params.eventId}));
}));
async function planningToken(req,mutation=false){const session=await authenticateClient(req,{mutation});return sessionPlanningToken(session,req.params.eventId);}
clientSessionRouter.get('/events/:eventId/planning',event,asyncHandler(async(req,res)=>res.json(await publicPlanning(await planningToken(req)))));
clientSessionRouter.patch('/events/:eventId/planning',event,asyncHandler(async(req,res)=>res.json(await savePlanning(await planningToken(req,true),req.body,req))));
clientSessionRouter.post('/events/:eventId/planning/submit',event,asyncHandler(async(req,res)=>res.json(await submitPlanning(await planningToken(req,true),req))));
clientSessionRouter.post('/events/:eventId/planning/backdrop',event,validate(z.object({path:z.enum(['COLLECTION','OWN','CUSTOM']),backdrop_id:uuid.optional()}).strict()),asyncHandler(async(req,res)=>res.json(await selectPlanningBackdrop(await planningToken(req,true),req.body,req))));
clientSessionRouter.post('/events/:eventId/planning/assets',event,asyncHandler(async(req,res)=>res.status(201).json(await planningUpload(await planningToken(req,true),req.body,req))));
clientSessionRouter.get('/events/:eventId/planning/assets/:id',validate(z.object({eventId:uuid,id:uuid}),'params'),asyncHandler(async(req,res)=>{
 const file=await planningFile(await planningToken(req),req.params.id);res.set('Content-Security-Policy','sandbox').type(file.mime_type).attachment(file.filename).send(await getStorageProvider().get(file.storage_key));
}));
clientSessionRouter.get('/events/:eventId/planning/quote',event,asyncHandler(async(req,res)=>res.json(secureQuote(await publicBackdropQuote(await planningToken(req)),req.params.eventId))));
clientSessionRouter.post('/events/:eventId/planning/quote/accept',event,validate(z.object({quoteId:uuid,name:z.string().trim().min(2).max(200),consent:z.literal(true)}).strict()),asyncHandler(async(req,res)=>res.json(secureQuote(await acceptBackdropQuote(await planningToken(req,true),req.body.quoteId,req.body.name,req),req.params.eventId))));

const proofParams=validate(z.object({eventId:uuid,id:uuid}),'params');
async function creativeToken(req,mutation=false){return sessionCreativeToken(await authenticateClient(req,{mutation}),req.params.eventId,req.params.id);}
clientSessionRouter.get('/events/:eventId/creative/:id',proofParams,asyncHandler(async(req,res)=>res.json(await publicCreativeApproval(await creativeToken(req)))));
clientSessionRouter.get('/events/:eventId/creative/:id/proof',proofParams,asyncHandler(async(req,res)=>{
 const file=await publicCreativeProof(await creativeToken(req));res.set('Content-Security-Policy','sandbox').type(file.mime_type).attachment(file.filename).send(await getStorageProvider().get(file.storage_key));
}));
clientSessionRouter.post('/events/:eventId/creative/:id/respond',proofParams,validate(z.object({action:z.enum(['approve','request_changes']),version:z.number().int().positive(),name:z.string().trim().min(2).max(160),email:z.string().trim().email().max(160),notes:z.string().trim().max(3000).optional()}).strict()),asyncHandler(async(req,res)=>res.json(await respondToCreativeApproval(await creativeToken(req,true),req.body,req))));

function secureQuote(quote,eventId){
 if(!quote)return null;
 return {...quote,paymentUrl:quote.paymentUrl?`/client/events/${eventId}#payments`:null};
}
