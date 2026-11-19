import {deleteGalleryAlbum,deleteGalleryPhotos} from '../services/gallery-deletion-service.js';
import {photoLink,photoLinkView,resolvePhotoLink} from '../services/gallery-photo-link-service.js';
import {fulfillmentWorkspace,excludeRecipient} from '../services/postcard-fulfillment-service.js';
import {createPostcardReport,adminReportDownload,requestPostcardNotification} from '../services/postcard-report-service.js';
import {query as scopeQuery} from '../db/pool.js';
import {assertFiestaReviewAccess} from '../services/fiesta-survey-review-service.js';
import {fiestaAddressForReview,updateFiestaAddress} from '../services/fiesta-address-correction-service.js';
import {userCanAccessEvent as mailingEventAccess} from '../services/event-operations-service.js';
import * as liveMailing from '../services/gallery-live-mailing-service.js';
import * as mailing from '../services/gallery-mailing-service.js';
import {listFiestaSurveyReview,fiestaSurveyEvidence} from '../services/fiesta-survey-review-service.js';
import { Router } from "express";
import * as galleryPostcards from "../services/gallery-postcards-service.js";
import * as lobPrintReady from "../services/lob-print-ready-service.js";
import * as galleryArtwork from "../services/gallery-postcard-artwork-service.js";
import * as postcardWorkflow from "../services/gallery-postcard-workflow-service.js";
import rateLimit from "express-rate-limit";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { z } from "zod";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import {
  assertGalleryEnvironment,
  downloadAllowed,
  unavailable,
} from "../services/gallery-policy.js";
import { galleryStorage } from "../services/gallery-storage.js";
import * as gallery from "../services/private-gallery-service.js";
import {importFiestaShares} from '../services/fiesta-gallery-service.js';
import {gallery20EventOverview,gallery20AlbumReview} from '../services/gallery20-review-service.js';
import {verifiedGalleryBytes} from '../services/gallery-media-delivery.js';
import {dropboxGalleryStatus,saveDropboxGallerySource,pauseDropboxGallerySource,syncDropboxGallerySource} from '../services/dropbox-gallery-service.js';
import {startDropboxGalleryOAuth,finishDropboxGalleryOAuth,disconnectDropboxGallery} from '../services/dropbox-gallery-connection.js';
import {env} from '../config/env.js';
const id = z.string().uuid(),
  date = z.string().datetime({ offset: true }).nullable().optional();
