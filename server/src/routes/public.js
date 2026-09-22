import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { ingestProviderLead } from "../services/social-lead-service.js";
import { sendPublicInquiryEmails } from "../services/public-form-email-service.js";
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
  standardHeaders: true,
  legacyHeaders: false
}));

const inquirySchema = z.object({
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

  res.status(201).json({
    message: "Thank you. Your inquiry was received and the LOLA team will be in touch soon.",
    inquiryStatus: result.action
  });
  void sendPublicInquiryEmails({
    lead: result.lead,
    payload: { ...req.body, referrer_url: req.body.referrer_url || req.headers.referer || null },
    action: result.action
  });
}));

function cachePublicContent(res) {
  res.set("Cache-Control", "public, max-age=0, must-revalidate");
}

publicRouter.get("/site", asyncHandler(async (_req, res) => {
  cachePublicContent(res);
  res.json(await publicSitePayload());
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
  const status = proposal.status === "SENT" ? "VIEWED" : proposal.status;
  await query(
    `UPDATE proposals SET status=$1, first_viewed_at=COALESCE(first_viewed_at, now()), last_viewed_at=now(), view_count=view_count+1, updated_at=now()
     WHERE id=$2`,
    [status, proposal.id]
  );
  res.json({ proposal: { ...proposal, status }, acceptanceWording: (await query("SELECT proposal_acceptance_wording FROM business_settings LIMIT 1")).rows[0]?.proposal_acceptance_wording });
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
  const version = await query("SELECT id FROM proposal_versions WHERE proposal_id=$1 ORDER BY version_number DESC LIMIT 1", [proposal.id]);
  const updated = await query(
    `UPDATE proposals SET status='ACCEPTED', accepted_at=now(), accepted_by_name=$1, accepted_ip=$2, accepted_user_agent=$3, accepted_version_id=$4, updated_at=now()
     WHERE id=$5 RETURNING *`,
    [body.acceptedByName, req.ip, req.headers["user-agent"] || null, version.rows[0]?.id || null, proposal.id]
  );
  await recordActivity({ entityType: "proposal", entityId: proposal.id, action: "proposal_accepted", summary: `Proposal ${proposal.proposal_number} accepted by ${body.acceptedByName}` });
  res.json({ proposal: updated.rows[0] });
}));

publicRouter.post("/proposals/:token/decline", asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.token, { publicView: true });
  const updated = await query("UPDATE proposals SET status='DECLINED', updated_at=now() WHERE id=$1 RETURNING *", [proposal.id]);
  await recordActivity({ entityType: "proposal", entityId: proposal.id, action: "proposal_declined", summary: `Proposal ${proposal.proposal_number} declined` });
  res.json({ proposal: updated.rows[0] });
}));

publicRouter.get("/invoices/:token", asyncHandler(async (req, res) => {
  const invoice = await getInvoice(req.params.token, { publicView: true });
  const status = invoice.status === "SENT" ? "VIEWED" : invoice.status;
  await query(
    `UPDATE invoices SET status=$1, first_viewed_at=COALESCE(first_viewed_at, now()), last_viewed_at=now(), view_count=view_count+1, updated_at=now()
     WHERE id=$2`,
    [status, invoice.id]
  );
  res.json({ invoice: { ...invoice, status }, paymentOptions: await publicPaymentOptions({ ...invoice, status }) });
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
