import { acceptProposal } from '../services/proposal-acceptance-service.js';
import {PostgresPublicRateLimitStore} from '../middleware/postgres-rate-limit-store.js';
import {preparePublicBooking,publicBookingCatalog} from '../services/public-booking-service.js';
import {publicContractsRouter,publicWorkspaceRouter} from './contracts.js';
import {campaignPublicRouter} from "./campaigns.js";
import {inquirySchema,publicFormKind} from "../services/public-form-schema.js";
import {getReceiptView} from "../services/receipt-service.js";
import {authenticate,requirePermission} from '../middleware/auth.js';
import {isStaging,stagingEmailPolicy} from '../config/staging-safety.js';
import { Router } from "express";
import {stagingSitePayload,assertStagingChannel} from '../services/staging-cms-service.js';
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { recordActivity } from "../services/activity-service.js";
import { createNotification } from "../services/notification-service.js";
import { query, transaction } from "../db/pool.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { ingestProviderLead } from "../services/social-lead-service.js";
import { sendPublicInquiryEmails } from "../services/public-form-email-service.js";
import { requestInvoiceAccess, publicInvoiceSummary } from "../services/invoice-access-service.js";
import { checkoutConfirmation } from "../services/checkout-confirmation.js";
import { generatePaymentReceiptPdf } from "../services/document-service.js";
import { generateInvoicePdf } from "../services/document-service.js";
import { getInvoice } from "../services/invoice-service.js";
import { createPaymentSession, publicPaymentOptions } from "../services/payment-service.js";
import { applyBookingConfirmationPolicy } from "../services/payment-reconciliation-service.js";
import { getProposal, proposalPdfBuffer, proposalPreviewHtml, userDocumentFilename } from "../services/proposal-service.js";
import { publicCreativeApproval, publicCreativeProof, respondToCreativeApproval } from "../services/creative-approval-service.js";
import { getStorageProvider } from "../services/storage-service.js";
import { publicDelivery } from "../services/field-operations-service.js";
import {
  publicGallery,
  publicMedia,
  publicSitePayload
} from "../services/website-cms-service.js";

import { publicPlanningRouter } from "./event-planning.js";
export const publicRouter = Router();
publicRouter.use('/staging',(_req,_res,next)=>isStaging()?next():next(new AppError('Staging routes are unavailable in this environment.',404,'NOT_FOUND')));

publicRouter.use(rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: Math.max(1, Math.min(10000, Number(process.env.PUBLIC_WRITE_RATE_LIMIT_MAX)||20)),
  store: new PostgresPublicRateLimitStore(),
  message:{error:{code:"RATE_LIMITED",message:"We’re receiving too many requests right now. Please wait a little and try again."}},
  skip: req => ["GET", "HEAD", "OPTIONS"].includes(req.method),
  standardHeaders: true,
  legacyHeaders: false
}));
publicRouter.use("/planning",publicPlanningRouter);
publicRouter.use('/contracts', publicContractsRouter);
publicRouter.use('/workspaces', publicWorkspaceRouter);



publicRouter.use(campaignPublicRouter);

publicRouter.get("/booking-catalog",asyncHandler(async (_req,res)=>{res.set("Cache-Control","no-store").json(await publicBookingCatalog());}));

