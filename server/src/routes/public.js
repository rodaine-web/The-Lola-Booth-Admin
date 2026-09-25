import {authenticate,requirePermission} from '../middleware/auth.js';
import {isStaging,stagingEmailPolicy} from '../config/staging-safety.js';
import { Router } from "express";
import {stagingSitePayload,assertStagingChannel} from '../services/staging-cms-service.js';
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { recordActivity } from "../services/activity-service.js";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { ingestProviderLead } from "../services/social-lead-service.js";
import { sendPublicInquiryEmails } from "../services/public-form-email-service.js";
import { requestInvoiceAccess, publicInvoiceSummary } from "../services/invoice-access-service.js";
import { generatePaymentReceiptPdf } from "../services/document-service.js";
import { generateInvoicePdf } from "../services/document-service.js";
import { getInvoice } from "../services/invoice-service.js";
import { createPaymentSession, publicPaymentOptions } from "../services/payment-service.js";
import { getProposal, proposalPdfBuffer, proposalPreviewHtml, userDocumentFilename } from "../services/proposal-service.js";
import { publicCreativeApproval, respondToCreativeApproval } from "../services/creative-approval-service.js";
import { getStorageProvider } from "../services/storage-service.js";
import { publicDelivery } from "../services/field-operations-service.js";
import {
  publicGallery,
  publicMedia,
  publicSitePayload
} from "../services/website-cms-service.js";

export const publicRouter = Router();

publicRouter.use(rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: 20,
  skip: req => ["GET", "HEAD", "OPTIONS"].includes(req.method),
  standardHeaders: true,
  legacyHeaders: false
}));

const inquirySchema = z.object({
  form_id: z.string().max(80).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160).transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(7).max(40),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  eventEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  eventType: z.string().trim().min(2).max(80),
  guestCount: z.coerce.number().int().positive().optional(),
  venueName: z.string().trim().max(160).optional(),
  venueAddress: z.string().trim().max(240).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(2).max(40),
  zip: z.string().trim().min(3).max(20).optional(),
  preferredExperienceId: z.string().uuid().optional(),
  preferredPackageId: z.string().uuid().optional(),
  referralSource: z.string().trim().max(120).optional(),
  message: z.string().trim().max(3000).optional(),
  utm_source: z.string().trim().max(120).optional(),
  utm_medium: z.string().trim().max(120).optional(),
  utm_campaign: z.string().trim().max(160).optional(),
  utm_content: z.string().trim().max(160).optional(),
  utm_term: z.string().trim().max(160).optional(),
  landing_page_url: z.string().trim().max(500).optional(),
  referrer_url: z.string().trim().max(500).optional(),
  gclid: z.string().trim().max(200).optional(),
  gbraid: z.string().trim().max(200).optional(),
  wbraid: z.string().trim().max(200).optional(),
  fbclid: z.string().trim().max(200).optional(),
  ttclid: z.string().trim().max(200).optional(),
  ga_client_id: z.string().trim().max(200).optional(),
  ga_session_id: z.string().trim().max(200).optional(),
  marketing_email_opt_in: z.boolean().optional(),
  website: z.string().max(0).optional()
});

publicRouter.post("/inquiries", (req, _res, next) => {
  const origin = req.headers.origin;
  if (origin && !env.publicInquiryAllowedOrigins.includes(origin)) {
    return next(new AppError("Inquiry submissions are not allowed from this origin.", 403, "CORS_REJECTED"));
  }
  if (req.body.website) return next(new AppError("Thanks, but we could not accept this inquiry.", 400, "SPAM_DETECTED"));
  return next();
}, validate(inquirySchema), asyncHandler(async (req, res) => {
  const result = await ingestProviderLead({ provider: "WEBSITE", payload: { ...req.body, referrer_url: req.body.referrer_url || req.headers.referer || null } });

  await sendPublicInquiryEmails({
    lead: result.lead,
    payload: { ...req.body, referrer_url: req.body.referrer_url || req.headers.referer || null },
    action: result.action
  }).catch(error => req.log?.error({code:error.code,leadId:result.lead?.id}, "Inquiry persisted but email queueing failed"));
  res.status(201).json({
    message: "Thank you. Your inquiry was received and the LOLA team will be in touch soon.",
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
  res.json(await publicCreativeApproval(req.params.token));
}));

publicRouter.post("/approvals/:token/respond", asyncHandler(async (req, res) => {
  const body = z.object({
    action: z.enum(["approve", "request_changes"]),
    name: z.string().trim().min(2).max(160).optional(),
    email: z.string().trim().email().max(160).optional(),
    notes: z.string().trim().max(3000).optional()
  }).parse(req.body);
  res.json(await respondToCreativeApproval(req.params.token, body));
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
  res.type("html").send(proposalPreviewHtml(proposal));
}));

publicRouter.get("/proposals/:token/pdf", asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.token, { publicView: true });
  const buffer = await proposalPdfBuffer(proposal);
  res.type("application/pdf").attachment(userDocumentFilename("Proposal", proposal.proposal_number, "pdf")).send(buffer);
}));

