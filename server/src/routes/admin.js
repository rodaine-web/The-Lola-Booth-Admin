import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { writeAudit } from "../middleware/audit.js";
import { query, transaction } from "../db/pool.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError, notFound } from "../utils/errors.js";
import { paginationSchema, validate, uuid, money } from "../utils/validation.js";
import { calculateBookingPricing } from "../services/pricing-service.js";
import { checkAvailability } from "../services/availability-service.js";
import { logAutomationEvent, recordActivity } from "../services/activity-service.js";
import { getDashboardRangeFoundation } from "../services/dashboard-ranges-service.js";
import {
  createProposal,
  buildProposalSnapshot,
  generateAndStoreProposal,
  getProposal,
  nextNumber,
  proposalPreviewHtml,
  createProposalVersion,
  sendProposal
} from "../services/proposal-service.js";
import {
  createInvoice,
  generateAndStoreInvoice,
  getInvoice,
  sendInvoice
} from "../services/invoice-service.js";
import { generateInvoicePdf, generatePaymentReceiptPdf, generateProposalDocx, generateProposalPdf } from "../services/document-service.js";
import {
  createRefund,
  getPayment,
  providerStatus,
  recordManualPayment
} from "../services/payment-service.js";
import { previewPaymentReminders } from "../services/payment-reminder-service.js";
import { getOperationalCalendar, getOperationalDashboard } from "../services/operational-intelligence-service.js";
import {
  failedInboundLeads,
  ingestProviderLead,
  integrationOverview,
  lolaLeadFields,
  retryInboundLead,
  resolveInboundLead,
  saveFieldMap,
  sourceQualityAnalytics,
  updateIntegrationState
} from "../services/social-lead-service.js";
import {
  listAutomations,
  listEmailTemplates,
  previewEmailTemplate,
  processDueJobs,
  triggerAutomations,
  updateAutomation,
  updateEmailTemplate
} from "../services/automation-service.js";
import { sendEmail } from "../services/email-service.js";
import {
  acknowledgeAssignment,
  addEventNote,
  attendantHome,
  cancelEventOperations,
  completeEvent,
  createChecklistTemplate,
  createIncident,
  generateRunSheetPdf,
  getEventOperations,
  instantiateChecklist,
  listChecklistTemplates,
  operationsAnalytics,
  rescheduleEvent,
  transitionOperationalStatus,
  updateChecklistItem,
  updateEquipmentLifecycle,
  updateGallery,
  updateIncident,
  upsertCreative,
  upsertEventContact
} from "../services/event-operations-service.js";
import {
  createOrSendGalleryDelivery,
  equipmentScanLookup,
  generateEquipmentLabelsPdf,
  replayOfflineAction,
  revokeGalleryDelivery,
  sendStaffBrief
} from "../services/field-operations-service.js";
import {
  dismissNotification,
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  updateNotificationPreferences
} from "../services/notification-service.js";
import {
  adminMedia,
  archiveCmsRecord,
  archiveMedia,
  createCmsRecord,
  getGalleryCategories,
  listCmsRecords,
  listMedia,
  publishCmsRecord,
  reorderCmsRecords,
  unpublishCmsRecord,
  updateCmsRecord,
  updateMedia,
  updateSiteSettings,
  uploadMedia,
  websiteContentDefaults,
  publicSitePayload
} from "../services/website-cms-service.js";
import { getStorageProvider } from "../services/storage-service.js";
import { cancelSystemJob, getSystemHealth, listSystemJobs, retrySelectedSystemJobs, retrySystemJob } from "../services/system-health-service.js";

export const adminRouter = Router();

adminRouter.use(authenticate);

const eventStatuses = ["INQUIRY", "TENTATIVE", "CONFIRMED", "PREPARING", "READY", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DRAFT", "PENDING_CONTRACT", "PENDING_DEPOSIT"];
const leadStatuses = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_DRAFT", "PROPOSAL_SENT", "FOLLOW_UP", "WON", "LOST", "ARCHIVED"];
const taskStatuses = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];
const taskPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
const proposalStatuses = ["DRAFT", "READY", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED", "ARCHIVED"];
const invoiceStatuses = ["DRAFT", "SENT", "VIEWED", "PARTIALLY_PAID", "PARTIAL", "PAID", "OVERDUE", "VOID", "REFUNDED"];

function cleanPatch(body, allowed) {
  return Object.fromEntries(Object.entries(body).filter(([key, value]) => allowed.includes(key) && value !== undefined));
}

async function updateById({ table, id, body, allowed }) {
  const fields = Object.keys(cleanPatch(body, allowed));
  if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
  const values = fields.map((field) => body[field]);
  values.push(id);
  const result = await query(
    `UPDATE ${table} SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=now()
     WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *`,
    values
  );
  if (!result.rows[0]) throw notFound(table);
  return result.rows[0];
}

function requireAdminOverride(req) {
  const roles = req.user?.roles || [];
  return roles.includes("OWNER") || roles.includes("ADMIN");
}

function requireAnyPermission(...permissions) {
  return (req, _res, next) => {
    const userPermissions = req.user?.permissions || [];
    if (userPermissions.includes("*") || permissions.some((permission) => userPermissions.includes(permission))) return next();
    return next(new AppError("You do not have access to this area.", 403, "FORBIDDEN"));
  };
}

function listRoute(table, searchable = [], permission = "read:admin") {
  return [
    requirePermission(permission),
    validate(paginationSchema, "query"),
    asyncHandler(async (req, res) => {
      const filters = req.validatedQuery;
      const page = filters.page;
      const pageSize = filters.pageSize || filters.page_size;
      const offset = (page - 1) * pageSize;
      const where = ["deleted_at IS NULL"];
      const params = [];
      if (filters.status) {
        params.push(filters.status);
        where.push(`status = $${params.length}`);
      }
      if (table === "leads") {
        if (filters.source) {
          params.push(filters.source);
          where.push(`(lead_source = $${params.length} OR source_subtype = $${params.length} OR provider = $${params.length})`);
        }
        if (filters.campaign) {
          params.push(filters.campaign);
          where.push(`(campaign = $${params.length} OR campaign_name = $${params.length} OR utm_campaign = $${params.length})`);
        }
        if (filters.assigned_user) {
          params.push(filters.assigned_user);
          where.push(`assigned_user_id = $${params.length}`);
        }
        if (filters.event_date) {
          params.push(filters.event_date);
          where.push(`event_date = $${params.length}`);
        }
      }
      if (table === "events") {
        if (filters.date_from) {
          params.push(filters.date_from);
          where.push(`event_date >= $${params.length}`);
        }
        if (filters.date_to) {
          params.push(filters.date_to);
          where.push(`event_date <= $${params.length}`);
        }
        if (filters.event_type) {
          params.push(filters.event_type);
          where.push(`event_type = $${params.length}`);
        }
        if (filters.experience) {
          params.push(filters.experience);
          where.push(`experience_id = $${params.length}`);
        }
        if (filters.package) {
          params.push(filters.package);
          where.push(`package_id = $${params.length}`);
        }
      }
      if (table === "tasks") {
        if (filters.priority) {
          params.push(filters.priority);
          where.push(`priority = $${params.length}`);
        }
        if (filters.assigned_user) {
          params.push(filters.assigned_user);
          where.push(`assigned_user_id = $${params.length}`);
        }
        if (filters.due_before) {
          params.push(filters.due_before);
          where.push(`due_date < $${params.length}`);
        }
        if (filters.overdue === "true" || filters.overdue === true) {
          where.push(`due_date < current_date AND status <> 'DONE'`);
        }
      }
      if (filters.search && searchable.length) {
        params.push(`%${filters.search}%`);
        where.push(`(${searchable.map((field) => `${field} ILIKE $${params.length}`).join(" OR ")})`);
      }
      const sortable = new Set(["created_at", "updated_at", "event_date", "due_date", "display_order", "name", "status"]);
      const sortBy = sortable.has(filters.sort_by || filters.sort) ? (filters.sort_by || filters.sort) : "created_at";
      const direction = String(filters.sort_direction || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
      params.push(pageSize, offset);
      const rows = await query(
        `SELECT * FROM ${table} WHERE ${where.join(" AND ")} ORDER BY ${sortBy} ${direction} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const count = await query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where.join(" AND ")}`, params.slice(0, -2));
      res.json({ data: rows.rows, pagination: { page, pageSize, total: count.rows[0].count } });
    })
  ];
}

async function recordGeneratedFile({ req, document, entityType, entity }) {
  const result = await query(
    `INSERT INTO files (client_id, event_id, lead_id, category, filename, storage_provider, storage_key, mime_type, size_bytes, uploaded_by, visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'INTERNAL') RETURNING *`,
    [
      entity.client_id || null,
      entity.event_id || null,
      entity.lead_id || null,
      entityType === "invoice" ? "INVOICE" : "PROPOSAL",
      document.filename,
      document.storageProvider,
      document.storageKey,
      document.mimeType,
      document.sizeBytes,
      req.user.id
    ]
  );
  return result.rows[0];
}

async function pickerRows(search, sql) {
  const term = `%${search || ""}%`;
  const result = await query(sql, [term]);
  return result.rows;
}

const proposalSchema = z.object({
  lead_id: uuid.optional().nullable(),
  client_id: uuid.optional().nullable(),
  event_id: uuid.optional().nullable(),
  package_id: uuid.optional().nullable(),
  experience_id: uuid.optional().nullable(),
  status: z.enum(proposalStatuses).optional(),
  valid_through: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  introduction: z.string().optional().nullable(),
  experience_name: z.string().optional().nullable(),
  experience_description: z.string().optional().nullable(),
  package_name: z.string().optional().nullable(),
  package_description: z.string().optional().nullable(),
  next_steps: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  package_amount: z.coerce.number().optional().nullable(),
  experience_surcharge: z.coerce.number().optional().nullable(),
  travel: z.coerce.number().optional().nullable(),
  other_fees: z.coerce.number().optional().nullable(),
  discount: z.coerce.number().optional().nullable(),
  tax_rate: z.coerce.number().optional().nullable(),
  deposit_type: z.enum(["PERCENTAGE", "FIXED"]).optional(),
  deposit_value: z.coerce.number().optional().nullable(),
  balance_due_date: z.string().optional().nullable(),
  addons: z.array(z.object({
    addon_id: uuid,
    quantity: z.coerce.number().positive().default(1),
    unit_price: z.coerce.number().optional().nullable(),
    description: z.string().optional().nullable(),
    pricing_type: z.string().optional().nullable()
  })).optional()
}).passthrough();

const invoiceSchema = z.object({
  proposal_id: uuid.optional().nullable(),
  client_id: uuid.optional().nullable(),
  event_id: uuid.optional().nullable(),
  due_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  depositOnly: z.boolean().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    quantity: z.coerce.number().positive().default(1),
    unit_price: z.coerce.number().min(0),
    taxable: z.boolean().optional(),
    tax_rate: z.coerce.number().min(0).optional(),
    discount: z.coerce.number().min(0).optional()
  })).optional()
}).passthrough();

adminRouter.get("/dashboard", requirePermission("read:dashboard"), asyncHandler(async (req, res) => {
  res.json(await getOperationalDashboard({ range: req.query.range || "today", user: req.user }));
}));

adminRouter.get("/dashboard/ranges", requirePermission("read:dashboard"), asyncHandler(async (_req, res) => {
  res.json(await getDashboardRangeFoundation());
}));

adminRouter.get("/system/health", requirePermission("read:settings"), asyncHandler(async (_req, res) => {
  res.json(await getSystemHealth());
}));

adminRouter.get("/system/jobs", requirePermission("read:settings"), asyncHandler(async (_req, res) => {
  res.json(await listSystemJobs());
}));

adminRouter.post("/system/jobs/:id/retry", requirePermission("write:settings"), asyncHandler(async (req, res) => {
  const job = await retrySystemJob(req.params.id);
  await writeAudit({ req, action: "automation_job_retried", entity: "automation_job", entityId: req.params.id, after: job });
  res.json(job);
}));

adminRouter.post("/system/jobs/retry-selected", requirePermission("write:settings"), asyncHandler(async (req, res) => {
  const result = await retrySelectedSystemJobs(req.body.ids || []);
  await writeAudit({ req, action: "automation_jobs_retried", entity: "automation_job", after: result });
  res.json(result);
}));