publicRouter.post("/inquiries", (req, _res, next) => {
  if(!req.body || typeof req.body!=="object" || Array.isArray(req.body))return next(new AppError("Submit a JSON inquiry object.",400,"INVALID_REQUEST"));
  if(Buffer.byteLength(JSON.stringify(req.body))>65536)return next(new AppError("This request is too large.",413,"REQUEST_TOO_LARGE"));
  const origin = req.headers.origin;
  if (origin && !env.publicInquiryAllowedOrigins.includes(origin)) {
    return next(new AppError("Inquiry submissions are not allowed from this origin.", 403, "CORS_REJECTED"));
  }
  if (req.body.website) return next(new AppError("Thanks, but we could not accept this inquiry.", 400, "SPAM_DETECTED"));
  return next();
}, validate(inquirySchema), asyncHandler(async (req, res) => {
  const payload = {...req.body, referrer_url: req.body.referrer_url || req.headers.referer || null};
  if (isStaging()) {
    if(!payload.selections)payload.marketing_email_opt_in = false;
    for (const [field,type] of [['preferredExperienceId','experiences'],['preferredPackageId','packages']]) if (payload[field]) {
      const record = (await query("SELECT payload FROM website_channel_records WHERE id=$1 AND channel='STAGING' AND cms_type=$2 AND status='PUBLISHED'", [payload[field],type])).rows[0];
      if (!record?.payload.source_catalog_id) throw new AppError('Choose an available staging catalog item.',422,'STAGING_SELECTION_INVALID');
      payload[field] = record.payload.source_catalog_id;
    }
  }
  const result = await transaction(async()=>{
    const validated=await preparePublicBooking(payload);
    return ingestProviderLead({provider: "WEBSITE", payload:validated, testMode: isStaging(), skipAutomations: isStaging() || publicFormKind(payload)==="CONTACT"});
  });

  await sendPublicInquiryEmails({
    lead: result.lead,
    payload: { ...req.body, referrer_url: req.body.referrer_url || req.headers.referer || null },
    action: result.action
  }).catch(error => req.log?.error({code:error.code,leadId:result.lead?.id}, "Inquiry persisted but email queueing failed"));
  res.status(201).json({
    message: publicFormKind(payload)==="CONTACT" ? "Thank you. Your message was received. The LOLA team will get back to you soon." : "Thank you. Your booking request was received. We will review availability and send next steps; your date is not reserved yet.",
    inquiryStatus: result.action
  });
}));

// Authenticated QA-only form path. Existing public form behavior remains unchanged.
publicRouter.post('/staging/inquiries',authenticate,requirePermission('write:sales'),validate(inquirySchema),asyncHandler(async(req,res)=>{
  if(!isStaging())throw new AppError('Staging forms are unavailable.',404,'NOT_FOUND');
  const owner=process.env.STAGING_FORM_OWNER_EMAIL;
  if(!owner)throw new AppError('Choose an approved QA owner inbox before form qualification.',409,'STAGING_OWNER_REQUIRED');
  stagingEmailPolicy({to:req.body.email,cc:owner,subject:'Form recipient validation'},{...process.env,STAGING_EMAIL_ENABLED:'true'});
  const payload={...req.body,form_id:'staging-'+(req.body.form_id||'inquiry'),marketing_email_opt_in:false,referrer_url:req.body.referrer_url||req.headers.referer||null};
  for(const [field,type] of [['preferredExperienceId','experiences'],['preferredPackageId','packages']])if(payload[field]){
    const record=(await query("SELECT payload FROM website_channel_records WHERE id=$1 AND channel='STAGING' AND cms_type=$2 AND status='PUBLISHED'",[payload[field],type])).rows[0];
    if(!record)throw new AppError('Choose an available staging package or experience.',422,'STAGING_SELECTION_INVALID');
    if(record.payload.source_catalog_id)payload[field]=record.payload.source_catalog_id;else delete payload[field];
  }
  const result=await ingestProviderLead({provider:'WEBSITE',payload,testMode:true,skipAutomations:true});
  await sendPublicInquiryEmails({lead:result.lead,payload,action:result.action,ownerRecipient:owner});
  res.status(201).json({message:'Staging QA inquiry saved. Email delivery is controlled by the qualification queue.',inquiryStatus:result.action,leadId:result.lead.id});
}));

function cachePublicContent(res) {
  res.set("Cache-Control", "public, max-age=0, must-revalidate");
}

publicRouter.get("/site", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json(await publicSitePayload());
}));

publicRouter.get('/staging/site',asyncHandler(async(req,res)=>{
  assertStagingChannel(req.query);
  res.set('Cache-Control','no-store').set('X-Robots-Tag','noindex, nofollow').json(await stagingSitePayload());
}));
publicRouter.get('/staging/media/:id',asyncHandler(async(req,res)=>{
  const row=(await query("SELECT payload FROM website_channel_records WHERE id=$1 AND channel='STAGING' AND cms_type='media' AND status='PUBLISHED'",[req.params.id])).rows[0];
  if(!row?.payload.storage_key)throw new AppError('Staging image not found.',404,'NOT_FOUND');
  res.set('Cache-Control','no-store').set('Cross-Origin-Resource-Policy','cross-origin').type(row.payload.mime_type).send(await getStorageProvider().get(row.payload.storage_key));
}));