publicRouter.post("/proposals/:token/accept", asyncHandler(async (req, res) => {
  const body = z.object({ acceptedByName: z.string().trim().min(2).max(160) }).parse(req.body);
  const proposal = await getProposal(req.params.token, { publicView: true });
  if (proposal.status === "ACCEPTED") return res.json({ proposal });
  if (!["SENT", "VIEWED"].includes(proposal.status)) throw new AppError("This proposal is not available for acceptance.", 409, "PROPOSAL_NOT_ACCEPTABLE");
  const version = await query("SELECT id FROM proposal_versions WHERE proposal_id=$1 ORDER BY version_number DESC LIMIT 1", [proposal.id]);
  const updated = await query(
    `UPDATE proposals SET status='ACCEPTED', accepted_at=now(), accepted_by_name=$1, accepted_ip=$2, accepted_user_agent=$3, accepted_version_id=$4, updated_at=now()
     WHERE id=$5 AND status IN ('SENT','VIEWED') AND (valid_through IS NULL OR valid_through >= current_date) RETURNING *`,
    [body.acceptedByName, req.ip, req.headers["user-agent"] || null, version.rows[0]?.id || null, proposal.id]
  );
  if (!updated.rows[0]) throw new AppError("This proposal has already been updated. Refresh to see its current status.",409,"PROPOSAL_STATE_CHANGED");
  await recordActivity({ entityType: "proposal", entityId: proposal.id, action: "proposal_accepted", summary: `Proposal ${proposal.proposal_number} accepted by ${body.acceptedByName}` });
  res.json({ proposal: updated.rows[0] });
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
  res.json({ invoice: publicInvoiceSummary({ ...invoice, status }), paymentOptions: await publicPaymentOptions({ ...invoice, status }) });
}));

publicRouter.post("/invoices/:token/payment-session", asyncHandler(async (req, res) => {
  const body = z.object({ provider: z.enum(["STRIPE", "PAYPAL"]), idempotencyKey: z.string().trim().max(200).optional() }).parse(req.body);
  res.status(201).json(await createPaymentSession({ token: req.params.token, provider: body.provider, idempotencyKey: body.idempotencyKey }));
}));

publicRouter.get("/invoices/:token/pdf", asyncHandler(async (req, res) => {
  const invoice = await getInvoice(req.params.token, { publicView: true });
  const buffer = await generateInvoicePdf(invoice);
  res.type("application/pdf").attachment(`LOLA-Invoice-${String(invoice.invoice_number || "document").replace(/[^a-z0-9._-]+/gi, "-")}.pdf`).send(buffer);
}));

publicRouter.get("/invoices/:token/receipts/:id/pdf",asyncHandler(async(req,res)=>{
 const invoice=await getInvoice(req.params.token,{publicView:true});
 const payment=(await query(`SELECT p.*,i.invoice_number,i.amount_outstanding AS invoice_balance,c.name AS client_name,e.event_name
 FROM payments p JOIN payment_receipts r ON r.payment_id=p.id JOIN invoices i ON i.id=p.invoice_id
 LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN events e ON e.id=p.event_id
 WHERE p.id=$1 AND p.invoice_id=$2 AND p.deleted_at IS NULL`,[z.string().uuid().parse(req.params.id),invoice.id])).rows[0];
 if(!payment)throw new AppError("Receipt not found.",404,"RECEIPT_NOT_FOUND");
 res.type('application/pdf').attachment(`LOLA-Receipt-${payment.id.slice(0,8)}.pdf`).send(await generatePaymentReceiptPdf(payment));
}));