adminRouter.post("/system/jobs/:id/cancel", requirePermission("write:settings"), asyncHandler(async (req, res) => {
  const job = await cancelSystemJob(req.params.id);
  await writeAudit({ req, action: "automation_job_cancelled", entity: "automation_job", entityId: req.params.id, after: job });
  res.json(job);
}));

adminRouter.get("/notifications", requirePermission("read:notifications"), asyncHandler(async (req, res) => {
  res.json(await listNotifications(req.user, req.query));
}));

adminRouter.get("/notifications/count", requirePermission("read:notifications"), asyncHandler(async (req, res) => {
  res.json({ unread: await unreadNotificationCount(req.user) });
}));

adminRouter.post("/notifications/mark-all-read", requirePermission("read:notifications"), asyncHandler(async (req, res) => {
  res.json(await markAllNotificationsRead(req.user));
}));

adminRouter.get("/notifications/preferences", requirePermission("read:notifications"), asyncHandler(async (req, res) => {
  res.json(await getNotificationPreferences(req.user.id));
}));

adminRouter.patch("/notifications/preferences", requirePermission("read:notifications"), asyncHandler(async (req, res) => {
  const updated = await updateNotificationPreferences(req.user.id, req.body);
  await writeAudit({ req, action: "notification_preferences_changed", entity: "user", entityId: req.user.id, after: updated });
  res.json(updated);
}));

adminRouter.patch("/notifications/:id/read", requirePermission("read:notifications"), asyncHandler(async (req, res) => {
  res.json(await markNotificationRead(req.params.id, req.user));
}));

adminRouter.delete("/notifications/:id", requirePermission("read:notifications"), asyncHandler(async (req, res) => {
  res.json(await dismissNotification(req.params.id, req.user));
}));

adminRouter.post("/offline-actions/replay", requirePermission("read:attendant"), asyncHandler(async (req, res) => {
  res.status(202).json(await replayOfflineAction(req.user, req.body));
}));

adminRouter.get("/scan/equipment/:token", requireAnyPermission("event.operations.view", "read:attendant"), asyncHandler(async (req, res) => {
  res.json(await equipmentScanLookup(req.params.token, req.user, req.query.eventId || null));
}));

adminRouter.get("/leads", ...listRoute("leads", ["first_name", "last_name", "email", "phone", "event_type"], "read:sales"));

const leadSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  event_date: z.string(),
  event_start_time: z.string().optional().nullable(),
  event_end_time: z.string().optional().nullable(),
  event_type: z.string().min(1),
  guest_count: z.number().int().optional().nullable(),
  venue_name: z.string().optional().nullable(),
  venue_address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  preferred_experience_id: uuid.optional().nullable(),
  preferred_package_id: uuid.optional().nullable(),
  referral_source: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  assigned_user_id: uuid.optional().nullable(),
  status: z.enum(leadStatuses).default("NEW"),
  company: z.string().optional().nullable(),
  preferred_contact_method: z.string().optional().nullable(),
  estimated_budget: money.optional().nullable(),
  campaign: z.string().optional().nullable(),
  utm_source: z.string().optional().nullable(),
  utm_medium: z.string().optional().nullable(),
  utm_campaign: z.string().optional().nullable(),
  utm_content: z.string().optional().nullable(),
  marketing_email_opt_in: z.boolean().optional(),
  follow_up_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
}).passthrough();

adminRouter.post("/leads", requirePermission("write:sales"), validate(leadSchema), asyncHandler(async (req, res) => {
  if (!req.query.continueAnyway) {
    const duplicate = await query(
      `SELECT id, first_name, last_name, email, phone
       FROM leads
       WHERE deleted_at IS NULL AND (lower(email)=lower($1) OR regexp_replace(phone, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g'))
       LIMIT 1`,
      [req.body.email, req.body.phone]
    );
    if (duplicate.rows[0]) {
      throw new AppError("Possible duplicate lead found.", 409, "POSSIBLE_DUPLICATE", { duplicate: duplicate.rows[0] });
    }
  }
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  const inserted = await query(
    `INSERT INTO leads (${fields.join(",")}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(",")}) RETURNING *`,
    values
  );
  await recordActivity({ actorUserId: req.user.id, entityType: "lead", entityId: inserted.rows[0].id, action: "lead_created", summary: "Lead created manually" });
  await writeAudit({ req, action: "lead_created", entity: "lead", entityId: inserted.rows[0].id, after: inserted.rows[0] });
  res.status(201).json(inserted.rows[0]);
}));

adminRouter.get("/leads/:id", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const lead = await query("SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!lead.rows[0]) throw notFound("Lead");
  const [timeline, communications, proposals, tasks, files, packageResult, experienceResult] = await Promise.all([
    query("SELECT * FROM activities WHERE entity_type='lead' AND entity_id=$1 ORDER BY created_at DESC", [req.params.id]),
    query("SELECT * FROM communications WHERE lead_id=$1 AND deleted_at IS NULL ORDER BY occurred_at DESC", [req.params.id]),
    query("SELECT * FROM proposals WHERE lead_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [req.params.id]),
    query("SELECT * FROM tasks WHERE lead_id=$1 AND deleted_at IS NULL ORDER BY due_date NULLS LAST", [req.params.id]),
    query("SELECT * FROM files WHERE lead_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [req.params.id]),
    query("SELECT id, name, starting_price, duration FROM packages WHERE id=$1", [lead.rows[0].preferred_package_id]),
    query("SELECT id, name, base_price, default_duration FROM experiences WHERE id=$1", [lead.rows[0].preferred_experience_id])
  ]);
  res.json({
    ...lead.rows[0],
    preferredPackage: packageResult.rows[0] || null,
    preferredExperience: experienceResult.rows[0] || null,
    timeline: timeline.rows,
    communications: communications.rows,
    proposals: proposals.rows,
    tasks: tasks.rows,
    files: files.rows
  });
}));

adminRouter.patch("/leads/:id", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Lead");
  const allowed = [
    "first_name", "last_name", "email", "phone", "company", "preferred_contact_method",
    "event_type", "event_date", "event_start_time", "event_end_time", "venue_name",
    "venue_address", "city", "state", "zip", "guest_count", "preferred_package_id",
    "preferred_experience_id", "estimated_budget", "lead_source", "campaign", "referral_source",
    "assigned_user_id", "status", "follow_up_date", "notes", "message",
    "campaign", "utm_source", "utm_medium", "utm_campaign", "utm_content",
    "marketing_email_opt_in", "first_contacted_at"
  ];
  const fields = Object.keys(req.body).filter((key) => allowed.includes(key));
  if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
  const values = fields.map((field) => req.body[field]);
  values.push(req.params.id);
  const updated = await query(`UPDATE leads SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(",")}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
  if (fields.includes("first_contacted_at") || (fields.includes("status") && req.body.status === "CONTACTED")) {
    const contactedAt = req.body.first_contacted_at || new Date().toISOString();
    await query(
      `UPDATE leads
       SET first_contacted_at=COALESCE(first_contacted_at,$1),
           response_time_minutes=COALESCE(response_time_minutes, floor(extract(epoch from ($1::timestamptz - COALESCE(received_at, created_at))) / 60)::int)
       WHERE id=$2`,
      [contactedAt, req.params.id]
    );
  }
  await recordActivity({ actorUserId: req.user.id, entityType: "lead", entityId: req.params.id, action: fields.includes("status") ? "lead_status_changed" : fields.includes("assigned_user_id") ? "lead_assigned" : "lead_updated", summary: "Lead updated" });
  if (fields.includes("status")) await triggerAutomations({ triggerKey: "LEAD_STATUS_CHANGED", entityType: "lead", entityId: req.params.id, payload: { status: req.body.status } });
  await writeAudit({ req, action: fields.includes("status") ? "lead_status_changed" : fields.includes("assigned_user_id") ? "lead_assigned" : "lead_edited", entity: "lead", entityId: req.params.id, before: before.rows[0], after: updated.rows[0] });
  res.json(updated.rows[0]);
}));

adminRouter.post("/leads/:id/notes", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const content = String(req.body.content || "").trim();
  if (!content) throw new AppError("Note content is required.", 400, "VALIDATION_ERROR");
  const lead = await query("SELECT id FROM leads WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!lead.rows[0]) throw notFound("Lead");
  const communication = await query(
    `INSERT INTO communications (lead_id, type, direction, subject, message_summary, user_id)
     VALUES ($1, 'NOTE', 'INTERNAL', 'Lead note', $2, $3) RETURNING *`,
    [req.params.id, content, req.user.id]
  );
  await recordActivity({ actorUserId: req.user.id, entityType: "lead", entityId: req.params.id, action: "note_added", summary: "Note added" });
  res.status(201).json(communication.rows[0]);
}));

adminRouter.get("/leads/:id/convert-preview", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const lead = await query(
    `SELECT l.*, p.name AS package_name, x.name AS experience_name
     FROM leads l
     LEFT JOIN packages p ON p.id=l.preferred_package_id
     LEFT JOIN experiences x ON x.id=l.preferred_experience_id
     WHERE l.id=$1 AND l.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!lead.rows[0]) throw notFound("Lead");
  const existingClient = await query("SELECT id, name, email, phone FROM clients WHERE lower(email)=lower($1) AND deleted_at IS NULL LIMIT 1", [lead.rows[0].email]);
  res.json({
    lead: lead.rows[0],
    clientAction: existingClient.rows[0] ? "REUSE_EXISTING" : "CREATE_NEW",
    existingClient: existingClient.rows[0] || null,
    eventPreview: {
      event_name: `${lead.rows[0].event_type} for ${lead.rows[0].first_name} ${lead.rows[0].last_name}`,
      event_date: lead.rows[0].event_date,
      venue_name: lead.rows[0].venue_name,
      package_name: lead.rows[0].package_name,
      experience_name: lead.rows[0].experience_name
    }
  });
}));

adminRouter.post("/leads/:id/convert", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const converted = await transaction(async (client) => {
    const leadResult = await client.query("SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
    const lead = leadResult.rows[0];
    if (!lead) throw notFound("Lead");

    let clientResult = await client.query("SELECT * FROM clients WHERE email=$1 AND deleted_at IS NULL", [lead.email]);
    let customer = clientResult.rows[0];
    if (!customer) {
      clientResult = await client.query(
        `INSERT INTO clients (name,email,phone,billing_address,client_type,referral_source)
         VALUES ($1,$2,$3,$4,'INDIVIDUAL',$5) RETURNING *`,
        [`${lead.first_name} ${lead.last_name}`, lead.email, lead.phone, [lead.venue_address, lead.city, lead.state, lead.zip].filter(Boolean).join(", "), lead.referral_source]
      );
      customer = clientResult.rows[0];
    }

    const eventResult = await client.query(
      `INSERT INTO events (event_name, client_id, event_type, event_date, start_time, end_time, venue_name, venue_address, guest_count, package_id, experience_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING_CONTRACT') RETURNING *`,
      [`${lead.event_type} for ${customer.name}`, customer.id, lead.event_type, lead.event_date, lead.event_start_time, lead.event_end_time, lead.venue_name, lead.venue_address, lead.guest_count, lead.preferred_package_id, lead.preferred_experience_id]
    );

    const pricing = await calculateBookingPricing({ packageId: lead.preferred_package_id, addonIds: req.body.addonIds || [] });
    const bookingResult = await client.query(
      `INSERT INTO bookings (event_id, client_id, lead_id, subtotal, add_ons_total, travel_fee, custom_charges, discount, total, deposit_required, amount_paid, balance_due, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,'UNPAID') RETURNING *`,
      [eventResult.rows[0].id, customer.id, lead.id, pricing.packageSubtotal, pricing.addonSubtotal, pricing.travelFee, pricing.customCharges, pricing.discount, pricing.total, pricing.depositRequired, pricing.balanceDue]
    );
    if (Array.isArray(req.body.addonIds) && req.body.addonIds.length) {
      const addonRows = await client.query("SELECT id, price FROM addons WHERE id = ANY($1::uuid[]) AND active = true", [req.body.addonIds]);
      for (const addon of addonRows.rows) {
        await client.query(
          "INSERT INTO event_addons (event_id, addon_id, quantity, unit_price) VALUES ($1,$2,1,$3) ON CONFLICT DO NOTHING",
          [eventResult.rows[0].id, addon.id, addon.price]
        );
      }
    }
    await client.query("UPDATE leads SET status='WON', converted_client_id=$1, converted_event_id=$2, updated_at=now() WHERE id=$3", [customer.id, eventResult.rows[0].id, lead.id]);
    return { client: customer, event: eventResult.rows[0], booking: bookingResult.rows[0] };
  });

  await recordActivity({ actorUserId: req.user.id, entityType: "lead", entityId: req.params.id, action: "lead_converted", summary: "Lead converted to booking" });
  await logAutomationEvent({ triggerKey: "booking_confirmed", entityType: "booking", entityId: converted.booking.id });
  await writeAudit({ req, action: "lead_converted", entity: "lead", entityId: req.params.id, after: converted });
  res.status(201).json(converted);
}));