publicRouter.get("/homepage", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  const site = await publicSitePayload();
  res.json({ defaults: site.defaults, settings: site.settings, content: site.content, heroSlides: site.heroSlides, testimonials: site.testimonials });
}));

publicRouter.get("/hero-slides", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json({ data: (await publicSitePayload()).heroSlides });
}));

publicRouter.get("/packages", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json({ data: (await publicSitePayload()).packages });
}));

publicRouter.get("/experiences", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json({ data: (await publicSitePayload()).experiences });
}));

publicRouter.get("/events", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json({ data: (await publicSitePayload()).eventTypes });
}));

publicRouter.get("/gallery", asyncHandler(async (req, res) => {
  cachePublicContent(res);
  res.json({ data: await publicGallery({ category: req.query.category, featured: req.query.featured === undefined ? undefined : req.query.featured === "true" }) });
}));

publicRouter.get("/testimonials", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json({ data: (await publicSitePayload()).testimonials });
}));

publicRouter.get("/faqs", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json({ data: (await publicSitePayload()).faqs });
}));

publicRouter.get("/media/:id", asyncHandler(async (req, res) => {
  const media = await publicMedia(req.params.id);
  const buffer = await getStorageProvider().get(media.storage_key);
  res.set("Cache-Control", "public, max-age=86400");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.type(media.mime_type).send(buffer);
}));

publicRouter.get("/delivery/:token", asyncHandler(async (req, res) => {
  res.json(await publicDelivery(req.params.token));
}));

publicRouter.get("/approvals/:token", asyncHandler(async (req, res) => {
  res.set({"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}).json(await publicCreativeApproval(req.params.token));
}));

publicRouter.get("/approvals/:token/proof", asyncHandler(async (req,res) => {
  const file = await publicCreativeProof(req.params.token);
  res.set({"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":"sandbox"}).type(file.mime_type).attachment(file.filename).send(await getStorageProvider().get(file.storage_key));
}));

publicRouter.post("/approvals/:token/respond", asyncHandler(async (req, res) => {
  const body = z.object({
    action: z.enum(["approve", "request_changes"]),
    version: z.number().int().positive(),
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(160),
    notes: z.string().trim().max(3000).optional()
  }).parse(req.body);
  res.json(await respondToCreativeApproval(req.params.token, body, req));
}));

publicRouter.get("/proposals/:token", asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.token, { publicView: true });
  const viewed = await query(
    `UPDATE proposals SET status=CASE WHEN status='SENT' THEN 'VIEWED' ELSE status END, first_viewed_at=COALESCE(first_viewed_at, now()), last_viewed_at=now(), view_count=view_count+1, updated_at=now()
     WHERE id=$1 RETURNING status`,
    [proposal.id]
  );
  res.json({ proposal: { ...proposal, status: viewed.rows[0].status }, acceptanceWording: (await query("SELECT proposal_acceptance_wording FROM business_settings LIMIT 1")).rows[0]?.proposal_acceptance_wording });
}));

publicRouter.get("/proposals/:token/preview", asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.token, { publicView: true });
  res.type("html").send(await proposalPreviewHtml(proposal));
}));

publicRouter.get("/proposals/:token/pdf", asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.token, { publicView: true });
  const buffer = await proposalPdfBuffer(proposal);
  res.type("application/pdf").attachment(userDocumentFilename("Proposal", proposal.proposal_number, "pdf")).send(buffer);
}));

publicRouter.post("/proposals/:token/accept", asyncHandler(async (req, res) => {
  const body = z.object({ acceptedByName: z.string().trim().min(2).max(160) }).parse(req.body);
  const proposal = await getProposal(req.params.token, { publicView: true });
  const accepted = await acceptProposal(proposal.id, body.acceptedByName, req);
  const automatic = accepted.invoiceQueued;
  const nextStep = automatic ? { action: "INVOICE_QUEUED", label: "Your invoice will be emailed to you" }
    : { action: "CREATE_DEPOSIT_INVOICE", label: "Create and send deposit invoice" };
  if (accepted.duplicate) return res.json({ proposal: accepted.proposal, nextStep });
  if (proposal.event_id) await applyBookingConfirmationPolicy(proposal.event_id);
  await createNotification({ roleTarget: "OWNER_ADMIN", category: "SALES", severity: "HIGH", title: `Proposal ${proposal.proposal_number} accepted`, body: `${proposal.client_name || "Client"} accepted ${proposal.proposal_number}. ${automatic ? "The invoice handoff is queued." : "Next step: create and send the deposit invoice."}`, entityType: "proposal", entityId: proposal.id, actionUrl: `/sales/proposals/${proposal.id}`, metadata: { nextStep: nextStep.action, acceptedBy: body.acceptedByName }, email: { enabled: true, subject: `LOLA: ${proposal.proposal_number} accepted`, body: `${proposal.client_name || "Client"} accepted the proposal. ${automatic ? "The invoice handoff is queued for delivery." : "Create and send the deposit invoice from the Admin portal."}` } }).catch(error => req.log?.warn({ code:error.code }, "Proposal acceptance notification failed"));
  res.json({ proposal: accepted.proposal, nextStep });
}));