const noCache = (_req, res, next) => {
  res.set({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  next();
};
const gate = (_req, _res, next) => {
  try {
    assertGalleryEnvironment();
    next();
  } catch (e) {
    next(e);
  }
};
const parseGrant = (req) =>
  req.params.type==='photo' ? resolvePhotoLink(req.params.token).then(r=>r.grant) : gallery.resolveGalleryToken(
    req.params.type === "a"
      ? "ALBUM"
      : req.params.type === "p"
        ? "PERSON"
        : "INVALID",
    req.params.token,
  );
const extension = (mime) =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",'video/mp4':'mp4' })[mime] ||
  "bin";
async function streamMedia(media, res, download = false,revalidate=async()=>{}) {
  const storage = galleryStorage();
  if (storage.provider !== media.storage_provider)
    throw new AppError(
      "Media storage provider is unavailable.",
      503,
      "GALLERY_STORAGE_NOT_READY",
    );
  res.type(media.mime_type);
  res.set(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="LOLA-Photo.${extension(media.mime_type)}"`,
  );
  res.send(await verifiedGalleryBytes(media,revalidate));
}
export const galleryPublicRouter = Router();
galleryPublicRouter.use(gate, noCache);
galleryPublicRouter.post(
  "/resolve",
  rateLimit({
    windowMs: 60000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { message: "Please wait before trying another gallery code." },
    },
  }),
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.resolveGalleryCode(
        z.object({ code: z.string().max(80) }).parse(req.body).code,
      ),
    ),
  ),
);
galleryPublicRouter.get(
  "/access/:type/:token",
  asyncHandler(async (req, res) =>
    res.json(req.params.type==='photo'?await photoLinkView(req.params.token):await gallery.publicGalleryView(await parseGrant(req))),
  ),
);
galleryPublicRouter.get(
  "/access/:type/:token/refresh",
  asyncHandler(async (req, res) =>
    res.json(req.params.type==='photo'?await photoLinkView(req.params.token):await gallery.publicGalleryView(await parseGrant(req), false)),
  ),
);
galleryPublicRouter.post(
  "/access/:type/:token/media/:id/download",
  asyncHandler(async (req, res) => {
    if(req.params.type==='photo'&&(await resolvePhotoLink(req.params.token)).mediaId!==id.parse(req.params.id))throw unavailable();
    res.json(
      await gallery.mediaTicket(
        await parseGrant(req),
        id.parse(req.params.id),
        "download",
      ),
    );
  }),
);
galleryPublicRouter.get(
  "/access/:type/:token/zip",
  rateLimit({
    windowMs: 60000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  asyncHandler(async (req, res) => {
    if(req.params.type==='photo')throw unavailable();
    const grant = await parseGrant(req);
    if (!downloadAllowed(grant, true)) throw unavailable();
    const media = await gallery.allowedMedia(grant);
    if (
      media.length > 1000 ||
      media.reduce((s, m) => s + Number(m.size_bytes), 0) > 1024 ** 3
    )
      throw new AppError(
        "This gallery is too large for one download. Download individual photos or contact your host.",
        422,
        "GALLERY_ZIP_LIMIT",
      );
    const storage = galleryStorage();
    if (media.some((m) => m.storage_provider !== storage.provider))
      throw new AppError(
        "Media storage unavailable.",
        503,
        "GALLERY_STORAGE_NOT_READY",
      );
    await gallery.galleryActivity(grant, "ZIP_DOWNLOADED");
    res
      .type("application/zip")
      .attachment(
        grant.type === "PERSON"
          ? "LOLA-Your-Photos.zip"
          : "LOLA-Event-Gallery.zip",
      );
    const archive = new ZipArchive({ zlib: { level: 0 } });
    archive.on("error", () => res.destroy());
    res.on("close", () => archive.abort());
    archive.pipe(res);
    try{for (const [index, m] of media.entries()){
      const bytes=await verifiedGalleryBytes(m,async()=>{const current=await parseGrant(req);if(!downloadAllowed(current,true)||!(await gallery.allowedMedia(current)).some(row=>row.id===m.id))throw unavailable();});
      archive.append(bytes, {
        name: `LOLA-Photo-${String(index + 1).padStart(3, "0")}.${extension(m.mime_type)}`,
      });
    }await archive.finalize();}catch(error){archive.abort();res.destroy();throw error;}
  }),
);
galleryPublicRouter.get(
  "/media/:ticket",
  asyncHandler(async (req, res) => {
    const { media, download } = await gallery.authorizedMediaTicket(
      req.params.ticket,
      { recordActivity: false },
    );
    await streamMedia(media, res, download,()=>gallery.authorizedMediaTicket(req.params.ticket));
  }),
);
export const galleryAdminRouter = Router();
galleryAdminRouter.use(
  gate,
  noCache,
  authenticate,
  requirePermission("read:events"),
);
const write = requirePermission("write:operations");
galleryAdminRouter.use('/albums/:id',asyncHandler(async(req,_res,next)=>{await assertFiestaReviewAccess(id.parse(req.params.id),req.user);next();}));
galleryAdminRouter.use('/events/:eventId',asyncHandler(async(req,_res,next)=>{if(!await mailingEventAccess(req.user,id.parse(req.params.eventId)))throw new AppError('Event access denied.',403,'FORBIDDEN');next();}));
galleryAdminRouter.get('/albums/:id/postcard-workspace',write,asyncHandler(async(req,res)=>res.json(await fulfillmentWorkspace(id.parse(req.params.id),req.user))));
galleryAdminRouter.post('/albums/:id/postcard-reports',write,asyncHandler(async(req,res)=>{
 const report=await createPostcardReport(id.parse(req.params.id),req.user);res.status(201).json({id:report.id,created_at:report.created_at});
}));
galleryAdminRouter.post('/albums/:id/postcard-notifications',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await requestPostcardNotification(id.parse(req.params.id),req.user))));
galleryAdminRouter.get('/albums/:id/postcard-reports/:reportId/download',write,asyncHandler(async(req,res)=>{
 res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('Postcard_Mailing_Report.xlsx').send(await adminReportDownload(id.parse(req.params.id),id.parse(req.params.reportId),req.user));
}));
galleryAdminRouter.post('/albums/:id/postcard-status/refresh',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{
 await liveMailing.refreshLiveMailings(id.parse(req.params.id));res.json({refreshed:true});
}));
galleryAdminRouter.post('/albums/:id/media/:mediaId/photo-link',write,asyncHandler(async(req,res)=>res.json(await photoLink(id.parse(req.params.id),id.parse(req.params.mediaId)))));
galleryAdminRouter.put('/albums/:id/postcard-exclusions/:rowId',write,asyncHandler(async(req,res)=>{
 const input=z.object({reason:z.string().trim().min(10).max(2000),excluded:z.boolean().default(true)}).strict().parse(req.body);
 res.json(await excludeRecipient(id.parse(req.params.id),id.parse(req.params.rowId),input.reason,req.user,input.excluded));
}));

galleryAdminRouter.use(['/imports','/analytics'],write);
for(const [route,table]of [['/media/:id','gallery_media'],['/keys/:id','gallery_access_keys'],['/people/:id','gallery_people']])galleryAdminRouter.use(route,asyncHandler(async(req,_res,next)=>{const row=(await scopeQuery(`SELECT album_id FROM ${table} WHERE id=$1`,[id.parse(req.params.id)])).rows[0];if(!row)throw new AppError('Gallery record unavailable.',404,'NOT_FOUND');await assertFiestaReviewAccess(row.album_id,req.user);next();}));
// Gallery 2.0 review only; event permission and private-album ownership are checked in the service.
galleryAdminRouter.get('/events/:eventId/gallery20-overview',asyncHandler(async(req,res)=>
  res.json(await gallery20EventOverview(id.parse(req.params.eventId),req.user))));
galleryAdminRouter.get('/albums/:id/gallery20-review',asyncHandler(async(req,res)=>
  res.json(await gallery20AlbumReview(id.parse(req.params.id),req.user))));
const dropboxCookie={httpOnly:true,secure:['staging','production'].includes(process.env.APP_ENV),sameSite:'lax',path:'/api/integrations/dropbox-gallery/callback',maxAge:600000};
galleryAdminRouter.post('/albums/:id/dropbox/connect',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{
  const result=await startDropboxGalleryOAuth(id.parse(req.params.id),req);res.cookie('lola_dropbox_gallery_oauth',result.browser,dropboxCookie);res.json({url:result.url});
}));
galleryAdminRouter.post('/dropbox/disconnect',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await disconnectDropboxGallery(req))));
galleryAdminRouter.get('/albums/:id/dropbox',requirePermission('read:integrations'),asyncHandler(async(req,res)=>res.json(await dropboxGalleryStatus(id.parse(req.params.id)))));
galleryAdminRouter.post('/albums/:id/dropbox',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{
  const input=z.object({folderPath:z.string().min(2).max(1000),enabled:z.boolean().default(false)}).strict().parse(req.body);
  res.json(await saveDropboxGallerySource(id.parse(req.params.id),input,req.user));
}));
galleryAdminRouter.post('/albums/:id/dropbox/pause',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await pauseDropboxGallerySource(id.parse(req.params.id),req.user))));
galleryAdminRouter.post('/albums/:id/dropbox/sync',write,requirePermission('write:integrations'),rateLimit({windowMs:60000,limit:3,standardHeaders:true,legacyHeaders:false}),asyncHandler(async(req,res)=>res.json(await syncDropboxGallerySource(id.parse(req.params.id),{user:req.user}))));
export const galleryDropboxOAuthRouter=Router();
galleryDropboxOAuthRouter.get('/dropbox-gallery/callback',gate,noCache,rateLimit({windowMs:600000,limit:20,standardHeaders:true,legacyHeaders:false}),asyncHandler(async(req,res)=>{
  const browser=String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('lola_dropbox_gallery_oauth='))?.split('=').slice(1).join('=');
  res.clearCookie('lola_dropbox_gallery_oauth',dropboxCookie);
  const result=await finishDropboxGalleryOAuth({state:req.query.state,code:req.query.code,error:req.query.error,browser},req);
  res.redirect(`${env.clientOrigin.replace(/\/$/,'')}/operations/galleries/${result.albumId}?dropbox=connected`);
}));
const mailingPath='/albums/:id/mailing';
galleryAdminRouter.get(mailingPath+'/live',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await liveMailing.liveMailingSummary(id.parse(req.params.id),req.user))));
galleryAdminRouter.get(mailingPath+'/live/test-proofs/:postcardId',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await liveMailing.liveBatchTestProof(id.parse(req.params.id),id.parse(req.params.postcardId),req.user))));
galleryAdminRouter.post(mailingPath+'/live/batches',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{
 const input=z.object({postcard_ids:z.array(id).min(1).max(500),cost_limit_cents:z.number().int().min(1).max(10000000),unit_cost_cents:z.number().int().min(1).max(100000),price_source:z.string().trim().min(10).max(2000),extra_copy_reason:z.string().trim().max(2000).default('')}).strict().parse(req.body);
 res.status(201).json(await liveMailing.prepareLiveBatch(id.parse(req.params.id),input,req.user));
}));
galleryAdminRouter.post(mailingPath+'/live/batches/:batchId/authorize',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{
 const input=z.object({confirmation:z.literal('AUTHORIZE LIVE MAILING'),note:z.string().trim().min(10).max(2000),status_channel:z.enum(['WEBHOOK','POLLING']).default('WEBHOOK')}).strict().parse(req.body);
 res.json(await liveMailing.authorizeLiveBatch(id.parse(req.params.id),id.parse(req.params.batchId),input,req.user));
}));
galleryAdminRouter.post(mailingPath+'/live/batches/:batchId/cancel',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await liveMailing.cancelLiveBatch(id.parse(req.params.id),id.parse(req.params.batchId),req.user))));
galleryAdminRouter.post(mailingPath+'/process-test-queue',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{if(process.env.GALLERY_MAILING_WORKER_ENABLED!=='true')throw new AppError('Enable the dedicated gallery mailing test worker before processing.',409,'MAILING_WORKER_PAUSED');res.json({processed:await mailing.processMailingQueue({limit:5})});}));
galleryAdminRouter.get(mailingPath,write,asyncHandler(async(req,res)=>res.json(await mailing.mailingSummary(id.parse(req.params.id),req.user))));
galleryAdminRouter.put(mailingPath,write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{
 const input=z.object({quantity_limit:z.number().int().min(0).max(10000),cost_limit_cents:z.number().int().min(0).max(10000000),unit_cost_cents:z.number().int().min(1).max(100000),override_reason:z.string().trim().max(2000).default('')}).strict().parse(req.body);
 res.json(await mailing.configureMailing(id.parse(req.params.id),input,req.user));
}));
galleryAdminRouter.post(mailingPath+'/requests',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>{
 const input=z.object({quantity:z.number().int().min(1).max(10000),notes:z.string().trim().min(10).max(2000),return_address:z.object({name:z.string().max(120),address_line1:z.string().max(200),address_line2:z.string().max(200).default(''),address_city:z.string().max(100),address_state:z.string().length(2),address_zip:z.string().regex(/^\d{5}(-\d{4})?$/),address_country:z.literal('US')}).strict()}).strict().parse(req.body);
 res.json(await mailing.recordAdminMailingRequest(id.parse(req.params.id),input,req.user));
}));
galleryAdminRouter.post(mailingPath+'/requests/:requestId/review',write,asyncHandler(async(req,res)=>res.json(await mailing.reviewClientMailing(id.parse(req.params.id),id.parse(req.params.requestId),z.object({status:z.enum(['APPROVED','DECLINED']),note:z.string().trim().max(2000).default('')}).strict().parse(req.body),req.user))));
galleryAdminRouter.post(mailingPath+'/postcards/:postcardId/proof-approve',write,asyncHandler(async(req,res)=>res.json(await mailing.approvePersonalizedProof(id.parse(req.params.id),id.parse(req.params.postcardId),req.user))));
galleryAdminRouter.post(mailingPath+'/postcards/:postcardId/queue',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await mailing.enqueueMailing(id.parse(req.params.id),id.parse(req.params.postcardId),req.user,z.object({extra_copy_reason:z.string().trim().max(2000).default('')}).strict().parse(req.body).extra_copy_reason))));
galleryAdminRouter.post(mailingPath+'/postcards/:postcardId/provider-link',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await mailing.linkProviderPostcard(id.parse(req.params.id),id.parse(req.params.postcardId),z.object({provider_id:z.string().regex(/^psc_[A-Za-z0-9]+$/)}).strict().parse(req.body).provider_id,req.user))));
galleryAdminRouter.post(mailingPath+'/postcards/:postcardId/reconcile',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await mailing.reconcilePostcard(id.parse(req.params.id),id.parse(req.params.postcardId),z.object({reason:z.string().trim().min(10).max(2000),confirm_not_created:z.boolean().default(false)}).strict().parse(req.body),req.user))));
// Optional event-specific Lob postcard preparation; no live API or mass-mailing endpoints.
galleryAdminRouter.get('/albums/:id/postcards',asyncHandler(async(req,res)=>res.json(await galleryPostcards.listPostcards(id.parse(req.params.id)))));
galleryAdminRouter.post('/albums/:id/postcards',write,asyncHandler(async(req,res)=>{
 const recipient=z.object({name:z.string().trim().min(1).max(120),address_line1:z.string().trim().min(1).max(200),address_line2:z.string().trim().max(200).default(''),address_city:z.string().trim().min(1).max(100),address_state:z.string().trim().regex(/^[A-Za-z]{2}$/),address_zip:z.string().trim().regex(/^\d{5}(-\d{4})?$/),address_country:z.literal('US')}).strict();
 const b=z.object({person_id:id,media_id:id,recipient,front_url:z.string().url().max(2048),back_url:z.string().url().max(2048),consent:z.literal(true),consent_source:z.string().trim().min(3).max(250)}).strict().parse(req.body);
 res.status(201).json(await galleryPostcards.createPostcard(id.parse(req.params.id),b,req.user));
}));
galleryAdminRouter.post('/albums/:id/postcards/:postcardId/approve',write,asyncHandler(async(req,res)=>res.json(await galleryPostcards.approvePostcard(id.parse(req.params.id),id.parse(req.params.postcardId),req.user))));
galleryAdminRouter.post('/albums/:id/postcards/:postcardId/submit-test',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await galleryPostcards.submitTestPostcard(id.parse(req.params.id),id.parse(req.params.postcardId),req.user))));
galleryAdminRouter.post('/albums/:id/fiesta-shares',write,asyncHandler(async(req,res)=>{
 const input=z.object({csv:z.string().max(1024*1024),eventCode:z.string().regex(/^[A-Za-z0-9_-]+$/).max(100),defaultCountry:z.literal('US').optional()}).strict().parse(req.body);
 res.json(await importFiestaShares(id.parse(req.params.id),input.csv,input.eventCode,req.user,{defaultCountry:input.defaultCountry}));
}));
// Source evidence contains private survey answers: require the same write permission as import.
galleryAdminRouter.get('/albums/:id/fiesta-survey-review',write,asyncHandler(async(req,res)=>res.json(await listFiestaSurveyReview(id.parse(req.params.id),req.user))));
galleryAdminRouter.get('/albums/:id/fiesta-survey-review/:rowId/address',write,asyncHandler(async(req,res)=>{
 res.set('Cache-Control','private, no-store');res.json(await fiestaAddressForReview(id.parse(req.params.id),id.parse(req.params.rowId),req.user));
}));
galleryAdminRouter.patch('/albums/:id/fiesta-survey-review/:rowId/address',write,asyncHandler(async(req,res)=>{
 const address=z.object({name:z.string().trim().min(1).max(120),address_line1:z.string().trim().min(1).max(200),address_line2:z.string().trim().max(200),address_city:z.string().trim().min(1).max(100),address_state:z.string().trim().min(1).max(200),address_zip:z.string().trim().min(1).max(10),address_country:z.string().trim().min(1).max(100)}).strict();
 const input=z.object({address,reason:z.string().trim().min(10).max(2000)}).strict().parse(req.body);
 res.set('Cache-Control','private, no-store');res.json(await updateFiestaAddress(id.parse(req.params.id),id.parse(req.params.rowId),input,req.user));
}));
galleryAdminRouter.get('/albums/:id/fiesta-survey-imports/:batchId/source',write,asyncHandler(async(req,res)=>{
 const csv=await fiestaSurveyEvidence(id.parse(req.params.id),id.parse(req.params.batchId),req.user);
 res.set({'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="fiesta-original-survey.txt"','X-Content-Type-Options':'nosniff'}).send(csv);
}));
// Optional physical-mail CSV import and Lob TEST tracking on the existing event gallery.
galleryAdminRouter.get('/events/:eventId/postcards-overview',asyncHandler(async(req,res)=>res.json(await postcardWorkflow.eventPostcardSummary(id.parse(req.params.eventId)))));
// Lola unified Fiesta → private postcard back & draft preparation. Existing gallery route, no mailing side effects.
// Optional print-ready Lob TEST workflow. Does not expose or publish original gallery photos.
galleryAdminRouter.get('/albums/:id/postcards/:postcardId/print-preview/:side',asyncHandler(async(req,res)=>{const side=z.enum(['front','back']).parse(req.params.side);const buf=await lobPrintReady.previewSide(id.parse(req.params.id),id.parse(req.params.postcardId),side);res.set({'Cache-Control':'private, no-store','Content-Type':'image/png','Content-Disposition':'inline; filename="LOLA-test-postcard.png"'});res.end(buf);}));
galleryAdminRouter.post('/albums/:id/postcards/:postcardId/submit-print-test',write,requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await lobPrintReady.submitLobPrintTest(id.parse(req.params.id),id.parse(req.params.postcardId),req.user))));
galleryAdminRouter.get('/albums/:id/postcards/:postcardId/lob-test-proof',requirePermission('write:integrations'),asyncHandler(async(req,res)=>res.json(await lobPrintReady.lobTestProof(id.parse(req.params.id),id.parse(req.params.postcardId)))));
galleryAdminRouter.get('/albums/:id/postcard-backs',asyncHandler(async(req,res)=>res.json(await galleryArtwork.listBackArtworks(id.parse(req.params.id)))));
galleryAdminRouter.post('/albums/:id/postcard-backs',write,asyncHandler(async(req,res)=>{const b=z.object({filename:z.string().trim().min(1).max(200),mime_type:z.enum(['image/jpeg','image/png']),base64:z.string().min(100).max(9*1024*1024)}).strict().parse(req.body);res.status(201).json(await galleryArtwork.uploadBackArtwork(id.parse(req.params.id),b,req.user));}));
galleryAdminRouter.post('/albums/:id/postcard-backs/:artId/approve',write,asyncHandler(async(req,res)=>res.json(await galleryArtwork.approveBackArtwork(id.parse(req.params.id),id.parse(req.params.artId),req.user))));
galleryAdminRouter.get('/albums/:id/postcard-backs/:artId/media',asyncHandler(async(req,res)=>{const item=await galleryArtwork.artworkMedia(id.parse(req.params.id),id.parse(req.params.artId));res.type(item.mime);res.set({'Cache-Control':'private, no-store','Content-Disposition':'inline; filename="LOLA-postcard-back"'});const {pipeline}=await import('node:stream/promises');await pipeline(item.stream,res);}));
galleryAdminRouter.post('/albums/:id/postcard-recipients/reconcile',write,asyncHandler(async(req,res)=>{await galleryArtwork.reconcileFiestaPostcardRecipients(id.parse(req.params.id));res.json(await postcardWorkflow.listRecipientImports(id.parse(req.params.id)));}));
galleryAdminRouter.post('/albums/:id/postcards/prepare-from-fiesta',write,asyncHandler(async(req,res)=>{const b=z.object({back_artwork_id:id,recipient_ids:z.array(id).min(1).max(100)}).strict().parse(req.body);res.json(await galleryArtwork.prepareBulkPostcards(id.parse(req.params.id),b.back_artwork_id,b.recipient_ids,req.user));}));
galleryAdminRouter.get('/albums/:id/postcard-recipients',asyncHandler(async(req,res)=>res.json(await postcardWorkflow.listRecipientImports(id.parse(req.params.id)))));
galleryAdminRouter.post('/albums/:id/postcard-recipients/import',write,asyncHandler(async(req,res)=>{const b=z.object({csv:z.string().max(512*1024)}).strict().parse(req.body);res.json(await postcardWorkflow.importRecipients(id.parse(req.params.id),b.csv,req.user));}));
galleryAdminRouter.post('/albums/:id/postcard-recipients/:rowId/resolve',write,asyncHandler(async(req,res)=>{const b=z.object({person_id:id,media_id:id}).strict().parse(req.body);res.json(await postcardWorkflow.resolveRecipient(id.parse(req.params.id),id.parse(req.params.rowId),b.person_id,b.media_id,req.user));}));
galleryAdminRouter.post('/albums/:id/postcard-recipients/:rowId/prepare',write,asyncHandler(async(req,res)=>{const b=z.object({front_url:z.string().url().max(2048),back_url:z.string().url().max(2048)}).strict().parse(req.body);res.json(await postcardWorkflow.prepareImportedPostcard(id.parse(req.params.id),id.parse(req.params.rowId),b,req.user));}));
galleryAdminRouter.post('/albums/:id/postcards/approve-batch',write,asyncHandler(async(req,res)=>{const b=z.object({postcard_ids:z.array(id).min(1).max(50)}).strict().parse(req.body);res.json(await postcardWorkflow.batchApprove(id.parse(req.params.id),b.postcard_ids,req.user));}));
galleryAdminRouter.post('/albums/:id/postcards/:postcardId/refresh-test',write,requirePermission('write:integrations'),rateLimit({windowMs:60000,limit:20,standardHeaders:true,legacyHeaders:false}),asyncHandler(async(req,res)=>res.json(await postcardWorkflow.refreshTestStatus(id.parse(req.params.id),id.parse(req.params.postcardId),req.user))));
galleryAdminRouter.get(
  "/albums",
  asyncHandler(async (req, res) =>{const data=[];for(const album of await gallery.listGalleryAlbums())if(await mailingEventAccess(req.user,album.event_id))data.push(album);res.json({data});}),
);
galleryAdminRouter.post(
  "/albums",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        event_id: id,
        title: z.string().trim().min(1).max(200).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(await gallery.createGalleryAlbum(b.event_id, b.title, req.user));
  }),
);
galleryAdminRouter.get(
  "/albums/:id",
  asyncHandler(async (req, res) =>
    res.json(await gallery.adminGalleryAlbum(id.parse(req.params.id))),
  ),
);
galleryAdminRouter.delete('/albums/:id',write,asyncHandler(async(req,res)=>res.json(await deleteGalleryAlbum(id.parse(req.params.id),req.user))));
galleryAdminRouter.post('/albums/:id/reset',write,asyncHandler(async(req,res)=>res.json(await deleteGalleryAlbum(id.parse(req.params.id),req.user,{recreate:true}))));
galleryAdminRouter.post('/albums/:id/media/delete',write,asyncHandler(async(req,res)=>{
  const b=z.object({media_ids:z.array(id).min(1).max(1000)}).strict().parse(req.body);
  res.json(await deleteGalleryPhotos(id.parse(req.params.id),b.media_ids,req.user));
}));
galleryAdminRouter.patch(
  "/albums/:id",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        retention_days:z.union([z.literal(30),z.literal(60),z.literal(90)]).optional(),
        expires_at: date,
        allow_download: z.boolean().optional(),
        allow_zip: z.boolean().optional(),
        allow_personal_download: z.boolean().optional(),
        allow_personal_zip: z.boolean().optional(),
        cover_media_id: id.nullable().optional(),
        source_provider: z.string().max(60).nullable().optional(),
        external_event_id: z.string().max(200).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await gallery.updateGalleryAlbum(id.parse(req.params.id), b, req.user),
    );
  }),
);
galleryAdminRouter.post(
  "/albums/:id/status",
  write,
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.transitionGalleryAlbum(
        id.parse(req.params.id),
        z
          .object({
            status: z.enum([
              "DRAFT",
              "PROCESSING",
              "READY",
              "PUBLISHED",
              "EXPIRED",
              "ARCHIVED",
            ]),
          })
          .parse(req.body).status,
        req.user,
      ),
    ),
  ),
);
galleryAdminRouter.post(
  "/albums/:id/people",
  write,
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(
        await gallery.createGalleryPerson(
          id.parse(req.params.id),
          z
            .object({ display_name: z.string().trim().max(100).optional() })
            .parse(req.body).display_name,
        ),
      ),
  ),
);
galleryAdminRouter.post(
  "/albums/:id/keys",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        type: z.enum(["ALBUM", "PERSON"]),
        person_id: id.nullable().optional(),
        expires_at: date,
      })
      .refine((b) => (b.type === "PERSON" ? !!b.person_id : !b.person_id), {
        message:
          "Personal keys require a person; album keys must not have one.",
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        await gallery.createGalleryKey(
          id.parse(req.params.id),
          b.type,
          b.person_id,
          b.expires_at,
          req.user,
        ),
      );
  }),
);
galleryAdminRouter.get(
  "/keys/:id",
  write,
  asyncHandler(async (req, res) =>
    res.json(await gallery.revealGalleryKey(id.parse(req.params.id))),
  ),
);
galleryAdminRouter.post(
  "/keys/:id/deliver",
  requirePermission("gallery.delivery.send"),
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        recipient: z.string().email(),
        send: z.boolean().default(false),
      })
      .parse(req.body);
    res.json(
      await gallery.deliverGallery(
        id.parse(req.params.id),
        b.recipient,
        req.user,
        b.send,
      ),
    );
  }),
);
galleryAdminRouter.post(
  "/keys/:id/:action",
  write,
  asyncHandler(async (req, res) => {
    const action = z
        .enum(["extend", "regenerate", "revoke"])
        .parse(req.params.action),
      b = z.object({ expires_at: date }).parse(req.body);
    if (
      action === "extend" &&
      (!b.expires_at || Date.parse(b.expires_at) <= Date.now())
    )
      throw new AppError(
        "Choose a future expiration.",
        422,
        "INVALID_EXPIRATION",
      );
    res.json(
      await gallery.changeGalleryKey(
        id.parse(req.params.id),
        action,
        b.expires_at,
        req.user,
      ),
    );
  }),
);
galleryAdminRouter.post(
  "/albums/:id/media",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        filename: z.string().min(1).max(200),
        mime_type: z.enum(["image/jpeg", "image/png", "image/gif", "video/mp4"]),
        base64: z
          .string()
          .min(1)
          .max(14 * 1024 * 1024),
        captured_at: date,
        source_provider: z.string().max(60).optional(),
        external_capture_id: z.string().max(200).optional(),
        source_metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(await gallery.uploadGalleryMedia(id.parse(req.params.id), b));
  }),
);
galleryAdminRouter.post(
  "/albums/:id/media/bulk",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        media_ids: z.array(id).min(1).max(1000),
        action: z.enum([
          "assign",
          "unassign",
          "hide",
          "restore",
          "archive",
          "reorder",
        ]),
        person_id: id.optional(),
      })
      .parse(req.body);
    res.json(
      await gallery.bulkGalleryMedia(id.parse(req.params.id), b, req.user),
    );
  }),
);
galleryAdminRouter.get(
  "/media/:id",
  asyncHandler(async (req, res) =>
    streamMedia(await gallery.adminGalleryMedia(id.parse(req.params.id)), res),
  ),
);
galleryAdminRouter.get(
  "/storage",
  asyncHandler(async (_req, res) => res.json(await galleryStorage().check())),
);
// Provider connectors must authenticate as an authorized operator/integration user.
galleryAdminRouter.get(
  "/imports",
  asyncHandler(async (_req, res) =>
    res.json({ data: await gallery.listGalleryImports() }),
  ),
);
galleryAdminRouter.post(
  "/imports",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        source_provider: z.string().trim().min(1).max(60),
        external_event_id: z.string().min(1).max(200),
        external_capture_id: z.string().min(1).max(200),
        filename: z.string().min(1).max(200),
        mime_type: z.enum(["image/jpeg", "image/png", "image/gif", "video/mp4"]),
        base64: z
          .string()
          .min(1)
          .max(14 * 1024 * 1024),
        source_metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);
    res.status(201).json(await gallery.queueGalleryImport(b, req.user));
  }),
);
galleryAdminRouter.post(
  "/imports/:id/match",
  write,
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.matchGalleryImport(
        id.parse(req.params.id),
        z.object({ album_id: id }).parse(req.body).album_id,
        req.user,
      ),
    ),
  ),
);
galleryAdminRouter.post(
  "/imports/:id/ignore",
  write,
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.ignoreGalleryImport(id.parse(req.params.id), req.user),
    ),
  ),
);

galleryAdminRouter.get(
  "/analytics",
  requirePermission("read:analytics"),
  asyncHandler(async (_req, res) =>
    res.json({ data: await gallery.galleryAnalytics() }),
  ),
);

galleryAdminRouter.patch(
  "/people/:id/downloads",
  write,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        allow_download: z.boolean().nullable(),
        allow_zip: z.boolean().nullable(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await gallery.updateGalleryPersonDownloads(
        id.parse(req.params.id),
        input,
        req.user,
      ),
    );
  }),
);