const clientSchema = z.object({
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  name: z.string().optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  preferred_contact_method: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  client_type: z.enum(["INDIVIDUAL", "CORPORATE", "PLANNER", "VENUE", "OTHER"]).default("INDIVIDUAL"),
  referral_source: z.string().optional().nullable()
}).passthrough();

adminRouter.get("/clients", ...listRoute("clients", ["name", "email", "phone", "company"], "read:sales"));

adminRouter.post("/clients", requirePermission("write:sales"), validate(clientSchema), asyncHandler(async (req, res) => {
  const name = req.body.name || [req.body.first_name, req.body.last_name].filter(Boolean).join(" ") || req.body.company;
  if (!name) throw new AppError("Client name is required.", 400, "VALIDATION_ERROR");
  if (!req.query.continueAnyway && (req.body.email || req.body.phone)) {
    const duplicate = await query(
      `SELECT id, name, email, phone FROM clients
       WHERE deleted_at IS NULL AND (($1::text IS NOT NULL AND lower(email)=lower($1)) OR ($2::text IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g')))
       LIMIT 1`,
      [req.body.email || null, req.body.phone || null]
    );
    if (duplicate.rows[0]) throw new AppError("Possible duplicate client found.", 409, "POSSIBLE_DUPLICATE", { duplicate: duplicate.rows[0] });
  }
  const body = { ...req.body, name, billing_address: [req.body.address, req.body.city, req.body.state, req.body.zip].filter(Boolean).join(", ") || null };
  const allowed = ["name", "first_name", "last_name", "email", "phone", "company", "preferred_contact_method", "address", "city", "state", "zip", "notes", "tags", "client_type", "referral_source", "billing_address"];
  const fields = Object.keys(cleanPatch(body, allowed));
  const values = fields.map((field) => body[field]);
  const inserted = await query(`INSERT INTO clients (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
  await writeAudit({ req, action: "client_created", entity: "client", entityId: inserted.rows[0].id, after: inserted.rows[0] });
  res.status(201).json(inserted.rows[0]);
}));

adminRouter.get("/clients/:id", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const client = await query("SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!client.rows[0]) throw notFound("Client");
  const [events, proposals, invoices, payments, tasks, files, communications, activity, summary] = await Promise.all([
    query("SELECT * FROM events WHERE client_id=$1 AND deleted_at IS NULL ORDER BY event_date DESC", [req.params.id]),
    query("SELECT * FROM proposals WHERE client_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [req.params.id]),
    query("SELECT * FROM invoices WHERE client_id=$1 AND deleted_at IS NULL ORDER BY due_date DESC", [req.params.id]),
    query("SELECT * FROM payments WHERE client_id=$1 AND deleted_at IS NULL ORDER BY payment_date DESC", [req.params.id]),
    query("SELECT * FROM tasks WHERE client_id=$1 AND deleted_at IS NULL ORDER BY due_date NULLS LAST", [req.params.id]),
    query("SELECT * FROM files WHERE client_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [req.params.id]),
    query("SELECT * FROM communications WHERE client_id=$1 AND deleted_at IS NULL ORDER BY occurred_at DESC", [req.params.id]),
    query("SELECT * FROM activities WHERE entity_type='client' AND entity_id=$1 ORDER BY created_at DESC", [req.params.id]),
    query(`SELECT count(e.id)::int AS total_events, COALESCE(sum(b.total),0)::text AS lifetime_value, COALESCE(sum(b.balance_due),0)::text AS outstanding_balance
      FROM clients c LEFT JOIN events e ON e.client_id=c.id AND e.deleted_at IS NULL LEFT JOIN bookings b ON b.event_id=e.id AND b.deleted_at IS NULL WHERE c.id=$1`, [req.params.id])
  ]);
  res.json({ ...client.rows[0], summary: summary.rows[0], events: events.rows, proposals: proposals.rows, invoices: invoices.rows, payments: payments.rows, tasks: tasks.rows, files: files.rows, communications: communications.rows, activity: activity.rows });
}));

adminRouter.patch("/clients/:id", requirePermission("write:sales"), validate(clientSchema.partial()), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Client");
  const body = { ...req.body };
  if (!body.name && (body.first_name || body.last_name)) body.name = [body.first_name ?? before.rows[0].first_name, body.last_name ?? before.rows[0].last_name].filter(Boolean).join(" ");
  if (body.address || body.city || body.state || body.zip) body.billing_address = [body.address, body.city, body.state, body.zip].filter(Boolean).join(", ");
  const updated = await updateById({ table: "clients", id: req.params.id, body, allowed: ["name", "first_name", "last_name", "email", "phone", "company", "preferred_contact_method", "address", "city", "state", "zip", "notes", "tags", "client_type", "referral_source", "billing_address"] });
  await writeAudit({ req, action: "client_edited", entity: "client", entityId: req.params.id, before: before.rows[0], after: updated });
  res.json(updated);
}));

const eventSchema = z.object({
  client_id: uuid,
  event_name: z.string().min(1),
  event_type: z.string().min(1),
  event_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  setup_time: z.string().optional().nullable(),
  breakdown_time: z.string().optional().nullable(),
  venue_name: z.string().optional().nullable(),
  venue_address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  guest_count: z.coerce.number().int().optional().nullable(),
  package_id: uuid.optional().nullable(),
  experience_id: uuid.optional().nullable(),
  status: z.enum(eventStatuses).default("TENTATIVE"),
  internal_notes: z.string().optional().nullable(),
  client_notes: z.string().optional().nullable(),
  backdrop: z.string().optional().nullable(),
  print_template: z.string().optional().nullable(),
  parking_loading_instructions: z.string().optional().nullable(),
  access_instructions: z.string().optional().nullable(),
  load_in_instructions: z.string().optional().nullable(),
  special_restrictions: z.string().optional().nullable(),
  setup_instructions: z.string().optional().nullable(),
  room_name: z.string().optional().nullable(),
  venue_contact_name: z.string().optional().nullable(),
  venue_contact_phone: z.string().optional().nullable(),
  power_requirements: z.string().optional().nullable(),
  wifi_notes: z.string().optional().nullable(),
  operational_status: z.enum(["PREPARING", "READY", "EN_ROUTE", "ON_SITE", "SETTING_UP", "LIVE", "BREAKDOWN", "COMPLETED", "ISSUE_REPORTED"]).optional(),
  gallery_status: z.enum(["NOT_STARTED", "PROCESSING", "READY", "DELIVERED", "ARCHIVED"]).optional(),
  gallery_url: z.string().optional().nullable()
}).passthrough();

function validateEventTimes(body) {
  if (body.start_time && body.end_time && body.end_time <= body.start_time) throw new AppError("End time must be after start time.", 400, "VALIDATION_ERROR");
  if (body.setup_time && body.start_time && body.setup_time > body.start_time) throw new AppError("Setup time must be before the event start.", 400, "VALIDATION_ERROR");
  if (body.breakdown_time && body.end_time && body.breakdown_time < body.end_time) throw new AppError("Breakdown time must be after the event end.", 400, "VALIDATION_ERROR");
}

adminRouter.get("/events", ...listRoute("events", ["event_name", "event_type", "venue_name"], "read:events"));

adminRouter.get("/events/checklist-templates", requirePermission("read:operations"), asyncHandler(async (_req, res) => {
  res.json(await listChecklistTemplates());
}));

adminRouter.post("/events/checklist-templates", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.status(201).json(await createChecklistTemplate(req.body));
}));

adminRouter.get("/my-events", requirePermission("read:attendant"), asyncHandler(async (req, res) => {
  res.json(await attendantHome(req.user));
}));

adminRouter.get("/my-events/:id", requirePermission("read:attendant"), asyncHandler(async (req, res) => {
  res.json(await getEventOperations(req.params.id, req.user));
}));

adminRouter.post("/events", requirePermission("write:events"), validate(eventSchema), asyncHandler(async (req, res) => {
  validateEventTimes(req.body);
  const eventNumber = `EVT-${Date.now().toString().slice(-6)}`;
  const fields = Object.keys({ ...req.body, event_number: eventNumber });
  const body = { ...req.body, event_number: eventNumber };
  const values = fields.map((field) => body[field]);
  const inserted = await query(`INSERT INTO events (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: inserted.rows[0].id, action: "event_created", summary: "Event created" });
  await writeAudit({ req, action: "event_created", entity: "event", entityId: inserted.rows[0].id, after: inserted.rows[0] });
  res.status(201).json(inserted.rows[0]);
}));