publicRouter.post("/proposals/:token/decline", asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.token, { publicView: true });
  const updated = await query("UPDATE proposals SET status='DECLINED', updated_at=now() WHERE id=$1 AND status IN ('SENT','VIEWED') RETURNING *", [proposal.id]);
  if (!updated.rows[0]) throw new AppError("This proposal is not available to decline.",409,"PROPOSAL_STATE_CHANGED");
  await recordActivity({ entityType: "proposal", entityId: proposal.id, action: "proposal_declined", summary: `Proposal ${proposal.proposal_number} declined` });
  res.json({ proposal: updated.rows[0] });
}));

publicRouter.post("/invoice-access", asyncHandler(async(req,res)=>{
 const body=z.object({invoiceNumber:z.string().trim().min(1).max(80),email:z.string().trim().email().max(160)}).parse(req.body);
 res.json(await requestInvoiceAccess(body));
}));

publicRouter.get("/invoices/:token", asyncHandler(async (req, res) => {
  const invoice = await getInvoice(req.params.token, { publicView: true });
  const status = invoice.status === "SENT" ? "VIEWED" : invoice.status;
  await query(
    `UPDATE invoices SET status=CASE WHEN status='SENT' THEN $1 ELSE status END, first_viewed_at=COALESCE(first_viewed_at, now()), last_viewed_at=now(), view_count=view_count+1, updated_at=now()
     WHERE id=$2`,
    [status, invoice.id]
  );
  const sessionId = z.string().max(255).optional().parse(req.query.session_id);
  res.set('Cache-Control', 'no-store').json({ invoice: publicInvoiceSummary({ ...invoice, status }), paymentOptions: await publicPaymentOptions({ ...invoice, status }), checkoutConfirmation: checkoutConfirmation(invoice, sessionId) });
}));

publicRouter.post("/invoices/:token/payment-session", asyncHandler(async (req, res) => {
  const body = z.object({ provider: z.enum(["STRIPE", "PAYPAL"]), amountChoice: z.enum(["DEPOSIT","FULL","CUSTOM"]).default("DEPOSIT"), customAmount: z.coerce.number().positive().optional(), idempotencyKey: z.string().trim().max(200).optional() }).parse(req.body);
  res.status(201).json(await createPaymentSession({ token: req.params.token, provider: body.provider, amountChoice: body.amountChoice, customAmount: body.customAmount, idempotencyKey: body.idempotencyKey }));
}));

publicRouter.get("/invoices/:token/pdf", asyncHandler(async (req, res) => {
  const invoice = await getInvoice(req.params.token, { publicView: true });
  const buffer = await generateInvoicePdf(invoice);
  res.type("application/pdf").attachment(`LOLA-Invoice-${String(invoice.invoice_number || "document").replace(/[^a-z0-9._-]+/gi, "-")}.pdf`).send(buffer);
}));

publicRouter.get("/invoices/:token/receipts/:id/pdf",asyncHandler(async(req,res)=>{
 const invoice=await getInvoice(req.params.token,{publicView:true});
 const receipt=await getReceiptView(invoice,z.string().uuid().parse(req.params.id));
 res.set('Cache-Control','private, no-store').type('application/pdf').attachment(`LOLA-Receipt-${receipt.number}.pdf`).send(await generatePaymentReceiptPdf(receipt));
}));

publicRouter.get('/invoices/:token/receipts/:id',asyncHandler(async(req,res)=>{const invoice=await getInvoice(req.params.token,{publicView:true});res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}).json(await getReceiptView(invoice,z.string().uuid().parse(req.params.id)));}));