adminRouter.get("/events/:id", requirePermission("read:events"), asyncHandler(async (req, res) => {
  const event = await query(
    `SELECT e.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.company AS client_company,
      p.name AS package_name, x.name AS experience_name, b.total AS booked_total, b.deposit_required,
      b.amount_paid, b.balance_due, b.payment_status
     FROM events e
     LEFT JOIN clients c ON c.id=e.client_id
     LEFT JOIN packages p ON p.id=e.package_id
     LEFT JOIN experiences x ON x.id=e.experience_id
     LEFT JOIN bookings b ON b.event_id=e.id AND b.deleted_at IS NULL
     WHERE e.id=$1 AND e.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!event.rows[0]) throw notFound("Event");
  const [staff, equipment, tasks, files, payments, communications, activity, audit, addons, proposals, invoices, operations] = await Promise.all([
    query(`SELECT sa.*, sp.name, sp.email, sp.phone FROM staff_assignments sa JOIN staff_profiles sp ON sp.id=sa.staff_profile_id WHERE sa.event_id=$1 AND sa.released_at IS NULL ORDER BY sa.created_at`, [req.params.id]),
    query(`SELECT ea.*, eq.name, eq.category, eq.status FROM equipment_assignments ea JOIN equipment eq ON eq.id=ea.equipment_id WHERE ea.event_id=$1 AND ea.released_at IS NULL ORDER BY ea.created_at`, [req.params.id]),
    query("SELECT * FROM tasks WHERE event_id=$1 AND deleted_at IS NULL ORDER BY due_date NULLS LAST", [req.params.id]),
    query("SELECT * FROM files WHERE event_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [req.params.id]),
    query("SELECT * FROM payments WHERE event_id=$1 AND deleted_at IS NULL ORDER BY payment_date DESC", [req.params.id]),
    query("SELECT * FROM communications WHERE event_id=$1 AND deleted_at IS NULL ORDER BY occurred_at DESC", [req.params.id]),
    query("SELECT * FROM activities WHERE entity_type='event' AND entity_id=$1 ORDER BY created_at DESC", [req.params.id]),
    query("SELECT * FROM audit_logs WHERE entity_type='event' AND entity_id=$1 ORDER BY created_at DESC", [req.params.id]),
    query("SELECT ea.*, a.name, a.pricing_type FROM event_addons ea JOIN addons a ON a.id=ea.addon_id WHERE ea.event_id=$1", [req.params.id]),
    query("SELECT * FROM proposals WHERE event_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [req.params.id]),
    query("SELECT * FROM invoices WHERE event_id=$1 AND deleted_at IS NULL ORDER BY due_date DESC", [req.params.id]),
    getEventOperations(req.params.id, req.user)
  ]);
  res.json({ ...event.rows[0], staff: staff.rows, equipment: equipment.rows, tasks: tasks.rows, files: files.rows, payments: payments.rows, communications: communications.rows, activity: activity.rows, audit: audit.rows, addons: addons.rows, proposals: proposals.rows, invoices: invoices.rows, operations });
}));

adminRouter.patch("/events/:id", requirePermission("write:events"), validate(eventSchema.partial()), asyncHandler(async (req, res) => {
  validateEventTimes(req.body);
  const before = await query("SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Event");
  const updated = await updateById({ table: "events", id: req.params.id, body: req.body, allowed: ["client_id", "event_name", "event_type", "event_date", "start_time", "end_time", "setup_time", "breakdown_time", "venue_name", "venue_address", "city", "state", "zip", "guest_count", "package_id", "experience_id", "status", "internal_notes", "client_notes", "backdrop", "print_template", "parking_loading_instructions", "access_instructions", "load_in_instructions", "special_restrictions", "setup_instructions", "room_name", "venue_contact_name", "venue_contact_phone", "power_requirements", "wifi_notes", "operational_status", "gallery_status", "gallery_url"] });
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: req.body.status ? "event_status_changed" : "event_edited", summary: req.body.status ? `Event status changed to ${req.body.status}` : "Event edited" });
  await writeAudit({ req, action: req.body.status ? "event_status_changed" : "event_edited", entity: "event", entityId: req.params.id, before: before.rows[0], after: updated });
  res.json(updated);
}));

adminRouter.get("/events/:id/operations", requirePermission("read:operations"), asyncHandler(async (req, res) => {
  res.json(await getEventOperations(req.params.id, req.user));
}));

adminRouter.post("/events/:id/operations/status", requireAnyPermission("write:operations", "read:attendant"), asyncHandler(async (req, res) => {
  res.json(await transitionOperationalStatus(req.params.id, req.body.status, req.user, req.body));
}));

adminRouter.post("/events/:id/operations/complete", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.json(await completeEvent(req.params.id, req.body, req.user));
}));

adminRouter.post("/events/:id/operations/reschedule", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.json(await rescheduleEvent(req.params.id, req.body, req.user));
}));

adminRouter.post("/events/:id/operations/cancel", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.json(await cancelEventOperations(req.params.id, req.user));
}));

adminRouter.post("/events/:id/checklists/instantiate", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.status(201).json(await instantiateChecklist(req.params.id, req.body.template_id || null, req.user));
}));

adminRouter.patch("/events/:id/checklist-items/:itemId", requireAnyPermission("write:operations", "read:attendant"), asyncHandler(async (req, res) => {
  res.json(await updateChecklistItem(req.params.id, req.params.itemId, req.body, req.user));
}));

adminRouter.post("/events/:id/contacts", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.status(201).json(await upsertEventContact(req.params.id, req.body, req.user));
}));

adminRouter.post("/events/:id/notes", requireAnyPermission("write:operations", "read:attendant"), asyncHandler(async (req, res) => {
  res.status(201).json(await addEventNote(req.params.id, req.body, req.user));
}));

adminRouter.patch("/events/:id/creative", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.json(await upsertCreative(req.params.id, req.body, req.user));
}));

adminRouter.post("/events/:id/incidents", requireAnyPermission("write:operations", "read:attendant"), asyncHandler(async (req, res) => {
  res.status(201).json(await createIncident(req.params.id, req.body, req.user));
}));

adminRouter.patch("/events/:id/incidents/:incidentId", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.json(await updateIncident(req.params.id, req.params.incidentId, req.body, req.user));
}));

adminRouter.patch("/events/:id/gallery", requirePermission("write:operations"), asyncHandler(async (req, res) => {
  res.json(await updateGallery(req.params.id, req.body, req.user));
}));

adminRouter.post("/events/:id/staff-briefs/send", requirePermission("staff.brief.send"), asyncHandler(async (req, res) => {
  res.status(202).json(await sendStaffBrief(req.params.id, req.body, req.user));
}));

adminRouter.post("/events/:id/gallery-delivery/send", requirePermission("gallery.delivery.send"), asyncHandler(async (req, res) => {
  res.status(201).json(await createOrSendGalleryDelivery(req.params.id, req.body, req.user));
}));

adminRouter.post("/events/:id/gallery-delivery/revoke", requirePermission("gallery.delivery.send"), asyncHandler(async (req, res) => {
  const result = await revokeGalleryDelivery(req.params.id, req.user);
  await writeAudit({ req, action: "delivery_token_revoked", entity: "event", entityId: req.params.id, after: result });
  res.json(result);
}));

adminRouter.get("/events/:id/run-sheet.pdf", requireAnyPermission("read:operations", "read:attendant"), asyncHandler(async (req, res) => {
  const buffer = await generateRunSheetPdf(req.params.id, req.user);
  res.type("application/pdf").attachment(`event-run-sheet-${req.params.id.slice(0, 8)}.pdf`).send(buffer);
}));

adminRouter.post("/events/:id/cancel", requirePermission("write:events"), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Event");
  const updated = await query("UPDATE events SET status='CANCELLED', updated_at=now() WHERE id=$1 RETURNING *", [req.params.id]);
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: "event_cancelled", summary: "Event cancelled" });
  await writeAudit({ req, action: "event_cancelled", entity: "event", entityId: req.params.id, before: before.rows[0], after: updated.rows[0] });
  res.json(updated.rows[0]);
}));

adminRouter.get("/pickers/clients", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT id, name AS label, email AS subtitle FROM clients WHERE deleted_at IS NULL AND (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/pickers/leads", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT id, first_name || ' ' || last_name AS label, email AS subtitle FROM leads WHERE deleted_at IS NULL AND (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) ORDER BY created_at DESC LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/pickers/events", requirePermission("read:events"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT e.id, e.event_name AS label, c.name || COALESCE(' · ' || e.event_date::text, '') AS subtitle, e.client_id FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.deleted_at IS NULL AND (e.event_name ILIKE $1 OR e.event_type ILIKE $1 OR e.venue_name ILIKE $1 OR c.name ILIKE $1) ORDER BY e.event_date DESC NULLS LAST LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/pickers/packages", requirePermission("read:content"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT id, name AS label, starting_price AS subtitle FROM packages WHERE deleted_at IS NULL AND active=true AND (name ILIKE $1 OR description ILIKE $1) ORDER BY display_order, name LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/pickers/experiences", requirePermission("read:content"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT id, name AS label, category AS subtitle FROM experiences WHERE deleted_at IS NULL AND active=true AND (name ILIKE $1 OR description ILIKE $1) ORDER BY display_order, name LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/pickers/addons", requirePermission("read:content"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT id, name AS label, price AS subtitle, pricing_type FROM addons WHERE deleted_at IS NULL AND active=true AND (name ILIKE $1 OR description ILIKE $1) ORDER BY display_order, name LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/pickers/proposals", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT p.id, p.proposal_number || COALESCE(' - ' || c.name, '') AS label, p.status || ' · $' || p.total::text AS subtitle FROM proposals p LEFT JOIN clients c ON c.id=p.client_id WHERE p.deleted_at IS NULL AND (p.proposal_number ILIKE $1 OR c.name ILIKE $1) ORDER BY p.created_at DESC LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/pickers/invoices", requirePermission("read:finance"), asyncHandler(async (req, res) => {
  const rows = await pickerRows(req.query.q, "SELECT i.id, i.invoice_number || COALESCE(' - ' || c.name, '') AS label, i.status || ' · $' || COALESCE(i.amount_outstanding, i.balance_due)::text AS subtitle FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.deleted_at IS NULL AND (i.invoice_number ILIKE $1 OR c.name ILIKE $1) ORDER BY i.created_at DESC LIMIT 25");
  res.json({ data: rows });
}));

adminRouter.get("/proposals", requirePermission("read:sales"), validate(paginationSchema, "query"), asyncHandler(async (req, res) => {
  const filters = req.validatedQuery;
  const pageSize = filters.pageSize || filters.page_size;
  const offset = (filters.page - 1) * pageSize;
  const params = [];
  const where = ["p.deleted_at IS NULL"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`p.status=$${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(p.proposal_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR e.event_name ILIKE $${params.length} OR pkg.name ILIKE $${params.length})`);
  }
  const sortMap = { proposal_number: "p.proposal_number", client: "c.name", event_date: "e.event_date", package: "pkg.name", total: "p.total", status: "p.status", created_at: "p.created_at", sent_at: "p.sent_at", valid_through: "p.valid_through", owner: "u.name" };
  const sortBy = sortMap[filters.sort_by || filters.sort] || "p.created_at";
  const direction = String(filters.sort_direction || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  params.push(pageSize, offset);
  const rows = await query(
    `SELECT p.*, c.name AS client_name, e.event_name, e.event_date, pkg.name AS package_name, u.name AS owner_name
     FROM proposals p
     LEFT JOIN clients c ON c.id=p.client_id
     LEFT JOIN events e ON e.id=p.event_id
     LEFT JOIN packages pkg ON pkg.id=p.package_id
     LEFT JOIN users u ON u.id=p.owner_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${sortBy} ${direction} NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const count = await query(
    `SELECT count(*)::int AS count FROM proposals p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN events e ON e.id=p.event_id LEFT JOIN packages pkg ON pkg.id=p.package_id WHERE ${where.join(" AND ")}`,
    params.slice(0, -2)
  );
  res.json({ data: rows.rows, pagination: { page: filters.page, pageSize, total: count.rows[0].count } });
}));

adminRouter.post("/proposals", requirePermission("write:sales"), validate(proposalSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await createProposal(req));
}));

adminRouter.get("/proposals/:id", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.id);
  const versions = await query("SELECT id, version_number, created_at, created_by FROM proposal_versions WHERE proposal_id=$1 ORDER BY version_number DESC", [req.params.id]);
  res.json({ ...proposal, versions: versions.rows });
}));

adminRouter.patch("/proposals/:id", requirePermission("write:sales"), validate(proposalSchema.partial()), asyncHandler(async (req, res) => {
  const before = await getProposal(req.params.id);
  const merged = { ...before, ...req.body };
  const snapshot = await buildProposalSnapshot(merged);
  const updated = await transaction(async (client) => {
    const result = await client.query(
      `UPDATE proposals SET lead_id=$1, client_id=$2, event_id=$3, package_id=$4, experience_id=$5, status=$6, notes=$7, total=$8, valid_through=$9, content=$10, pricing_snapshot=$11, line_items_snapshot=$12, updated_at=now()
       WHERE id=$13 AND deleted_at IS NULL RETURNING *`,
      [merged.lead_id || null, merged.client_id || snapshot.client.id || null, merged.event_id || null, merged.package_id || null, merged.experience_id || null, merged.status || before.status, merged.notes || null, snapshot.pricing.total, snapshot.validThrough, JSON.stringify(snapshot.content), JSON.stringify(snapshot.pricing), JSON.stringify(snapshot.lineItems), req.params.id]
    );
    if (!result.rows[0]) throw notFound("Proposal");
    await createProposalVersion(client, result.rows[0], req.user.id);
    return result.rows[0];
  });
  await writeAudit({ req, action: "proposal_updated", entity: "proposal", entityId: req.params.id, before, after: updated });
  res.json(updated);
}));

adminRouter.post("/proposals/:id/duplicate", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const original = await getProposal(req.params.id);
  const duplicated = await transaction(async (client) => {
    const proposalNumber = await nextNumber(client, "next_proposal_number", "proposal_prefix", "PROP");
    const inserted = await client.query(
      `INSERT INTO proposals (proposal_number, lead_id, client_id, event_id, owner_user_id, package_id, experience_id, secure_token, status, notes, total, valid_through, content, pricing_snapshot, line_items_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,encode(gen_random_bytes(24),'hex'),'DRAFT',$8,$9,$10,$11,$12,$13) RETURNING *`,
      [proposalNumber, original.lead_id, original.client_id, original.event_id, req.user.id, original.package_id, original.experience_id, original.notes, original.total, original.valid_through, JSON.stringify(original.content), JSON.stringify(original.pricing_snapshot), JSON.stringify(original.line_items_snapshot)]
    );
    await createProposalVersion(client, inserted.rows[0], req.user.id);
    return inserted.rows[0];
  });
  await writeAudit({ req, action: "proposal_duplicated", entity: "proposal", entityId: duplicated.id, before: original, after: duplicated });
  res.status(201).json(duplicated);
}));

adminRouter.post("/proposals/:id/archive", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const before = await getProposal(req.params.id);
  const updated = await query("UPDATE proposals SET status='ARCHIVED', archived_at=now(), updated_at=now() WHERE id=$1 RETURNING *", [req.params.id]);
  await writeAudit({ req, action: "proposal_archived", entity: "proposal", entityId: req.params.id, before, after: updated.rows[0] });
  res.json(updated.rows[0]);
}));

adminRouter.get("/proposals/:id/preview", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  res.type("html").send(proposalPreviewHtml(await getProposal(req.params.id)));
}));

adminRouter.get("/proposals/:id/pdf", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.id);
  const document = await generateAndStoreProposal(proposal, "pdf");
  await recordGeneratedFile({ req, document, entityType: "proposal", entity: proposal });
  const buffer = await generateProposalPdf(proposal);
  res.type("application/pdf").attachment(document.filename).send(buffer);
}));

adminRouter.get("/proposals/:id/docx", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.id);
  const document = await generateAndStoreProposal(proposal, "docx");
  await recordGeneratedFile({ req, document, entityType: "proposal", entity: proposal });
  const buffer = await generateProposalDocx(proposal);
  res.type(document.mimeType).attachment(document.filename).send(buffer);
}));

adminRouter.post("/proposals/:id/send", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.params.id);
  const result = await sendProposal(req, proposal);
  await recordGeneratedFile({ req, document: result.document, entityType: "proposal", entity: proposal });
  await writeAudit({ req, action: "proposal_sent", entity: "proposal", entityId: proposal.id, before: proposal });
  res.json(result);
}));

adminRouter.post("/proposals/:id/create-invoice", requirePermission("write:finance"), asyncHandler(async (req, res) => {
  req.body = { ...req.body, proposal_id: req.params.id };
  res.status(201).json(await createInvoice(req));
}));

adminRouter.get("/invoices", requirePermission("read:finance"), validate(paginationSchema, "query"), asyncHandler(async (req, res) => {
  const filters = req.validatedQuery;
  const pageSize = filters.pageSize || filters.page_size;
  const offset = (filters.page - 1) * pageSize;
  const params = [];
  const where = ["i.deleted_at IS NULL"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`i.status=$${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(i.invoice_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR e.event_name ILIKE $${params.length})`);
  }
  const sortMap = { invoice_number: "i.invoice_number", client: "c.name", event_date: "e.event_date", total: "i.total", status: "i.status", created_at: "i.created_at", due_date: "i.due_date" };
  const sortBy = sortMap[filters.sort_by || filters.sort] || "i.created_at";
  const direction = String(filters.sort_direction || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  params.push(pageSize, offset);
  const rows = await query(
    `SELECT i.*, c.name AS client_name, e.event_name, e.event_date, p.proposal_number
     FROM invoices i
     LEFT JOIN clients c ON c.id=i.client_id
     LEFT JOIN events e ON e.id=i.event_id
     LEFT JOIN proposals p ON p.id=i.proposal_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${sortBy} ${direction} NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const count = await query(`SELECT count(*)::int AS count FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN events e ON e.id=i.event_id WHERE ${where.join(" AND ")}`, params.slice(0, -2));
  res.json({ data: rows.rows, pagination: { page: filters.page, pageSize, total: count.rows[0].count } });
}));

adminRouter.post("/invoices", requirePermission("write:finance"), validate(invoiceSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await createInvoice(req));
}));

adminRouter.get("/invoices/:id", requirePermission("read:finance"), asyncHandler(async (req, res) => {
  res.json(await getInvoice(req.params.id));
}));

adminRouter.get("/invoices/:id/pdf", requirePermission("read:finance"), asyncHandler(async (req, res) => {
  const invoice = await getInvoice(req.params.id);
  const document = await generateAndStoreInvoice(invoice);
  await recordGeneratedFile({ req, document, entityType: "invoice", entity: invoice });
  const buffer = await generateInvoicePdf(invoice);
  res.type("application/pdf").attachment(document.filename).send(buffer);
}));

adminRouter.post("/invoices/:id/send", requirePermission("write:finance"), asyncHandler(async (req, res) => {
  const invoice = await getInvoice(req.params.id);
  const result = await sendInvoice(req, invoice);
  await recordGeneratedFile({ req, document: result.document, entityType: "invoice", entity: invoice });
  await writeAudit({ req, action: "invoice_sent", entity: "invoice", entityId: invoice.id, before: invoice });
  res.json(result);
}));

adminRouter.post("/invoices/:id/void", requirePermission("write:finance"), asyncHandler(async (req, res) => {
  const before = await getInvoice(req.params.id);
  const updated = await query("UPDATE invoices SET status='VOID', updated_at=now() WHERE id=$1 RETURNING *", [req.params.id]);
  await writeAudit({ req, action: "invoice_voided", entity: "invoice", entityId: req.params.id, before, after: updated.rows[0] });
  res.json(updated.rows[0]);
}));

adminRouter.post("/invoices/:id/duplicate", requirePermission("write:finance"), asyncHandler(async (req, res) => {
  const original = await getInvoice(req.params.id);
  req.body = { client_id: original.client_id, event_id: original.event_id, notes: original.notes, terms: original.terms, items: original.items.map((item) => ({ description: item.description || item.label, quantity: item.quantity, unit_price: item.unit_price, taxable: item.taxable, tax_rate: item.tax_rate, discount: item.discount })) };
  const invoice = await createInvoice(req);
  await writeAudit({ req, action: "invoice_duplicated", entity: "invoice", entityId: invoice.id, before: original, after: invoice });
  res.status(201).json(invoice);
}));

adminRouter.get("/payment-providers/status", requirePermission("read:finance"), asyncHandler(async (_req, res) => {
  res.json(providerStatus());
}));

adminRouter.get("/payment-reminders/preview", requirePermission("read:finance"), asyncHandler(async (_req, res) => {
  res.json(await previewPaymentReminders());
}));

adminRouter.get("/payments", requirePermission("read:finance"), validate(paginationSchema, "query"), asyncHandler(async (req, res) => {
  const filters = req.validatedQuery;
  const pageSize = filters.pageSize || filters.page_size;
  const offset = (filters.page - 1) * pageSize;
  const params = [];
  const where = ["p.deleted_at IS NULL"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`p.status=$${params.length}`);
  }
  if (filters.provider) {
    params.push(String(filters.provider).toUpperCase());
    where.push(`p.provider=$${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(i.invoice_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR p.provider_payment_id ILIKE $${params.length} OR p.reference_number ILIKE $${params.length})`);
  }
  params.push(pageSize, offset);
  const rows = await query(
    `SELECT p.*, c.name AS client_name, e.event_name, i.invoice_number
     FROM payments p
     LEFT JOIN clients c ON c.id=p.client_id
     LEFT JOIN events e ON e.id=p.event_id
     LEFT JOIN invoices i ON i.id=p.invoice_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const count = await query(`SELECT count(*)::int AS count FROM payments p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN invoices i ON i.id=p.invoice_id WHERE ${where.join(" AND ")}`, params.slice(0, -2));
  res.json({ data: rows.rows, pagination: { page: filters.page, pageSize, total: count.rows[0].count } });
}));

adminRouter.get("/payments/:id", requirePermission("read:finance"), asyncHandler(async (req, res) => {
  res.json(await getPayment(req.params.id));
}));

adminRouter.get("/payments/:id/receipt.pdf", requirePermission("read:finance"), asyncHandler(async (req, res) => {
  const payment = await getPayment(req.params.id);
  const invoice = payment.invoice_id ? await getInvoice(payment.invoice_id) : {};
  const buffer = await generatePaymentReceiptPdf({ ...payment, invoice_balance: invoice.amount_outstanding || invoice.balance_due || 0 });
  res.type("application/pdf").attachment(`receipt-${payment.id.slice(0, 8)}.pdf`).send(buffer);
}));

adminRouter.post("/payments/:id/refunds", requirePermission("issue:refunds"), asyncHandler(async (req, res) => {
  res.status(201).json(await createRefund(req));
}));

adminRouter.get("/payment-schedules", requirePermission("read:finance"), validate(paginationSchema, "query"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ps.*, c.name AS client_name, e.event_name, i.invoice_number
     FROM payment_schedules ps
     LEFT JOIN clients c ON c.id=ps.client_id
     LEFT JOIN events e ON e.id=ps.event_id
     LEFT JOIN invoices i ON i.id=ps.invoice_id
     WHERE ps.deleted_at IS NULL
     ORDER BY ps.created_at DESC LIMIT $1 OFFSET $2`,
    [req.validatedQuery.pageSize || req.validatedQuery.page_size, (req.validatedQuery.page - 1) * (req.validatedQuery.pageSize || req.validatedQuery.page_size)]
  );
  res.json({ data: result.rows });
}));

adminRouter.post("/payment-schedules", requirePermission("write:finance"), asyncHandler(async (req, res) => {
  const schedule = await transaction(async (client) => {
    const total = (req.body.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const inserted = await client.query(
      `INSERT INTO payment_schedules (proposal_id, invoice_id, event_id, client_id, schedule_type, total_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.body.proposal_id || null, req.body.invoice_id || null, req.body.event_id || null, req.body.client_id || null, req.body.schedule_type || "DEPOSIT_BALANCE", total, req.user.id]
    );
    for (const [index, item] of (req.body.items || []).entries()) {
      await client.query(
        "INSERT INTO payment_schedule_items (schedule_id, label, amount, due_date, display_order) VALUES ($1,$2,$3,$4,$5)",
        [inserted.rows[0].id, item.label, item.amount, item.due_date || null, index]
      );
    }
    return inserted.rows[0];
  });
  await writeAudit({ req, action: "payment_schedule_created", entity: "payment_schedule", entityId: schedule.id, after: schedule });
  res.status(201).json(schedule);
}));

const cmsTypes = ["hero", "gallery", "content", "testimonials", "faqs", "eventTypes"];
const cmsTypeSchema = z.object({ type: z.enum(cmsTypes) });
const cmsTypeAndIdSchema = z.object({ type: z.enum(cmsTypes), id: uuid });
const cmsRecordSchema = z.object({ id: uuid });
const mediaUploadSchema = z.object({
  filename: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(3).max(120),
  data: z.string().min(8),
  altText: z.string().trim().max(500).optional().nullable(),
  caption: z.string().trim().max(1000).optional().nullable(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  visibility: z.enum(["PRIVATE", "PUBLIC", "ARCHIVED"]).default("PRIVATE"),
  permissionState: z.enum(["UNKNOWN", "APPROVED", "RESTRICTED", "DO_NOT_PUBLISH"]).default("UNKNOWN"),
  mediaType: z.enum(["IMAGE", "DOCUMENT", "VIDEO_REFERENCE", "BRAND_ASSET"]).default("IMAGE"),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional()
}).passthrough();

adminRouter.get("/website/defaults", requirePermission("read:website"), (_req, res) => {
  res.json({ ...websiteContentDefaults(), galleryCategories: getGalleryCategories() });
});

adminRouter.get("/website/preview", requirePermission("read:website"), asyncHandler(async (_req, res) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.json(await publicSitePayload({ preview: true }));
}));

adminRouter.get("/website/site-settings", requirePermission("read:website"), asyncHandler(async (_req, res) => {
  const settings = await query("SELECT business_name, business_email, contact_email, phone, website, service_area, instagram_url, tiktok_url, facebook_url, pinterest_url, copyright_text, brand_line, site_title, default_meta_description, default_og_image_media_id, canonical_domain, social_share_title, social_share_description, show_starting_price FROM business_settings LIMIT 1");
  res.json(settings.rows[0] || {});
}));

adminRouter.get("/website/media", requirePermission("read:website"), asyncHandler(async (req, res) => {
  res.json({ data: await listMedia(req.query) });
}));

adminRouter.post("/website/media", requirePermission("write:website"), validate(mediaUploadSchema), asyncHandler(async (req, res) => {
  const media = await uploadMedia(req);
  await writeAudit({ req, action: "website_media_uploaded", entity: "media_library", entityId: media.id, after: media });
  res.status(201).json(media);
}));

adminRouter.patch("/website/media/:id", requirePermission("write:website"), validate(cmsRecordSchema, "params"), asyncHandler(async (req, res) => {
  const { before, after } = await updateMedia(req, req.params.id);
  await writeAudit({ req, action: "website_media_updated", entity: "media_library", entityId: req.params.id, before, after });
  res.json(after);
}));

adminRouter.delete("/website/media/:id", requirePermission("write:website"), validate(cmsRecordSchema, "params"), asyncHandler(async (req, res) => {
  const { before, after } = await archiveMedia(req.params.id);
  await writeAudit({ req, action: "website_media_archived", entity: "media_library", entityId: req.params.id, before, after });
  res.json(after);
}));

adminRouter.get("/website/media/:id/file", requirePermission("read:website"), validate(cmsRecordSchema, "params"), asyncHandler(async (req, res) => {
  const media = await adminMedia(req.params.id);
  const buffer = await getStorageProvider().get(media.storage_key);
  res.type(media.mime_type).send(buffer);
}));

adminRouter.get("/website/:type", requirePermission("read:website"), validate(cmsTypeSchema, "params"), asyncHandler(async (req, res) => {
  res.json({ data: await listCmsRecords(req.params.type, req.query) });
}));

adminRouter.post("/website/:type", requirePermission("write:website"), validate(cmsTypeSchema, "params"), asyncHandler(async (req, res) => {
  const record = await createCmsRecord(req, req.params.type);
  await writeAudit({ req, action: `website_${req.params.type}_created`, entity: req.params.type, entityId: record.id, after: record });
  res.status(201).json(record);
}));

adminRouter.patch("/website/:type/:id", requirePermission("write:website"), validate(cmsTypeAndIdSchema, "params"), asyncHandler(async (req, res) => {
  const { before, after } = await updateCmsRecord(req, req.params.type, req.params.id);
  await writeAudit({ req, action: `website_${req.params.type}_updated`, entity: req.params.type, entityId: req.params.id, before, after });
  res.json(after);
}));

adminRouter.post("/website/:type/:id/publish", requirePermission("publish:website"), validate(cmsTypeAndIdSchema, "params"), asyncHandler(async (req, res) => {
  const { before, after } = await publishCmsRecord(req, req.params.type, req.params.id);
  await writeAudit({ req, action: `website_${req.params.type}_published`, entity: req.params.type, entityId: req.params.id, before, after });
  res.json(after);
}));

adminRouter.post("/website/:type/:id/unpublish", requirePermission("publish:website"), validate(cmsTypeAndIdSchema, "params"), asyncHandler(async (req, res) => {
  const { before, after } = await unpublishCmsRecord(req, req.params.type, req.params.id);
  await writeAudit({ req, action: `website_${req.params.type}_unpublished`, entity: req.params.type, entityId: req.params.id, before, after });
  res.json(after);
}));

adminRouter.post("/website/:type/:id/archive", requirePermission("write:website"), validate(cmsTypeAndIdSchema, "params"), asyncHandler(async (req, res) => {
  const { before, after } = await archiveCmsRecord(req, req.params.type, req.params.id);
  await writeAudit({ req, action: `website_${req.params.type}_archived`, entity: req.params.type, entityId: req.params.id, before, after });
  res.json(after);
}));

adminRouter.post("/website/:type/reorder", requirePermission("write:website"), validate(cmsTypeSchema, "params"), asyncHandler(async (req, res) => {
  await reorderCmsRecords(req, req.params.type, req.body.orderedIds);
  await writeAudit({ req, action: `website_${req.params.type}_reordered`, entity: req.params.type, after: { orderedIds: req.body.orderedIds } });
  res.json({ ok: true });
}));

adminRouter.patch("/website/site-settings", requirePermission("publish:website"), asyncHandler(async (req, res) => {
  const { before, after } = await updateSiteSettings(req);
  await writeAudit({ req, action: "website_site_settings_updated", entity: "business_settings", before, after });
  res.json(after);
}));

adminRouter.get("/staff", ...listRoute("staff_profiles", ["name", "email", "role"], "read:events"));
adminRouter.get("/packages", ...listRoute("packages", ["name", "description"], "read:content"));
adminRouter.get("/experiences", ...listRoute("experiences", ["name", "description"], "read:content"));
adminRouter.get("/addons", ...listRoute("addons", ["name", "description"], "read:content"));
adminRouter.post("/equipment/qr-labels.pdf", requirePermission("equipment.override"), asyncHandler(async (req, res) => {
  const buffer = await generateEquipmentLabelsPdf({ equipmentIds: req.body.equipment_ids || [] });
  res.type("application/pdf").attachment("lola-equipment-qr-labels.pdf").send(buffer);
}));

adminRouter.get("/equipment", ...listRoute("equipment", ["name", "category", "serial_number", "asset_uid", "status"], "read:events"));
adminRouter.get("/tasks", ...listRoute("tasks", ["title", "description"], "read:tasks"));
adminRouter.get("/files", ...listRoute("files", ["filename", "category", "storage_provider"], "read:tasks"));
adminRouter.get("/galleries", ...listRoute("galleries", ["gallery_name", "gallery_url", "status"], "read:tasks"));
adminRouter.get("/users", ...listRoute("users", ["name", "email"], "read:settings"));
adminRouter.get("/media-library", ...listRoute("media_library", ["filename", "alt_text", "storage_key"], "read:website"));
adminRouter.get("/website-content", ...listRoute("website_content", ["content_key", "title", "seo_title"], "read:website"));
adminRouter.get("/website-hero-slides", ...listRoute("website_hero_slides", ["headline", "caption", "cta_label"], "read:website"));
adminRouter.get("/website-gallery-items", ...listRoute("website_gallery_items", ["title", "caption"], "read:website"));
adminRouter.get("/testimonials", ...listRoute("testimonials", ["client_name", "event_type", "quote"], "read:website"));
adminRouter.get("/faqs", ...listRoute("faqs", ["question", "answer"], "read:website"));
adminRouter.get("/document-templates", ...listRoute("document_templates", ["name", "template_type"], "read:settings"));

const packageSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  short_description: z.string().optional().nullable(),
  starting_price: money,
  currency: z.string().default("USD"),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  most_popular: z.boolean().default(false),
  display_order: z.coerce.number().int().default(0),
  duration: z.coerce.number().optional().nullable(),
  included_hours: z.coerce.number().optional().nullable(),
  default_deposit: z.coerce.number().optional().nullable(),
  proposal_description: z.string().optional().nullable(),
  website_description: z.string().optional().nullable(),
  show_on_website: z.boolean().optional(),
  website_short_description: z.string().optional().nullable(),
  website_image_media_id: uuid.optional().nullable(),
  website_display_order: z.coerce.number().int().optional(),
  website_featured: z.boolean().optional()
}).passthrough();

async function enforceMostPopular(client, id, mostPopular) {
  if (mostPopular) {
    await client.query("UPDATE packages SET most_popular=false WHERE id <> $1 AND deleted_at IS NULL", [id]);
  }
}

adminRouter.post("/packages", requirePermission("write:content"), validate(packageSchema), asyncHandler(async (req, res) => {
  const inserted = await transaction(async (client) => {
    if (req.body.most_popular) await client.query("UPDATE packages SET most_popular=false WHERE deleted_at IS NULL");
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const result = await client.query(`INSERT INTO packages (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
    return result.rows[0];
  });
  await writeAudit({ req, action: "package_changed", entity: "package", entityId: inserted.id, after: inserted });
  res.status(201).json(inserted);
}));

adminRouter.patch("/packages/:id", requirePermission("write:content"), validate(packageSchema.partial()), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM packages WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Package");
  const updated = await transaction(async (client) => {
    const fields = Object.keys(cleanPatch(req.body, ["name", "description", "short_description", "starting_price", "currency", "active", "featured", "most_popular", "display_order", "duration", "included_hours", "default_deposit", "proposal_description", "website_description", "show_on_website", "website_short_description", "website_image_media_id", "website_display_order", "website_featured"]));
    if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
    if (req.body.most_popular) await enforceMostPopular(client, req.params.id, true);
    const values = fields.map((field) => req.body[field]);
    values.push(req.params.id);
    const result = await client.query(`UPDATE packages SET ${fields.map((field, i) => `${field}=$${i + 1}`).join(", ")}, updated_at=now() WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *`, values);
    return (await client.query("SELECT * FROM packages WHERE id=$1", [req.params.id])).rows[0];
  });
  await writeAudit({ req, action: "package_changed", entity: "package", entityId: req.params.id, before: before.rows[0], after: updated });
  res.json(updated);
}));

const experienceSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  proposal_description: z.string().optional().nullable(),
  features: z.array(z.string()).optional(),
  active: z.boolean().default(true),
  display_order: z.coerce.number().int().default(0),
  default_pricing: money.optional().nullable(),
  base_price: money.optional(),
  default_duration: z.coerce.number().int().optional(),
  setup_duration: z.coerce.number().int().optional().nullable(),
  breakdown_duration: z.coerce.number().int().optional().nullable(),
  equipment_required: z.array(z.string()).optional(),
  staff_required: z.coerce.number().int().optional(),
  show_on_website: z.boolean().optional(),
  website_name: z.string().optional().nullable(),
  website_short_description: z.string().optional().nullable(),
  website_long_description: z.string().optional().nullable(),
  website_featured: z.boolean().optional(),
  cover_image_media_id: uuid.optional().nullable()
}).passthrough();

adminRouter.post("/experiences", requirePermission("write:content"), validate(experienceSchema), asyncHandler(async (req, res) => {
  const body = { ...req.body, slug: req.body.slug || req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") };
  if (Array.isArray(body.features)) body.features = JSON.stringify(body.features);
  if (Array.isArray(body.equipment_required)) body.equipment_required = JSON.stringify(body.equipment_required);
  const fields = Object.keys(body);
  const values = Object.values(body);
  const inserted = await query(`INSERT INTO experiences (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
  await writeAudit({ req, action: "experience_changed", entity: "experience", entityId: inserted.rows[0].id, after: inserted.rows[0] });
  res.status(201).json(inserted.rows[0]);
}));

adminRouter.patch("/experiences/:id", requirePermission("write:content"), validate(experienceSchema.partial()), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM experiences WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Experience");
  const body = { ...req.body };
  if (Array.isArray(body.features)) body.features = JSON.stringify(body.features);
  if (Array.isArray(body.equipment_required)) body.equipment_required = JSON.stringify(body.equipment_required);
  const updated = await updateById({ table: "experiences", id: req.params.id, body, allowed: ["name", "slug", "description", "proposal_description", "features", "active", "display_order", "default_pricing", "base_price", "default_duration", "setup_duration", "breakdown_duration", "equipment_required", "staff_required", "show_on_website", "website_name", "website_short_description", "website_long_description", "website_featured", "cover_image_media_id"] });
  await writeAudit({ req, action: "experience_changed", entity: "experience", entityId: req.params.id, before: before.rows[0], after: updated });
  res.json(updated);
}));

const addonSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  price: money,
  pricing_type: z.enum(["FIXED", "PER_HOUR", "PER_UNIT", "PER_GUEST", "CUSTOM"]),
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
  display_order: z.coerce.number().int().default(0),
  proposal_description: z.string().optional().nullable()
}).passthrough();

adminRouter.post("/addons", requirePermission("write:content"), validate(addonSchema), asyncHandler(async (req, res) => {
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  const inserted = await query(`INSERT INTO addons (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
  await writeAudit({ req, action: "addon_changed", entity: "addon", entityId: inserted.rows[0].id, after: inserted.rows[0] });
  res.status(201).json(inserted.rows[0]);
}));

adminRouter.patch("/addons/:id", requirePermission("write:content"), validate(addonSchema.partial()), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM addons WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Add-on");
  const updated = await updateById({ table: "addons", id: req.params.id, body: req.body, allowed: ["name", "description", "price", "pricing_type", "taxable", "active", "display_order", "proposal_description"] });
  await writeAudit({ req, action: "addon_changed", entity: "addon", entityId: req.params.id, before: before.rows[0], after: updated });
  res.json(updated);
}));

adminRouter.get("/integration-connections", requirePermission("read:integrations"), asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, category, provider, status, connected_account, last_successful_sync_at, last_error, created_at, updated_at
     FROM integration_connections
     WHERE deleted_at IS NULL
     ORDER BY category, provider`
  );
  res.json({ data: rows.rows });
}));

adminRouter.get("/integrations/overview", requirePermission("read:integrations"), asyncHandler(async (_req, res) => {
  res.json(await integrationOverview());
}));

adminRouter.patch("/integrations/:provider", requirePermission("write:integrations"), asyncHandler(async (req, res) => {
  res.json(await updateIntegrationState({ provider: req.params.provider, patch: req.body }));
}));

adminRouter.post("/integrations/:provider/field-maps", requirePermission("write:integrations"), asyncHandler(async (req, res) => {
  res.status(201).json(await saveFieldMap({ provider: req.params.provider, providerEntity: req.body.providerEntity || req.body.form_id || "default", fieldMap: req.body.fieldMap || {} }));
}));

adminRouter.post("/integrations/:provider/test-lead", requirePermission("write:integrations"), asyncHandler(async (req, res) => {
  res.status(201).json(await ingestProviderLead({ provider: req.params.provider, payload: req.body.payload || sampleProviderLead(req.params.provider), testMode: true }));
}));

adminRouter.get("/integrations/failed-inbound", requirePermission("read:integrations"), asyncHandler(async (_req, res) => {
  res.json(await failedInboundLeads());
}));

adminRouter.post("/integrations/failed-inbound/:id/retry", requirePermission("write:integrations"), asyncHandler(async (req, res) => {
  res.json(await retryInboundLead(req.params.id));
}));

adminRouter.post("/integrations/failed-inbound/:id/resolve", requirePermission("write:integrations"), asyncHandler(async (req, res) => {
  res.json(await resolveInboundLead(req.params.id));
}));

adminRouter.get("/communications/templates", requirePermission("read:sales"), asyncHandler(async (_req, res) => {
  res.json(await listEmailTemplates());
}));

adminRouter.patch("/communications/templates/:id", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  res.json(await updateEmailTemplate(req.params.id, req.body));
}));

adminRouter.post("/communications/templates/:id/preview", requirePermission("read:sales"), asyncHandler(async (req, res) => {
  res.json(await previewEmailTemplate(req.params.id, req.body.data || undefined));
}));

adminRouter.get("/communications/automations", requirePermission("read:sales"), asyncHandler(async (_req, res) => {
  res.json(await listAutomations());
}));

adminRouter.patch("/communications/automations/:id", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  res.json(await updateAutomation(req.params.id, req.body));
}));

adminRouter.post("/communications/automations/:id/test", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const automation = (await query("SELECT * FROM automations WHERE id=$1 AND deleted_at IS NULL", [req.params.id])).rows[0];
  if (!automation) throw notFound("Automation");
  res.status(201).json({ jobs: await triggerAutomations({ triggerKey: automation.trigger_key, entityType: req.body.entityType || "lead", entityId: req.body.entityId || null, payload: req.body.payload || automation.conditions || {} }) });
}));

adminRouter.post("/communications/jobs/process", requirePermission("write:settings"), asyncHandler(async (_req, res) => {
  res.json(await processDueJobs());
}));

adminRouter.post("/communications/send", requirePermission("write:sales"), asyncHandler(async (req, res) => {
  const body = z.object({
    to: z.string().email(),
    cc: z.string().email().optional().nullable(),
    subject: z.string().min(1),
    body: z.string().min(1),
    lead_id: uuid.optional().nullable(),
    client_id: uuid.optional().nullable(),
    event_id: uuid.optional().nullable()
  }).parse(req.body);
  const delivery = await sendEmail({ to: body.to, subject: body.subject, body: body.body });
  const communication = await query(
    `INSERT INTO communications (lead_id, client_id, event_id, type, direction, subject, message_summary, user_id)
     VALUES ($1,$2,$3,'EMAIL','OUTBOUND',$4,$5,$6) RETURNING *`,
    [body.lead_id || null, body.client_id || null, body.event_id || null, body.subject, body.body.slice(0, 500), req.user.id]
  );
  await query(
    `INSERT INTO email_messages (communication_id, provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
    [communication.rows[0].id, delivery.provider, delivery.providerMessageId, body.to, body.subject, delivery.status, body.body.slice(0, 500)]
  );
  res.status(201).json({ communication: communication.rows[0], delivery });
}));

adminRouter.get("/calendar", requirePermission("read:events"), asyncHandler(async (req, res) => {
  res.json(await getOperationalCalendar({
    view: req.query.view || "month",
    date: req.query.date,
    filters: req.query,
    user: req.user
  }));
}));

adminRouter.get("/availability/check", requirePermission("read:events"), asyncHandler(async (req, res) => {
  res.json(await checkAvailability(req.query));
}));

adminRouter.post("/events/:id/equipment", requirePermission("write:events"), asyncHandler(async (req, res) => {
  const { equipmentId, overrideMaintenance = false } = req.body;
  const event = await query("SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!event.rows[0]) throw notFound("Event");
  const equipment = await query("SELECT * FROM equipment WHERE id=$1 AND deleted_at IS NULL", [equipmentId]);
  if (!equipment.rows[0]) throw notFound("Equipment");
  if (equipment.rows[0].status === "RETIRED") throw new AppError("Retired equipment cannot be assigned.", 409, "EQUIPMENT_RETIRED");
  if (equipment.rows[0].status === "MAINTENANCE" && (!overrideMaintenance || !requireAdminOverride(req))) {
    throw new AppError("This equipment is in maintenance and requires OWNER or ADMIN override.", 409, "EQUIPMENT_MAINTENANCE");
  }
  const availability = await checkAvailability({
    eventDate: event.rows[0].event_date,
    setupTime: event.rows[0].setup_time,
    startTime: event.rows[0].start_time,
    endTime: event.rows[0].end_time,
    breakdownTime: event.rows[0].breakdown_time,
    experienceId: event.rows[0].experience_id,
    eventId: req.params.id
  });
  const equipmentConflict = availability.conflicts.find((conflict) => conflict.type === "EQUIPMENT_CONFLICT" && conflict.records.some((record) => record.id === equipmentId));
  if (equipmentConflict) throw new AppError("This equipment is already reserved for an overlapping event.", 409, "EQUIPMENT_DOUBLE_BOOKED");
  const assigned = await query(
    "INSERT INTO equipment_assignments (event_id, equipment_id, assigned_by, lifecycle_status, checkout_notes) VALUES ($1,$2,$3,'RESERVED',$4) RETURNING *",
    [req.params.id, equipmentId, req.user.id, req.body.notes || null]
  );
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: "equipment_assigned", summary: `${equipment.rows[0].name} assigned` });
  await writeAudit({ req, action: "equipment_assigned", entity: "event", entityId: req.params.id, after: assigned.rows[0] });
  res.status(201).json(assigned.rows[0]);
}));

adminRouter.post("/events/:id/equipment/:assignmentId/:action", requireAnyPermission("write:operations", "read:attendant"), asyncHandler(async (req, res) => {
  res.json(await updateEquipmentLifecycle(req.params.id, req.params.assignmentId, req.params.action, req.body, req.user));
}));

adminRouter.delete("/events/:id/equipment/:assignmentId", requirePermission("write:events"), asyncHandler(async (req, res) => {
  const updated = await query("UPDATE equipment_assignments SET released_at=now() WHERE id=$1 AND event_id=$2 AND released_at IS NULL RETURNING *", [req.params.assignmentId, req.params.id]);
  if (!updated.rows[0]) throw notFound("Equipment assignment");
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: "equipment_removed", summary: "Equipment assignment removed" });
  await writeAudit({ req, action: "equipment_removed", entity: "event", entityId: req.params.id, after: updated.rows[0] });
  res.json(updated.rows[0]);
}));

adminRouter.post("/events/:id/staff", requirePermission("write:events"), asyncHandler(async (req, res) => {
  const { staffProfileId, assignmentRole = "ATTENDANT", notes = null, call_time = null, instructions = null, lead_attendant = false } = req.body;
  const event = await query("SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!event.rows[0]) throw notFound("Event");
  const staff = await query("SELECT * FROM staff_profiles WHERE id=$1 AND deleted_at IS NULL AND active=true", [staffProfileId]);
  if (!staff.rows[0]) throw notFound("Staff");
  const conflict = await query(
    `SELECT e.id, e.event_name, e.event_date, e.start_time, e.end_time, e.venue_name
     FROM staff_assignments sa
     JOIN events e ON e.id=sa.event_id
     WHERE sa.staff_profile_id=$1 AND sa.released_at IS NULL AND e.id <> $2
       AND event_unavailable_range(e.id) && event_unavailable_range($2)`,
    [staffProfileId, req.params.id]
  );
  if (conflict.rows[0]) throw new AppError("This staff member is already assigned to an overlapping event.", 409, "STAFF_DOUBLE_BOOKED", { conflict: conflict.rows[0] });
  const assigned = await query(
    "INSERT INTO staff_assignments (event_id, staff_profile_id, assignment_role, notes, call_time, instructions, lead_attendant) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [req.params.id, staffProfileId, assignmentRole, notes, call_time || event.rows[0].setup_time || null, instructions, Boolean(lead_attendant || assignmentRole === "LEAD_ATTENDANT")]
  );
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: "staff_assigned", summary: `${staff.rows[0].name} assigned` });
  await writeAudit({ req, action: "staff_assigned", entity: "event", entityId: req.params.id, after: assigned.rows[0] });
  res.status(201).json(assigned.rows[0]);
}));

adminRouter.patch("/events/:id/staff/:assignmentId", requirePermission("write:events"), asyncHandler(async (req, res) => {
  const body = cleanPatch(req.body, ["assignment_role", "notes", "call_time", "instructions", "lead_attendant"]);
  const fields = Object.keys(body);
  if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
  const values = fields.map((field) => body[field]);
  values.push(req.params.assignmentId, req.params.id);
  const updated = await query(
    `UPDATE staff_assignments SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}
     WHERE id=$${values.length - 1} AND event_id=$${values.length} AND released_at IS NULL RETURNING *`,
    values
  );
  if (!updated.rows[0]) throw notFound("Staff assignment");
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: "staff_assignment_changed", summary: "Staff assignment updated" });
  await writeAudit({ req, action: "staff_assignment_changed", entity: "event", entityId: req.params.id, after: updated.rows[0] });
  res.json(updated.rows[0]);
}));

adminRouter.post("/events/:id/staff/:assignmentId/acknowledge", requirePermission("read:attendant"), asyncHandler(async (req, res) => {
  res.json(await acknowledgeAssignment(req.params.id, req.params.assignmentId, req.user, { status: "ACKNOWLEDGED" }));
}));

adminRouter.post("/events/:id/staff/:assignmentId/decline", requirePermission("read:attendant"), asyncHandler(async (req, res) => {
  res.json(await acknowledgeAssignment(req.params.id, req.params.assignmentId, req.user, { status: "DECLINED", reason: req.body.reason }));
}));

adminRouter.delete("/events/:id/staff/:assignmentId", requirePermission("write:events"), asyncHandler(async (req, res) => {
  const updated = await query("UPDATE staff_assignments SET released_at=now() WHERE id=$1 AND event_id=$2 AND released_at IS NULL RETURNING *", [req.params.assignmentId, req.params.id]);
  if (!updated.rows[0]) throw notFound("Staff assignment");
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: "staff_removed", summary: "Staff assignment removed" });
  await writeAudit({ req, action: "staff_removed", entity: "event", entityId: req.params.id, after: updated.rows[0] });
  res.json(updated.rows[0]);
}));

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  assigned_user_id: uuid.optional().nullable(),
  lead_id: uuid.optional().nullable(),
  client_id: uuid.optional().nullable(),
  event_id: uuid.optional().nullable(),
  status: z.enum(taskStatuses).default("OPEN"),
  priority: z.enum(taskPriorities).default("NORMAL")
}).passthrough();

adminRouter.post("/tasks", requirePermission("write:tasks"), validate(taskSchema), asyncHandler(async (req, res) => {
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  const inserted = await query(`INSERT INTO tasks (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
  const entityType = req.body.event_id ? "event" : req.body.lead_id ? "lead" : req.body.client_id ? "client" : "task";
  const entityId = req.body.event_id || req.body.lead_id || req.body.client_id || inserted.rows[0].id;
  await recordActivity({ actorUserId: req.user.id, entityType, entityId, action: "task_created", summary: `Task created: ${req.body.title}` });
  await writeAudit({ req, action: "task_created", entity: "task", entityId: inserted.rows[0].id, after: inserted.rows[0] });
  res.status(201).json(inserted.rows[0]);
}));

adminRouter.patch("/tasks/:id", requirePermission("write:tasks"), validate(taskSchema.partial()), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM tasks WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!before.rows[0]) throw notFound("Task");
  const updated = await updateById({ table: "tasks", id: req.params.id, body: req.body, allowed: ["title", "description", "due_date", "assigned_user_id", "lead_id", "client_id", "event_id", "status", "priority"] });
  await recordActivity({ actorUserId: req.user.id, entityType: updated.event_id ? "event" : updated.lead_id ? "lead" : "task", entityId: updated.event_id || updated.lead_id || updated.id, action: updated.status === "DONE" ? "task_completed" : "task_edited", summary: updated.status === "DONE" ? `Task completed: ${updated.title}` : `Task edited: ${updated.title}` });
  await writeAudit({ req, action: updated.status === "DONE" ? "task_completed" : "task_edited", entity: "task", entityId: req.params.id, before: before.rows[0], after: updated });
  res.json(updated);
}));

adminRouter.delete("/tasks/:id", requirePermission("write:tasks"), asyncHandler(async (req, res) => {
  const updated = await query("UPDATE tasks SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *", [req.params.id]);
  if (!updated.rows[0]) throw notFound("Task");
  await writeAudit({ req, action: "task_deleted", entity: "task", entityId: req.params.id, before: updated.rows[0] });
  res.json(updated.rows[0]);
}));

adminRouter.post("/events/:id/communications", requirePermission("write:events"), asyncHandler(async (req, res) => {
  const type = req.body.type === "OTHER" ? "NOTE" : req.body.type;
  const inserted = await query(
    `INSERT INTO communications (event_id, type, direction, subject, message_summary, occurred_at, user_id)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()),$7) RETURNING *`,
    [req.params.id, type, req.body.direction || "INTERNAL", req.body.subject || null, req.body.summary || req.body.message_summary, req.body.timestamp || null, req.user.id]
  );
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: req.params.id, action: "communication_logged", summary: "Communication logged" });
  res.status(201).json(inserted.rows[0]);
}));

const paymentSchema = z.object({
  event_id: uuid,
  client_id: uuid,
  invoice_id: uuid.optional().nullable(),
  amount: money,
  currency: z.string().min(3).max(3).optional(),
  payment_method: z.enum(["CARD", "CASH", "CHECK", "BANK_TRANSFER", "ZELLE", "EXTERNAL_CARD", "OTHER"]),
  reference_number: z.string().optional().nullable(),
  payment_date: z.string(),
  notes: z.string().optional().nullable(),
  idempotency_key: z.string().optional().nullable()
});

adminRouter.post("/payments", requirePermission("write:finance"), validate(paymentSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await recordManualPayment(req));
}));

adminRouter.get("/analytics", requirePermission("read:analytics"), asyncHandler(async (_req, res) => {
  const [summary, revenueByMonth, byPackage, byExperience, sourcePerformance] = await Promise.all([
    query(`SELECT
      (SELECT count(*)::int FROM leads WHERE date_trunc('month', created_at)=date_trunc('month', now())) AS leads_this_month,
      (SELECT count(*)::int FROM bookings WHERE date_trunc('month', created_at)=date_trunc('month', now())) AS bookings_this_month,
      (SELECT COALESCE(sum(total),0)::text FROM bookings) AS revenue_booked,
      (SELECT COALESCE(sum(amount_paid),0)::text FROM bookings) AS revenue_collected,
      (SELECT COALESCE(sum(balance_due),0)::text FROM bookings) AS outstanding_balance,
      (SELECT COALESCE(avg(total),0)::text FROM bookings) AS average_booking_value`),
    query("SELECT to_char(created_at, 'YYYY-MM') AS month, sum(total)::text AS revenue FROM bookings GROUP BY 1 ORDER BY 1"),
    query("SELECT p.name, count(*)::int AS bookings FROM events e JOIN packages p ON p.id=e.package_id GROUP BY p.name ORDER BY bookings DESC"),
    query("SELECT x.name, count(*)::int AS bookings FROM events e JOIN experiences x ON x.id=e.experience_id GROUP BY x.name ORDER BY bookings DESC"),
    query("SELECT COALESCE(referral_source, lead_source, 'Unknown') AS source, count(*)::int AS leads, count(*) FILTER (WHERE status='WON')::int AS won FROM leads GROUP BY 1 ORDER BY leads DESC")
  ]);
  const [phase8, phase9] = await Promise.all([sourceQualityAnalytics(), operationsAnalytics()]);
  res.json({
    summary: summary.rows[0],
    revenueByMonth: revenueByMonth.rows,
    bookingsByPackage: byPackage.rows,
    bookingsByExperience: byExperience.rows,
    leadSourcePerformance: sourcePerformance.rows,
    sourceQuality: phase8.sourceQuality,
    campaignPerformance: phase8.campaignPerformance,
    operationsSummary: phase9.operationsSummary,
    incidentsByType: phase9.incidentsByType,
    equipmentUsage: phase9.equipmentUsage
  });
}));

function sampleProviderLead(provider) {
  return {
    external_lead_id: `test-${Date.now()}`,
    form_id: "test-form",
    form_name: `${String(provider).toUpperCase()} Test Form`,
    full_name: "Taylor Demo",
    email: `test-${Date.now()}@example.com`,
    phone: "555-0108",
    event_type: "Wedding",
    event_date: "2026-10-24",
    city: "Dallas",
    state: "TX",
    campaign_name: "Phase 8 Test Campaign",
    source_subtype: String(provider).toUpperCase() === "META" ? "INSTAGRAM" : String(provider).toUpperCase()
  };
}

adminRouter.get("/search", requirePermission("read:admin"), asyncHandler(async (req, res) => {
  const term = `%${req.query.q || ""}%`;
  const [clients, leads, events, invoices] = await Promise.all([
    query("SELECT 'client' AS type, id, name AS title, email AS subtitle FROM clients WHERE deleted_at IS NULL AND (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) LIMIT 8", [term]),
    query("SELECT 'lead' AS type, id, first_name || ' ' || last_name AS title, email AS subtitle FROM leads WHERE deleted_at IS NULL AND (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) LIMIT 8", [term]),
    query("SELECT 'event' AS type, id, event_name AS title, venue_name AS subtitle FROM events WHERE deleted_at IS NULL AND (event_name ILIKE $1 OR venue_name ILIKE $1) LIMIT 8", [term]),
    query("SELECT 'invoice' AS type, id, invoice_number AS title, status AS subtitle FROM invoices WHERE deleted_at IS NULL AND invoice_number ILIKE $1 LIMIT 8", [term])
  ]);
  res.json({ data: [...clients.rows, ...leads.rows, ...events.rows, ...invoices.rows] });
}));

adminRouter.get("/audit-logs", requirePermission("read:audit"), ...listRoute("audit_logs", ["action", "entity"], "read:audit"));

adminRouter.get("/settings", requirePermission("read:settings"), asyncHandler(async (_req, res) => {
  const settings = await query("SELECT * FROM business_settings LIMIT 1");
  res.json(settings.rows[0]);
}));

const settingsSchema = z.object({
  business_name: z.string().min(1).optional(),
  legal_business_name: z.string().optional().nullable(),
  business_email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  service_area: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  timezone: z.string().min(1).optional(),
  business_week_start: z.coerce.number().int().min(0).max(6).optional(),
  currency: z.string().min(3).max(3).optional(),
  sales_tax_percent: z.coerce.number().min(0).max(100).optional(),
  default_deposit_percent: z.coerce.number().min(0).max(100).optional(),
  default_balance_due_days: z.coerce.number().int().min(0).optional(),
  invoice_prefix: z.string().min(1).optional(),
  proposal_prefix: z.string().min(1).optional(),
  next_invoice_number: z.coerce.number().int().positive().optional(),
  next_proposal_number: z.coerce.number().int().positive().optional(),
  proposal_default_intro: z.string().optional(),
  proposal_default_next_steps: z.string().optional(),
  proposal_default_terms: z.string().optional(),
  proposal_default_validity_days: z.coerce.number().int().positive().optional(),
  proposal_acceptance_wording: z.string().optional(),
  invoice_default_payment_terms: z.string().optional(),
  invoice_default_notes: z.string().optional(),
  invoice_default_due_days: z.coerce.number().int().positive().optional(),
  brand_line: z.string().optional(),
  booking_confirmation_policy: z.enum(["MANUAL", "PROPOSAL_ACCEPTED", "DEPOSIT_PAID", "FULL_PAYMENT"]).optional(),
  default_deposit_type: z.enum(["PERCENTAGE", "FIXED"]).optional(),
  default_deposit_value: z.coerce.number().min(0).optional(),
  default_balance_due_days_before_event: z.coerce.number().int().min(0).optional(),
  default_equipment_turnaround_buffer_minutes: z.coerce.number().int().min(0).optional(),
  default_staff_travel_buffer_minutes: z.coerce.number().int().min(0).optional(),
  setup_warning_minutes: z.coerce.number().int().min(0).optional(),
  event_start_warning_minutes: z.coerce.number().int().min(0).optional(),
  equipment_return_warning_hours: z.coerce.number().int().min(0).optional(),
  delivery_default_expiration_days: z.coerce.number().int().min(1).optional().nullable(),
  stripe_enabled: z.boolean().optional(),
  paypal_enabled: z.boolean().optional(),
  offline_payment_instructions: z.string().optional(),
  default_setup_buffer_minutes: z.coerce.number().int().min(0).optional(),
  default_breakdown_buffer_minutes: z.coerce.number().int().min(0).optional(),
  lead_assignment_mode: z.enum(["MANUAL", "ROUND_ROBIN", "SPECIFIC_USER", "BY_SOURCE"]).optional(),
  lead_assignment_user_id: uuid.optional().nullable(),
  lead_assignment_rules: z.record(z.string(), z.string()).optional(),
  auto_acknowledge_website_leads: z.boolean().optional(),
  auto_acknowledge_social_leads: z.boolean().optional(),
  business_hours: z.record(z.string(), z.array(z.string())).optional(),
  google_review_url: z.string().optional().nullable(),
  facebook_review_url: z.string().optional().nullable(),
  other_review_url: z.string().optional().nullable()
}).passthrough();

adminRouter.patch("/settings", requirePermission("write:settings"), validate(settingsSchema), asyncHandler(async (req, res) => {
  const before = await query("SELECT * FROM business_settings LIMIT 1");
  const existing = before.rows[0];
  if (!existing) throw notFound("Settings");
  const body = cleanPatch(req.body, ["business_name", "legal_business_name", "business_email", "phone", "website", "service_area", "address", "timezone", "business_week_start", "currency", "sales_tax_percent", "default_deposit_percent", "default_balance_due_days", "invoice_prefix", "proposal_prefix", "next_invoice_number", "next_proposal_number", "proposal_default_intro", "proposal_default_next_steps", "proposal_default_terms", "proposal_default_validity_days", "proposal_acceptance_wording", "invoice_default_payment_terms", "invoice_default_notes", "invoice_default_due_days", "brand_line", "booking_confirmation_policy", "default_deposit_type", "default_deposit_value", "default_balance_due_days_before_event", "default_equipment_turnaround_buffer_minutes", "default_staff_travel_buffer_minutes", "setup_warning_minutes", "event_start_warning_minutes", "equipment_return_warning_hours", "delivery_default_expiration_days", "stripe_enabled", "paypal_enabled", "offline_payment_instructions", "default_setup_buffer_minutes", "default_breakdown_buffer_minutes", "lead_assignment_mode", "lead_assignment_user_id", "lead_assignment_rules", "auto_acknowledge_website_leads", "auto_acknowledge_social_leads", "business_hours", "google_review_url", "facebook_review_url", "other_review_url"]);
  const fields = Object.keys(body);
  if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
  const values = fields.map((field) => body[field]);
  values.push(existing.id);
  const updated = await query(`UPDATE business_settings SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
  await writeAudit({ req, action: "settings_changed", entity: "business_settings", entityId: existing.id, before: existing, after: updated.rows[0] });
  res.json(updated.rows[0]);
}));
