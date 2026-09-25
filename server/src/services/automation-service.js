import { query, transaction } from "../db/pool.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { sendEmail } from "./email-service.js";

export const implementedAutomationJobTypes = [
  "SEND_EMAIL_TEMPLATE",
  "SEND_EMAIL",
  "CREATE_DRAFT_EMAIL",
  "SCHEDULE_COMMUNICATION"
];
export const futureAutomationJobTypes = ["CREATE_TASK", "ASSIGN_LEAD", "CHANGE_LEAD_STATUS", "ADD_INTERNAL_NOTE", "CREATE_DRAFT_SMS", "SEND_SMS"];
const staleProcessingMinutes = 10;

export const allowedTemplateVariables = [
  "first_name", "client_name", "event_type", "event_date", "venue", "proposal_number",
  "proposal_url", "invoice_number", "invoice_url", "amount_due", "due_date",
  "remaining_balance", "gallery_url", "business_email", "business_phone", "review_url",
  "client.first_name", "client.last_name", "client.name", "client.email", "client.phone",
  "lead.id", "lead.source", "lead.duplicate_of_id",
  "event.id", "event.name", "event.type", "event.date", "event.venue", "event.guest_count", "event.url",
  "proposal.id", "proposal.number", "proposal.url", "proposal.expires_at", "proposal.package_name", "proposal.total",
  "invoice.id", "invoice.number", "invoice.url", "invoice.amount_due", "invoice.balance_due", "invoice.due_date",
  "payment.id", "payment.amount", "payment.receipt_url",
  "package.name", "package.total",
  "gallery.url",
  "business.email", "business.phone", "business.review_url",
  "user.name", "user.email",
  "refund.amount", "refund.reason",
  "agreement.url", "agreement.status",
  "approval.url", "approval.version", "approval.notes", "approval.status",
  "production.call_time", "production.requirements", "production.venue_address", "production.day_of_contact", "production.experience", "production.equipment", "production.setup_instructions",
  "request.notes", "request.type", "request.submitted_at", "request.source_page", "request.status",
  "review.url",
  "staff.first_name", "staff.name", "staff.email", "staff.role"
];

export const templateVariableCatalog = [
  ["Client", ["client.first_name", "client.last_name", "client.name", "client.email", "client.phone"]],
  ["Event", ["event.id", "event.name", "event.type", "event.date", "event.venue", "event.guest_count", "event.url"]],
  ["Proposal", ["proposal.id", "proposal.number", "proposal.url", "proposal.expires_at", "proposal.package_name", "proposal.total"]],
  ["Invoice", ["invoice.id", "invoice.number", "invoice.url", "invoice.amount_due", "invoice.balance_due", "invoice.due_date"]],
  ["Payment", ["payment.id", "payment.amount", "payment.receipt_url"]],
  ["Package", ["package.name", "package.total"]],
  ["Gallery", ["gallery.url"]],
  ["Business", ["business.email", "business.phone", "business.review_url"]],
  ["User", ["user.name", "user.email"]],
  ["Refund", ["refund.amount", "refund.reason"]],
  ["Agreement", ["agreement.url", "agreement.status"]],
  ["Approval", ["approval.url", "approval.version", "approval.notes", "approval.status"]],
  ["Production", ["production.call_time", "production.requirements", "production.venue_address", "production.day_of_contact", "production.experience", "production.equipment", "production.setup_instructions"]],
  ["Request", ["request.notes", "request.type", "request.submitted_at", "request.source_page", "request.status"]],
  ["Review", ["review.url"]]
].map(([category, variables]) => ({ category, variables }));

export function collectTemplateVariables(...parts) {
  return [...new Set(parts.flatMap((part = "") => [...String(part).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((match) => match[1])))];
}

function isNestedVariable(variable) {
  return variable.includes(".");
}

function valueAtPath(data, path) {
  return path.split(".").reduce((value, key) => {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  }, data);
}

function unresolvedVariables(parts, data = {}) {
  return collectTemplateVariables(...parts).filter((variable) => {
    if (!allowedTemplateVariables.includes(variable)) return true;
    const value = isNestedVariable(variable) ? valueAtPath(data, variable) : data[variable];
    return value === undefined || value === null || value === "";
  });
}

export function renderTemplate(text = "", data = {}) {
  return String(text).replace(/\\r\\n|\\n/g, "\n").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key) => {
    if (!allowedTemplateVariables.includes(key)) throw new AppError(`Unknown template variable: ${key}`, 422, "UNKNOWN_TEMPLATE_VARIABLE");
    const value = isNestedVariable(key) ? valueAtPath(data, key) : data[key];
    if (value === undefined || value === null) {
      if (isNestedVariable(key)) throw new AppError(`Missing template variable: ${key}`, 422, "MISSING_TEMPLATE_VARIABLE", { variable: key });
      return "";
    }
    return value;
  });
}

export function validateTemplate(body = "", subject = "") {
  const variables = collectTemplateVariables(subject, body);
  const unknown = variables.filter((variable) => !allowedTemplateVariables.includes(variable));
  if (unknown.length) throw new AppError(`Unknown template variable: ${unknown.join(", ")}`, 422, "UNKNOWN_TEMPLATE_VARIABLE");
  return [...new Set(variables)];
}

export async function recordTemplateFallback({ templateKey, reason, relatedEntityType = null, relatedEntityId = null, metadata = {} }) {
  logger.warn({ templateKey, reason, relatedEntityType, relatedEntityId, environment: env.nodeEnv, ...metadata }, "Communication template fallback used");
  await query(
    `INSERT INTO communication_fallback_events (template_key, reason, related_entity_type, related_entity_id, environment, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [templateKey, reason, relatedEntityType, relatedEntityId, env.nodeEnv, metadata]
  ).catch((error) => logger.warn({ err: error, templateKey }, "Failed to record communication fallback event"));
}

export function smsProviderStatus() {
  if (!env.smsProvider || env.smsProvider === "none") return { state: "NOT_CONFIGURED", provider: env.smsProvider || "none", ready: false };
  return { state: "DISABLED", provider: env.smsProvider, ready: false, reason: "No active SMS adapter is configured." };
}

export function assertSmsConsent({ communicationType = "TRANSACTIONAL", recipient = {} } = {}) {
  if (communicationType === "MARKETING") {
    const consent = recipient.sms_consent_status === "OPTED_IN" || recipient.marketing_sms_opt_in === true;
    if (!consent || recipient.sms_opted_out_at) throw new AppError("Marketing SMS requires opt-in consent and no opt-out.", 422, "SMS_MARKETING_CONSENT_REQUIRED", { retryable: false });
  }
  if (recipient.sms_opted_out_at) throw new AppError("Recipient has opted out of SMS.", 422, "SMS_RECIPIENT_OPTED_OUT", { retryable: false });
  return true;
}

export function classifyAutomationJobType(jobType) {
  if (implementedAutomationJobTypes.includes(jobType)) return "IMPLEMENTED";
  if (futureAutomationJobTypes.includes(jobType)) return "NOT_IMPLEMENTED";
  return "UNSAFE";
}

function unsupportedAutomationJobError(jobType) {
  return new AppError(`Automation job type ${jobType} is not implemented and was not processed.`, 422, "AUTOMATION_ACTION_NOT_IMPLEMENTED", {
    jobType,
    retryable: false
  });
}

export async function listEmailTemplates() {
  const result = await query(
    `SELECT *,
            COALESCE(key, template_key) AS key,
            COALESCE(subject_template, subject) AS subject_template,
            COALESCE(body_template, body) AS body_template
     FROM email_templates
     WHERE deleted_at IS NULL AND archived_at IS NULL
     ORDER BY category, channel, name`
  );
  return { data: result.rows, variables: allowedTemplateVariables, variableCatalog: templateVariableCatalog };
}

export async function getEmailTemplate(id) {
  const template = (await query(
    `SELECT *,
            COALESCE(key, template_key) AS key,
            COALESCE(subject_template, subject) AS subject_template,
            COALESCE(body_template, body) AS body_template
     FROM email_templates
     WHERE id=$1 AND deleted_at IS NULL`,
    [id]
  )).rows[0];
  if (!template) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
  const [versions, usedBy] = await Promise.all([
    query("SELECT * FROM communication_template_versions WHERE template_id=$1 ORDER BY version DESC", [id]),
    query("SELECT id, name, trigger_key, action_type, action_config, enabled FROM automations WHERE action_config->>'template_key' IN ($1,$2) AND deleted_at IS NULL ORDER BY name", [template.template_key, template.key || template.template_key])
  ]);
  return { template, versions: versions.rows, usedBy: usedBy.rows, variables: allowedTemplateVariables, variableCatalog: templateVariableCatalog };
}

async function snapshotTemplateVersion(client, template, userId = null) {
  await client.query(
    `INSERT INTO communication_template_versions (
       template_id, template_key, version, name, category, template_type, channel, status,
       subject_template, body_template, text_template, default_send_mode, description, variables, snapshot, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (template_id, version) DO NOTHING`,
    [
      template.id,
      template.key || template.template_key,
      template.version,
      template.name,
      template.category,
      template.template_type,
      template.channel,
      template.status,
      template.subject_template || template.subject,
      template.body_template || template.body,
      template.text_template || template.body,
      template.default_send_mode,
      template.description,
      template.variables || [],
      {
        subject_template: template.subject_template || template.subject,
        body_template: template.body_template || template.body,
        text_template: template.text_template || template.body,
        version: template.version
      },
      userId
    ]
  );
}

function validateTemplateIdentity(input,creating=false){
 if((creating||input.name!==undefined)&&!String(input.name||'').trim())throw new AppError('Template name is required.',422,'TEMPLATE_NAME_REQUIRED');
 const key=input.key??input.template_key;
 if((creating||key!==undefined)&&!/^\w[\w.-]{0,99}$/.test(key||''))throw new AppError('Use a template key containing letters, numbers, periods, dashes or underscores.',422,'TEMPLATE_KEY_INVALID');
}
export async function updateEmailTemplate(id, body, user = {}) {
  validateTemplateIdentity(body);
  const allowed = [
    "name", "category", "subject", "body", "active", "transactional",
    "key", "template_key", "template_type", "channel", "status", "subject_template", "body_template",
    "text_template", "default_send_mode", "description"
  ];
  const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  let incrementVersion = false;
  if (["subject","body","subject_template","body_template"].some(key=>patch[key]!==undefined)) {
    const current = (await query("SELECT subject, body, subject_template, body_template FROM email_templates WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
    if (!current) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
    const nextSubject = patch.subject_template ?? patch.subject ?? current.subject_template ?? current.subject;
    const nextBody = patch.body_template ?? patch.body ?? current.body_template ?? current.body;
    patch.variables = validateTemplate(nextBody, nextSubject);
    patch.body=nextBody;patch.body_template=nextBody;patch.subject=nextSubject;patch.subject_template=nextSubject;
    if (patch.subject_template && !patch.subject) patch.subject = patch.subject_template;
    if (patch.body_template && !patch.body) patch.body = patch.body_template;
    if (patch.subject && !patch.subject_template) patch.subject_template = patch.subject;
    if (patch.body && !patch.body_template) patch.body_template = patch.body;
    incrementVersion = true;
  }
  const fields = Object.keys(patch);
  if (!fields.length) throw new AppError("No supported template fields supplied.", 400, "NO_FIELDS");
  const values = fields.map((field) => patch[field]);
  values.push(id);
  return transaction(async (client) => {
    if (patch.key || patch.template_key) {
      const current = (await client.query("SELECT key, template_key FROM email_templates WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
      const nextKey = patch.key || patch.template_key;
      const referenced = nextKey && nextKey !== (current?.key || current?.template_key) ? (await client.query(
        `SELECT EXISTS(SELECT 1 FROM communications WHERE template_id=$1) OR
                EXISTS(SELECT 1 FROM automations WHERE action_config->>'template_key' IN ($2,$3) AND deleted_at IS NULL) AS referenced`,
        [id, current?.key, current?.template_key]
      )).rows[0]?.referenced : false;
      if (referenced) throw new AppError("Template key cannot be changed after production use. Duplicate or archive this template instead.", 409, "TEMPLATE_KEY_IMMUTABLE");
    }
    const result = await client.query(
      `UPDATE email_templates SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}${incrementVersion ? ", version=version+1" : ""}, updated_by=$${values.length + 1}, updated_at=now()
       WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *`,
      [...values, user.id || null]
    );
    if (!result.rows[0]) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
    await snapshotTemplateVersion(client, result.rows[0], user.id || null);
    return result.rows[0];
  });
}

export async function previewEmailTemplate(id, data = sampleMergeData()) {
  const template = (await query("SELECT * FROM email_templates WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  if (!template) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
  const subjectTemplate = template.subject_template || template.subject;
  const bodyTemplate = template.body_template || template.body;
  const unresolved = unresolvedVariables([subjectTemplate, bodyTemplate, template.text_template || ""], data);
  let subject = subjectTemplate;
  let body = bodyTemplate;
  let html = "";
  if (!unresolved.length) {
    subject = renderTemplate(subjectTemplate, data);
    body = renderTemplate(bodyTemplate, data);
    html = brandedEmailHtml(body);
  }
  return {
    subject,
    body,
    html,
    text: unresolved.length ? (template.text_template || bodyTemplate) : renderTemplate(template.text_template || bodyTemplate, data),
    variables: collectTemplateVariables(subjectTemplate, bodyTemplate, template.text_template || ""),
    unresolvedVariables: unresolved,
    canSend: unresolved.length === 0
  };
}

function sampleMergeData() {
  return {
    first_name: "Mia",
    client_name: "Mia Chen",
    event_type: "Wedding",
    event_date: "2026-10-24",
    venue: "The Mason Dallas",
    proposal_number: "PROP-1001",
    proposal_url: "https://lolabooths.com/proposal/sample",
    invoice_number: "LOLA-1001",
    invoice_url: "https://lolabooths.com/invoice/sample",
    amount_due: "$329.70",
    due_date: "2026-10-10",
    remaining_balance: "$769.30",
    gallery_url: "https://gallery.example/lola",
    business_email: "hello@lolabooths.com",
    business_phone: "(555) 010-LOLA",
    review_url: "https://example.com/review",
    client: { first_name: "Mia", last_name: "Chen", name: "Mia Chen", email: "mia@example.com", phone: "(555) 010-1001" },
    lead: { id: "sample-lead", source: "WEBSITE", duplicate_of_id: "" },
    event: { id: "sample-event", name: "Mia + Jordan Wedding", type: "Wedding", date: "2026-10-24", venue: "The Mason Dallas", guest_count: "150", url: "https://lolabooths.com/my-events/sample" },
    proposal: { id: "sample-proposal", number: "PROP-1001", url: "https://lolabooths.com/proposal/sample", expires_at: "2026-10-10", package_name: "Luxe Booth", total: "$1,099.00" },
    invoice: { id: "sample-invoice", number: "LOLA-1001", url: "https://lolabooths.com/invoice/sample", amount_due: "$329.70", balance_due: "$769.30", due_date: "2026-10-10" },
    payment: { id: "sample-payment", amount: "$329.70", receipt_url: "https://lolabooths.com/receipt/sample" },
    package: { name: "Luxe Booth", total: "$1,099.00" },
    gallery: { url: "https://gallery.example/lola" },
    business: { email: "hello@lolabooths.com", phone: "(555) 010-LOLA", review_url: "https://example.com/review" },
    user: { name: "LOLA Admin", email: "admin@lolabooths.com" },
    refund: { amount: "$50.00", reason: "Client adjustment" },
    agreement: { url: "https://lolabooths.com/agreement/sample", status: "Pending Signature" },
    approval: { url: "https://lolabooths.com/approvals/sample", version: "1", notes: "Please approve the layout.", status: "PENDING_APPROVAL" },
    production: { call_time: "15:00", requirements: "Power within 25 feet", venue_address: "123 Main St, Dallas, TX", day_of_contact: "Jordan (555) 010-2002", experience: "Digital Booth", equipment: "Booth, backdrop, props", setup_instructions: "Load in through the west entrance." },
    request: { notes: "Please send a transparent logo.", type: "Brand Assets", submitted_at: "2026-09-14T12:00:00.000Z", source_page: "https://lolabooths.com/contact", status: "CREATED_LEAD" },
    review: { url: "https://example.com/review" },
    staff: { first_name: "Avery", name: "Avery Brooks", email: "avery@example.com", role: "Lead Attendant" }
  };
}

function htmlEscape(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function bodyToHtml(body = "") {
  return htmlEscape(body).split(/\n{2,}/).map((paragraph) => `<p style="margin:0 0 18px;line-height:1.55">${paragraph.replace(/\n/g, "<br>")}</p>`).join("");
}

function fieldCell(label, value, icon = "star", assetBase = "") {
  if (!value) return "";
  return `<td class="field-cell" style="width:25%;padding:18px 12px;text-align:center;border-left:1px solid #d9c6b5;color:#101a36">
    <div style="line-height:1">${emailIcon(icon, assetBase)}</div>
    <div class="feature-label" style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:4px;text-transform:uppercase;margin-top:12px">${htmlEscape(label)}</div>
    <div class="field-value" style="font-family:Georgia,serif;font-size:16px;line-height:1.3;margin-top:8px">${htmlEscape(value)}</div>
  </td>`;
}

function emailIcon(name, assetBase) {
  return `<img alt="" width="28" height="28" src="${htmlEscape(assetBase)}/brand/icons/${name}.png" style="display:block;margin:0 auto;width:28px;height:28px;border:0">`;
}

export function brandedEmailHtml(body, options = {}) {
  const publicBase = (options.assetBaseUrl || process.env.EMAIL_ASSET_BASE_URL || process.env.CLIENT_ORIGIN || "https://admin.thelolabooth.com").replace(/\/$/, "");
  const logo = `${publicBase}/brand/LOLA_Primary_Dark_Transparent.png`;
  const monogram = `${publicBase}/brand/LOLA_LB_Monogram_Gold.png`;
  const darkLogo = `${publicBase}/brand/LOLA_Primary_Light_Transparent.png`;
  const hero = options.heroUrl || `${publicBase}/brand/lola-booth-logo.jpg`;
  const greeting = String(body || "").match(/^\s*(?:Hi|Hello|Dear)\s+([^,\n]{1,100}),?\s*\n+/i);
  const firstName = options.firstName || greeting?.[1]?.trim() || "there";
  const contentBody = greeting ? String(body).slice(greeting[0].length) : body;
  const kicker = options.kicker || "";
  const ctaUrl = options.ctaUrl || "";
  const ctaLabel = options.ctaLabel || "LET'S STAY CONNECTED";
  const event = options.event || {};
  const cell = (label, value, icon) => fieldCell(label, value, icon, publicBase);
  const summaryCells = [
    cell("Event Date", event.date, "calendar"),
    cell("Venue", event.venue, "pin"),
    cell("Event Type", event.type, "users"),
    cell(event.packageLabel || "Package", event.packageName || event.experienceName || event.title, "star")
  ].filter(Boolean).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  table, td { box-sizing: border-box; }
  img { max-width: 100%; height: auto; margin-left: auto; margin-right: auto; }
  .copy-link { overflow-wrap: anywhere; word-break: break-word; }
  @media only screen and (max-width: 820px) {
    html, body { width: 100% !important; max-width: 100% !important; }
    table { width: 100% !important; max-width: 100% !important; table-layout: fixed !important; }
    td, div, p, a, span { white-space: normal !important; }
    .outer-wrapper, .email-container { width: 100vw !important; max-width: 100vw !important; min-width: 0 !important; table-layout: fixed !important; }
    .topline, .brand-row, .footer-row { width: 100% !important; }
    .topline td, .brand-row td, .footer-row td { display: block !important; width: 100% !important; text-align: center !important; }
    .topline td { padding: 3px 0 !important; }
    .brand-pad, .content-pad, .closing-pad, .footer-pad { padding-left: 20px !important; padding-right: 20px !important; width: auto !important; }
    .content-copy { font-size: 16px !important; line-height: 1.48 !important; overflow-wrap: break-word !important; }
    .kicker { font-size: 12px !important; letter-spacing: 5px !important; line-height: 1.55 !important; overflow-wrap: anywhere !important; }
    .benefit-strip { display:none !important; }
    .brand-pad { padding-top: 12px !important; padding-bottom: 12px !important; }
    .brand-row td:first-child { display:none !important; }
    .brand-center img { width:108px !important; }
    .footer-row img { width:88px !important; }
    .hero-strip { height:88px !important; }
    .hero-text { padding-top:10px !important; font-size:11px !important; line-height:1.4 !important; }
    .footer-pad { padding-top:16px !important; padding-bottom:16px !important; }
    .signature-tagline { letter-spacing:2px !important; }
    .brand-center { border-left: 0 !important; border-right: 0 !important; padding: 6px 0 !important; }
    .contact-cell { padding-left: 0 !important; font-size: 14px !important; line-height: 1.7 !important; }
    .hero-text { padding-left: 20px !important; width: 160px !important; }
    .field-cell { display: block !important; width: auto !important; border-left: 0 !important; border-top: 1px solid #d9c6b5 !important; }
    .field-cell div { overflow-wrap: anywhere !important; word-break: normal !important; }
    .field-value { font-size: 15px !important; }
    .feature-label { font-size: 9px !important; letter-spacing: 3px !important; line-height: 1.6 !important; }
    .cta-button { display: block !important; box-sizing: border-box !important; width: 100% !important; max-width: 320px !important; letter-spacing: 3px !important; padding-left: 14px !important; padding-right: 14px !important; }
    .closing-text { font-size: 16px !important; overflow-wrap: break-word !important; }
    .signature { font-size: 32px !important; line-height: 1.1 !important; }
    .signature-tagline { font-size: 11px !important; letter-spacing: 4px !important; line-height: 1.6 !important; overflow-wrap: anywhere !important; }
    .footer-nav { font-size: 9px !important; letter-spacing: 3px !important; line-height: 1.9 !important; overflow-wrap: anywhere !important; }
  }
</style></head>
<body style="margin:0;padding:0;background:#f4f0e8;color:#101a36;font-family:Georgia,'Times New Roman',serif">
  <table class="outer-wrapper" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e8"><tr><td align="center">
    <table class="email-container" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:720px;background:#fffdf8">
      <tr><td style="background:#f1ede5;padding:18px 38px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#090909">
        <table class="topline" role="presentation" width="100%"><tr><td>Events&nbsp;&nbsp; | &nbsp;&nbsp;Brand Activations&nbsp;&nbsp; | &nbsp;&nbsp;Weddings&nbsp;&nbsp; | &nbsp;&nbsp;Corporate</td><td align="right">Unforgettable Moments<br>Beautifully Captured</td></tr></table>
      </td></tr>
      <tr><td class="brand-pad" style="padding:28px 42px 24px">
        <table class="brand-row" role="presentation" width="100%"><tr>
          <td width="25%" align="center"><img src="${monogram}" alt="LB" width="108" style="width:108px;max-width:80%;height:auto;display:block"></td>
          <td class="brand-center" width="42%" align="center" style="border-left:1px solid #b2864b;border-right:1px solid #b2864b"><img src="${logo}" alt="The Lola Booth" width="210" style="width:210px;max-width:82%;height:auto;display:block;margin:auto"></td>
          <td class="contact-cell" width="33%" style="padding-left:34px;font-size:16px;line-height:1.9;color:#101a36"><span style="color:#a8753b">&#9742;</span>&nbsp;&nbsp;(773) 240-2744<br><span style="color:#a8753b">&#9993;</span>&nbsp;&nbsp;info@thelolabooth.com<br><span style="color:#a8753b">&#9678;</span>&nbsp;&nbsp;thelolabooth.com</td>
        </tr></table>
      </td></tr>
      <tr><td><div class="hero-strip" style="height:170px;background-color:#15110d;background-image:linear-gradient(90deg,rgba(0,0,0,.8),rgba(0,0,0,.35)),url('${hero}');background-position:center;background-size:cover;background-repeat:no-repeat;color:white"><div class="hero-text" style="padding:42px 0 0 56px;width:190px;text-align:center;font-family:Arial,sans-serif;letter-spacing:6px;text-transform:uppercase;line-height:1.9;font-size:15px">More Than<br>Photos<br><span style="letter-spacing:0">-</span><br>It's A Vibe</div></div></td></tr>
      <tr><td class="content-pad" style="padding:30px 42px 20px">
        <div style="font-size:32px;line-height:1.1;color:#090909">Hi ${htmlEscape(firstName)},</div>
        ${kicker ? `<div class="kicker" style="font-family:Arial,sans-serif;font-size:15px;letter-spacing:7px;text-transform:uppercase;color:#a8753b;margin-top:18px">${htmlEscape(kicker)}</div>` : ""}
        <div class="content-copy" style="font-size:16px;line-height:1.65;margin-top:18px;color:#101a36;overflow-wrap:anywhere">${bodyToHtml(contentBody)}</div>
        ${ctaUrl ? `<div style="text-align:center;margin:28px 0 8px"><a class="cta-button" href="${htmlEscape(ctaUrl)}" style="display:inline-block;background:#b1844c;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;letter-spacing:6px;text-transform:uppercase;padding:17px 54px;border-radius:2px">${htmlEscape(ctaLabel)} &rarr;</a><div class="copy-link" style="font-size:13px;margin-top:14px;color:#101a36">Or copy and paste this link into your browser:<br><span style="color:#a8753b">${htmlEscape(ctaUrl)}</span></div></div>` : ""}
      </td></tr>
      ${summaryCells ? `<tr><td style="padding:0 30px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3efe8"><tr>${summaryCells}</tr></table></td></tr>` : ""}
      <tr class="benefit-strip"><td style="padding:0 30px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #b2864b;border-bottom:1px solid #b2864b"><tr>
        ${cell("Premium Experience", " ", "camera")}${cell("Beautiful Brandable Content", " ", "heart")}${cell("Instant Sharing", " ", "share")}${cell("A Team That Takes Care Of You", " ", "users")}
      </tr></table></td></tr>
      <tr><td class="closing-pad closing-text" style="padding:0 42px 34px;font-size:18px;line-height:1.5;color:#101a36">${options.closing || "Thank you again for reaching out. We can't wait to help you create unforgettable moments with The Lola Booth!"}<div class="signature" style="font-size:38px;color:#a8753b;margin-top:22px;font-style:italic">The Lola Booth Team</div><div class="signature-tagline" style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:5px;text-transform:uppercase">The Lola Booth<br>Unforgettable Moments, Beautifully Captured</div></td></tr>
      <tr><td class="footer-pad" style="background:#050505;color:#fff;padding:30px 42px"><table class="footer-row" role="presentation" width="100%"><tr><td><img src="${darkLogo}" alt="The Lola Booth" width="210" style="width:210px;max-width:82%;height:auto"></td><td align="right" style="font-family:Arial,sans-serif;letter-spacing:4px;text-transform:uppercase;font-size:12px">Follow Our Journey<br><div style="font-size:11px;letter-spacing:1px;margin:14px 0 8px">Instagram &nbsp; | &nbsp; TikTok &nbsp; | &nbsp; YouTube</div><span style="font-family:Georgia,serif;letter-spacing:0;text-transform:none;font-size:16px">@thelolabooth</span></td></tr></table><div class="footer-nav" style="border-top:1px solid #b2864b;margin-top:24px;padding-top:18px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:5px;text-transform:uppercase;color:#c59a5f">Events &nbsp; | &nbsp; Brand Activations &nbsp; | &nbsp; Weddings &nbsp; | &nbsp; Corporate &nbsp; | &nbsp; Unforgettable Moments</div></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function renderCommunicationTemplateByKey(templateKey, data = sampleMergeData()) {
  const template = (await query(
    `SELECT * FROM email_templates
     WHERE (template_key=$1 OR key=$1) AND active=true AND status='ACTIVE' AND deleted_at IS NULL AND archived_at IS NULL
     ORDER BY updated_at DESC LIMIT 1`,
    [templateKey]
  )).rows[0];
  if (!template) return null;
  const subjectTemplate = template.subject_template || template.subject;
  const bodyTemplate = template.body_template || template.body;
  const subject = renderTemplate(subjectTemplate, data);
  const body = renderTemplate(bodyTemplate, data);
  return {
    template,
    subject,
    body,
    html: template.channel === "EMAIL" ? brandedEmailHtml(body) : null,
    variables: collectTemplateVariables(subjectTemplate, bodyTemplate)
  };
}

function splitEmails(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export async function listCommunications(filters = {}) {
  const clauses = ["c.deleted_at IS NULL"];
  const values = [];
  for (const field of ["status", "channel", "client_id", "lead_id", "event_id", "proposal_id", "invoice_id"]) {
    if (filters[field]) {
      values.push(filters[field]);
      clauses.push(`c.${field}=$${values.length}`);
    }
  }
  if (filters.search) {
    values.push(`%${String(filters.search).slice(0, 200)}%`);
    clauses.push(`(c.recipient ILIKE $${values.length} OR c.rendered_subject ILIKE $${values.length} OR et.name ILIKE $${values.length})`);
  }
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(filters.page)) || 1));
  const pageSize = Math.max(1, Math.min(150, Math.trunc(Number(filters.pageSize)) || 50));
  const sort = { recipient: "c.recipient", status: "c.status", created_at: "c.created_at", scheduled_at: "c.scheduled_at" }[filters.sort] || "COALESCE(c.scheduled_at, c.sent_at, c.occurred_at, c.created_at)";
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const joined = `FROM communications c LEFT JOIN email_templates et ON et.id=c.template_id WHERE ${clauses.join(" AND ")}`;
  const count = await query(`SELECT count(*)::int AS total ${joined}`, values);
  const result = await query(
    `SELECT c.*, et.name AS template_name ${joined}
     ORDER BY ${sort} ${direction} NULLS LAST, c.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize]
  );
  return { data: result.rows, pagination: { page, pageSize, total: count.rows[0].total } };
}

export async function getCommunication(id) {
  const result = await query(
    `SELECT c.*, et.name AS template_name, et.key AS template_key_current, cl.name AS client_name, e.event_name,
            p.proposal_number, i.invoice_number, concat_ws(' ', l.first_name, l.last_name) AS lead_name
     FROM communications c
     LEFT JOIN email_templates et ON et.id=c.template_id
     LEFT JOIN clients cl ON cl.id=c.client_id
     LEFT JOIN leads l ON l.id=c.lead_id
     LEFT JOIN events e ON e.id=c.event_id
     LEFT JOIN proposals p ON p.id=c.proposal_id
     LEFT JOIN invoices i ON i.id=c.invoice_id
     WHERE c.id=$1 AND c.deleted_at IS NULL`,
    [id]
  );
  if (!result.rows[0]) throw new AppError("Communication not found.", 404, "COMMUNICATION_NOT_FOUND");
  return result.rows[0];
}

export async function updateCommunicationDraft(id, input = {}, user = {}) {
  return transaction(async (client) => {
    const current = (await client.query("SELECT * FROM communications WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])).rows[0];
    if (!current) throw new AppError("Communication not found.", 404, "COMMUNICATION_NOT_FOUND");
    if (!["DRAFT", "SCHEDULED", "FAILED"].includes(current.status)) throw new AppError("Sent communications are immutable.", 409, "COMMUNICATION_IMMUTABLE");
    const allowed = ["recipient", "subject", "rendered_subject", "rendered_body", "rendered_html", "scheduled_at", "send_mode"];
    const patch = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)));
    if (patch.subject && !patch.rendered_subject) patch.rendered_subject = patch.subject;
    if (patch.rendered_body !== undefined) { patch.message_summary = patch.rendered_body.slice(0, 500); patch.rendered_html = brandedEmailHtml(patch.rendered_body); }
    const fields = Object.keys(patch);
    if (!fields.length) return current;
    const values = fields.map((field) => patch[field]);
    values.push(id, user.id || null);
    const result = await client.query(
      `UPDATE communications
       SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=now(), user_id=COALESCE(user_id,$${values.length})
       WHERE id=$${values.length - 1} AND deleted_at IS NULL RETURNING *`,
      values
    );
    await recordActivity({ actorUserId: user.id, entityType: "communication", entityId: id, action: "communication_draft_updated", summary: "Communication draft updated" });
    return result.rows[0];
  });
}

async function templateForDraft(input) {
  if (!input.template_id && !input.template_key) return null;
  const values = [input.template_id || input.template_key];
  return (await query(
    `SELECT * FROM email_templates
     WHERE ${input.template_id ? "id=$1" : "(template_key=$1 OR key=$1)"}
       AND deleted_at IS NULL AND archived_at IS NULL
     LIMIT 1`,
    values
  )).rows[0] || null;
}

function communicationFieldsFromInput(input, rendered = {}) {
  return {
    channel: input.channel || rendered.template?.channel || "EMAIL",
    type: input.channel || rendered.template?.channel || "EMAIL",
    direction: input.direction || "OUTBOUND",
    subject: input.subject ?? rendered.subject ?? "",
    body: input.body ?? rendered.body ?? "",
    html: input.html ?? rendered.html ?? (input.body ? brandedEmailHtml(input.body) : null),
    recipient: input.recipient || input.to || "",
    cc: splitEmails(input.cc),
    bcc: splitEmails(input.bcc),
    send_mode: input.send_mode || rendered.template?.default_send_mode || "CREATE_DRAFT",
    status: input.status || "DRAFT",
    merge_data: input.merge_data || {}
  };
}

export async function createCommunicationDraft(input = {}, user = {}) {
  const template = await templateForDraft(input);
  const rendered = template ? {
    template,
    ...(await renderCommunicationTemplateByKey(template.key || template.template_key, input.merge_data || sampleMergeData()) || {})
  } : {};
  const fields = communicationFieldsFromInput(input, rendered);
  const result = await query(
    `INSERT INTO communications (
       client_id, lead_id, event_id, proposal_id, invoice_id, payment_id, type, channel, direction,
       template_id, template_key, template_version, recipient, cc, bcc, subject, message_summary,
       rendered_subject, rendered_body, rendered_html, merge_data, send_mode, status, scheduled_at, trigger_key,
       created_by, user_id, occurred_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,
       $10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,
       $26,$26,now()
     ) RETURNING *`,
    [
      input.client_id || null,
      input.lead_id || null,
      input.event_id || null,
      input.proposal_id || null,
      input.invoice_id || null,
      input.payment_id || null,
      fields.type,
      fields.channel,
      fields.direction,
      template?.id || null,
      template?.key || template?.template_key || input.template_key || null,
      template?.version || null,
      fields.recipient,
      fields.cc,
      fields.bcc,
      fields.subject,
      fields.body.slice(0, 500),
      fields.subject,
      fields.body,
      fields.html,
      fields.merge_data,
      fields.send_mode,
      fields.status,
      input.scheduled_at || null,
      input.trigger_key || null,
      user.id || null
    ]
  );
  await recordActivity({ actorUserId: user.id, entityType: "communication", entityId: result.rows[0].id, action: "communication_draft_created", summary: `${fields.channel} draft created` });
  return result.rows[0];
}

export async function sendCommunication(id, user = {}, { workerClaim = false } = {}) {
  const result = await transaction(async (client) => {
    const communication = (await client.query("SELECT * FROM communications WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])).rows[0];
    if (!communication) throw new AppError("Communication not found.", 404, "COMMUNICATION_NOT_FOUND");
    if (communication.status === "SENT" || communication.status === "SENT_TO_PROVIDER") {
      logger.warn({ communicationId: id, providerMessageId: communication.provider_message_id }, "Duplicate communication send prevented");
      return { communication, delivery: { status: communication.status, provider: communication.provider, providerMessageId: communication.provider_message_id, duplicatePrevented: true } };
    }
    if (!["DRAFT", "SCHEDULED", "FAILED", ...(workerClaim ? ["PROCESSING"] : [])].includes(communication.status)) throw new AppError("This communication cannot be sent.", 409, "COMMUNICATION_IMMUTABLE");
    if (communication.channel === "SMS") throw new AppError("SMS provider is disabled or not configured. Message was not sent.", 422, "SMS_PROVIDER_DISABLED", { retryable: false });
    if (communication.channel !== "EMAIL") throw new AppError("Only email sending is currently enabled.", 422, "CHANNEL_NOT_IMPLEMENTED", { retryable: false });
    if (!communication.recipient) throw new AppError("Recipient is required before sending.", 422, "COMMUNICATION_RECIPIENT_REQUIRED", { retryable: false });
    if (!communication.subject || !communication.rendered_body) throw new AppError("Subject and body are required before sending.", 422, "COMMUNICATION_CONTENT_REQUIRED", { retryable: false });
    let delivery;
    try { delivery = await sendEmail({
      to: communication.recipient,
      cc: communication.cc,
      bcc: communication.bcc,
      subject: communication.rendered_subject || communication.subject,
      body: communication.rendered_body,
      html: communication.rendered_html
    });
    } catch (error) {
      await client.query("UPDATE communications SET status='FAILED',failed_at=now(),failure_code='EMAIL_SEND_FAILED',failure_message='Email provider rejected the send. Check provider configuration and retry.',updated_at=now() WHERE id=$1", [id]);
      return { sendError: new AppError("Email delivery failed. The message is saved and can be retried.", 502, "EMAIL_SEND_FAILED") };
    }
    const updated = await client.query(
      `UPDATE communications
       SET status='SENT_TO_PROVIDER', failed_at=NULL, failure_code=NULL, failure_message=NULL, provider=$1, provider_message_id=$2, sent_at=now(), occurred_at=now(), sent_by=$3, rendered_subject=COALESCE(rendered_subject, subject), idempotency_key=COALESCE(idempotency_key,$5), updated_at=now()
       WHERE id=$4 RETURNING *`,
      [delivery.provider, delivery.providerMessageId, user.id || null, id, `communication:${id}`]
    );
    await client.query(
      `INSERT INTO email_messages (communication_id, provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [id, delivery.provider, delivery.providerMessageId, communication.recipient, communication.rendered_subject || communication.subject, delivery.status || "SENT", communication.rendered_body.slice(0, 500)]
    );
    await recordActivity({ actorUserId: user.id, entityType: "communication", entityId: id, action: "communication_sent_to_provider", summary: `${communication.channel} sent to provider for ${communication.recipient}` });
    return { communication: updated.rows[0], delivery };
  });
  if (result.sendError) throw result.sendError;
  return result;
}

export async function scheduleCommunication(id, scheduledAt, user = {}) {
  if (!Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) throw new AppError("Choose a future schedule time.", 422, "INVALID_SCHEDULE");
  const result = await query(
    `UPDATE communications
     SET status='SCHEDULED', send_mode='SCHEDULED', scheduled_at=$1, updated_at=now(), created_by=COALESCE(created_by,$2)
     WHERE id=$3 AND deleted_at IS NULL AND status IN ('DRAFT','SCHEDULED','FAILED') RETURNING *`,
    [scheduledAt, user.id || null, id]
  );
  if (!result.rows[0]) throw new AppError("Communication not found.", 404, "COMMUNICATION_NOT_FOUND");
  await recordActivity({ actorUserId: user.id, entityType: "communication", entityId: id, action: "communication_scheduled", summary: `Communication scheduled for ${scheduledAt}` });
  return result.rows[0];
}

export async function cancelCommunication(id) {
  const result = await query(
    "UPDATE communications SET status='CANCELLED', updated_at=now() WHERE id=$1 AND deleted_at IS NULL AND status IN ('DRAFT','SCHEDULED','FAILED') RETURNING *",
    [id]
  );
  if (!result.rows[0]) throw new AppError("Communication not found or cannot be cancelled.", 404, "COMMUNICATION_NOT_FOUND");
  return result.rows[0];
}

export async function retryCommunication(id, user = {}) {
  const result = await query(
    "SELECT id FROM communications WHERE id=$1 AND deleted_at IS NULL AND status='FAILED'",
    [id]
  );
  if (!result.rows[0]) throw new AppError("Failed communication not found.", 404, "COMMUNICATION_NOT_FOUND");
  return sendCommunication(id, user);
}

export async function createEmailTemplate(input = {}, user = {}) {
  validateTemplateIdentity(input,true);
  const subject = input.subject_template || input.subject || input.name || "Untitled template";
  const body = input.body_template || input.body || "";
  const variables = validateTemplate(body, subject);
  const result = await query(
    `INSERT INTO email_templates (
       template_key, key, name, category, subject, body, variables, active, transactional,
       template_type, channel, status, subject_template, body_template, text_template, default_send_mode,
       description, created_by, updated_by
     ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$4,$5,$12,$13,$14,$15,$15)
     RETURNING *`,
    [
      input.key || input.template_key,
      input.name,
      input.category || "SALES",
      subject,
      body,
      variables,
      input.active ?? true,
      input.transactional ?? true,
      input.template_type || "EMAIL",
      input.channel || "EMAIL",
      input.status || "DRAFT",
      input.text_template || body,
      input.default_send_mode || "CREATE_DRAFT",
      input.description || null,
      user.id || null
    ]
  );
  return result.rows[0];
}

export async function duplicateEmailTemplate(id, user = {}) {
  const original = (await query("SELECT * FROM email_templates WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  if (!original) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
  return createEmailTemplate({
    key: `${original.key || original.template_key}_copy_${Date.now()}`,
    name: `${original.name} Copy`,
    category: original.category,
    subject_template: original.subject_template || original.subject,
    body_template: original.body_template || original.body,
    text_template: original.text_template,
    transactional: original.transactional,
    template_type: original.template_type,
    channel: original.channel,
    status: "DRAFT",
    default_send_mode: original.default_send_mode,
    description: original.description
  }, user);
}

export async function setTemplateStatus(id, status, user = {}) {
  const result = await query(
    `UPDATE email_templates
     SET status=$1, active=$2, archived_at=CASE WHEN $1='ARCHIVED' THEN now() ELSE archived_at END,
         updated_by=$3, updated_at=now()
     WHERE id=$4 AND deleted_at IS NULL RETURNING *`,
    [status, status === "ACTIVE", user.id || null, id]
  );
  if (!result.rows[0]) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
  return result.rows[0];
}

export async function listAutomations() {
  const [automations, jobs, runs] = await Promise.all([
    query("SELECT * FROM automations WHERE deleted_at IS NULL ORDER BY enabled DESC, trigger_key, name"),
    query("SELECT * FROM automation_jobs ORDER BY scheduled_for DESC LIMIT 75"),
    query("SELECT ar.*, a.name AS automation_name FROM automation_runs ar LEFT JOIN automations a ON a.id=ar.automation_id ORDER BY ar.created_at DESC LIMIT 75")
  ]);
  return { data: automations.rows, jobs: jobs.rows, runs: runs.rows };
}

export async function updateAutomation(id, body) {
  if(body.name!==undefined&&!String(body.name).trim())throw new AppError('Rule name is required.',422,'AUTOMATION_INVALID');
  if(body.delay_amount!==undefined&&(!Number.isInteger(Number(body.delay_amount))||Number(body.delay_amount)<0||Number(body.delay_amount)>365))throw new AppError('Delay must be an integer from 0 to 365.',422,'AUTOMATION_INVALID');
  if(body.delay_unit!==undefined&&!['MINUTES','HOURS','DAYS'].includes(body.delay_unit))throw new AppError('Invalid delay unit.',422,'AUTOMATION_INVALID');
  if(body.enabled!==undefined&&typeof body.enabled!=='boolean')throw new AppError('Enabled must be true or false.',422,'AUTOMATION_INVALID');
  const allowed = ["name", "trigger_key", "conditions", "action_type", "action_config", "delay_amount", "delay_unit", "send_window", "enabled"];
  const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  const fields = Object.keys(patch);
  if (!fields.length) throw new AppError("No supported automation fields supplied.", 400, "NO_FIELDS");
  const values = fields.map((field) => patch[field]);
  values.push(id);
  const result = await query(
    `UPDATE automations SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=now()
     WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *`,
    values
  );
  return result.rows[0];
}

function conditionsMatch(conditions = {}, payload = {}) {
  if (conditions.source && String(payload.source || "").toUpperCase() !== String(conditions.source).toUpperCase()) return false;
  if (Array.isArray(conditions.source_in) && !conditions.source_in.map((item) => String(item).toUpperCase()).includes(String(payload.source || "").toUpperCase())) return false;
  if (conditions.requires_review_url && !payload.review_url) return false;
  return true;
}

function scheduledFor(automation) {
  const amount = Number(automation.delay_amount || 0);
  const multipliers = { MINUTES: 60000, HOURS: 3600000, DAYS: 86400000 };
  return new Date(Date.now() + amount * (multipliers[automation.delay_unit] || 60000));
}

export async function triggerAutomations({ triggerKey, entityType, entityId, payload = {} }) {
  const automations = await query("SELECT * FROM automations WHERE trigger_key=$1 AND enabled=true AND deleted_at IS NULL", [triggerKey]);
  const jobs = [];
  for (const automation of automations.rows) {
    if (!conditionsMatch(automation.conditions, payload)) continue;
    // Public-form service exclusively owns immediate website acknowledgments.
    if(triggerKey==="LEAD_CREATED" && payload.source==="WEBSITE" && /ACKNOWLEDG|INQUIRY.*ACK/i.test(automation.action_config?.template_key||""))continue;
    const inserted = await query(
      `INSERT INTO automation_jobs (automation_id, job_type, related_entity_type, related_entity_id, payload, scheduled_for, status)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING') RETURNING *`,
      [automation.id, automation.action_type, entityType, entityId, payload, scheduledFor(automation)]
    );
    jobs.push(inserted.rows[0]);
  }
  return jobs;
}

async function mergeDataForEntity(client, type, id, payload = {}) {
  const settings = (await client.query("SELECT business_email, phone, google_review_url, facebook_review_url, other_review_url FROM business_settings LIMIT 1")).rows[0] || {};
  if (type === "lead") {
    const lead = (await client.query("SELECT * FROM leads WHERE id=$1", [id])).rows[0] || {};
    const clientName = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
    return {
      ...payload,
      first_name: lead.first_name,
      client_name: clientName,
      event_type: lead.event_type,
      event_date: lead.event_date,
      venue: lead.venue_name,
      business_email: settings.business_email,
      business_phone: settings.phone,
      review_url: settings.google_review_url || settings.facebook_review_url || settings.other_review_url,
      client: {
        ...(payload.client || {}),
        first_name: lead.first_name,
        last_name: lead.last_name,
        name: clientName,
        email: lead.email,
        phone: lead.phone
      },
      lead: {
        ...(payload.lead || {}),
        id: lead.id,
        source: lead.lead_source || lead.provider,
        duplicate_of_id: lead.duplicate_of_lead_id
      },
      event: {
        ...(payload.event || {}),
        type: lead.event_type,
        date: lead.event_date,
        venue: lead.venue_name
      },
      business: {
        ...(payload.business || {}),
        email: settings.business_email,
        phone: settings.phone,
        review_url: settings.google_review_url || settings.facebook_review_url || settings.other_review_url
      }
    };
  }
  return {
    ...sampleMergeData(),
    ...payload,
    business_email: settings.business_email,
    business_phone: settings.phone,
    business: {
      ...(sampleMergeData().business || {}),
      ...(payload.business || {}),
      email: settings.business_email,
      phone: settings.phone,
      review_url: settings.google_review_url || settings.facebook_review_url || settings.other_review_url
    }
  };
}

async function emailTargetForEntity(client, type, id) {
  if (type === "lead") return (await client.query("SELECT email FROM leads WHERE id=$1", [id])).rows[0]?.email;
  if (type === "client") return (await client.query("SELECT email FROM clients WHERE id=$1", [id])).rows[0]?.email;
  return null;
}

async function recoverStaleProcessingJobs(client) {
  await client.query(
    `UPDATE automation_jobs
     SET status=CASE WHEN attempt_count >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
         scheduled_for=CASE WHEN attempt_count >= max_attempts THEN scheduled_for ELSE now() END,
         started_at=NULL,
         last_error=COALESCE(last_error, 'Recovered stale processing job after worker restart.'),
         updated_at=now()
     WHERE status='PROCESSING'
       AND started_at IS NOT NULL
       AND started_at < now() - ($1::int * interval '1 minute')`,
    [staleProcessingMinutes]
  );
  await client.query(
    `UPDATE communications
     SET status='SCHEDULED',
         failure_message=COALESCE(failure_message, 'Recovered stale scheduled communication after worker restart.'),
         updated_at=now()
     WHERE status='PROCESSING'
       AND send_mode='SCHEDULED'
       AND updated_at < now() - ($1::int * interval '1 minute')`,
    [staleProcessingMinutes]
  );
}

async function automationStopConditionMet(client, job) {
  const cancelStatuses = job.action_config?.cancel_statuses || [];
  if (job.related_entity_type === "proposal") {
    const row = (await client.query("SELECT status FROM proposals WHERE id=$1", [job.related_entity_id])).rows[0];
    return ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED", ...cancelStatuses].includes(row?.status);
  }
  if (job.related_entity_type === "invoice") {
    const row = (await client.query("SELECT status, balance_due, amount_outstanding FROM invoices WHERE id=$1", [job.related_entity_id])).rows[0];
    return ["VOID", "CANCELLED", ...cancelStatuses].includes(row?.status) || Number(row?.amount_outstanding ?? row?.balance_due ?? 0) <= 0;
  }
  if (job.related_entity_type === "event") {
    const row = (await client.query("SELECT status, gallery_status FROM events WHERE id=$1", [job.related_entity_id])).rows[0];
    return ["CANCELLED", "POSTPONED", "COMPLETED", "ARCHIVED", "REVOKED", ...cancelStatuses].includes(row?.status) ||
      ["ARCHIVED", "REVOKED", ...cancelStatuses].includes(row?.gallery_status);
  }
  if (job.related_entity_type === "creative_approval") {
    const row = (await client.query("SELECT status FROM creative_approvals WHERE id=$1", [job.related_entity_id])).rows[0];
    return ["APPROVED", "CANCELLED", "SUPERSEDED", ...cancelStatuses].includes(row?.status);
  }
  return false;
}

async function sendTemplateEmailJob(client, job) {
  const templateKey = job.action_config?.template_key;
  const template = templateKey ? (await client.query("SELECT * FROM email_templates WHERE (template_key=$1 OR key=$1) AND active=true AND status='ACTIVE' AND deleted_at IS NULL AND archived_at IS NULL", [templateKey])).rows[0] : null;
  if (!template) throw new AppError("Active email template not found.", 422, "EMAIL_TEMPLATE_NOT_FOUND", { retryable: false });
  const mergeData = await mergeDataForEntity(client, job.related_entity_type, job.related_entity_id, job.payload);
  const to = await emailTargetForEntity(client, job.related_entity_type, job.related_entity_id);
  if (!to) throw new AppError("No recipient email available.", 422, "EMAIL_RECIPIENT_NOT_FOUND", { retryable: false });
  const subject = renderTemplate(template.subject_template || template.subject, mergeData);
  const body = renderTemplate(template.body_template || template.body, mergeData);
  const sendMode = job.action_config?.send_mode || template.default_send_mode || "AUTOMATIC";
  if (sendMode === "REVIEW_BEFORE_SEND") return createDraftJob(client, { ...job, payload: { ...job.payload, template_key: template.key || template.template_key } });
  if (sendMode === "MANUAL") return { skipped: true, reason: "Template send mode is MANUAL." };
  if (sendMode === "SCHEDULED") return scheduleCommunicationJob(client, { ...job, payload: { ...job.payload, template_key: template.key || template.template_key } });
  return sendAndRecordEmail(client, job, { to, subject, body, template, mergeData });
}

async function sendPlainEmailJob(client, job) {
  const mergeData = await mergeDataForEntity(client, job.related_entity_type, job.related_entity_id, job.payload);
  const to = job.payload?.to || await emailTargetForEntity(client, job.related_entity_type, job.related_entity_id);
  const subject = job.payload?.subject ? renderTemplate(job.payload.subject, mergeData) : "";
  const body = job.payload?.body ? renderTemplate(job.payload.body, mergeData) : "";
  if (!to) throw new AppError("No recipient email available.", 422, "EMAIL_RECIPIENT_NOT_FOUND", { retryable: false });
  if (!subject || !body) throw new AppError("SEND_EMAIL jobs require payload.subject and payload.body.", 422, "EMAIL_CONTENT_REQUIRED", { retryable: false });
  return sendAndRecordEmail(client, job, { to, subject, body, mergeData });
}

async function createDraftJob(client, job) {
  const templateKey = job.action_config?.template_key || job.payload?.template_key;
  const template = templateKey ? (await client.query("SELECT * FROM email_templates WHERE (template_key=$1 OR key=$1) AND deleted_at IS NULL AND archived_at IS NULL", [templateKey])).rows[0] : null;
  const mergeData = await mergeDataForEntity(client, job.related_entity_type, job.related_entity_id, job.payload);
  const to = job.payload?.to || await emailTargetForEntity(client, job.related_entity_type, job.related_entity_id);
  const subject = template ? renderTemplate(template.subject_template || template.subject, mergeData) : renderTemplate(job.payload?.subject || "", mergeData);
  const body = template ? renderTemplate(template.body_template || template.body, mergeData) : renderTemplate(job.payload?.body || "", mergeData);
  const result = await client.query(
    `INSERT INTO communications (
       lead_id, client_id, type, channel, direction, subject, rendered_subject, message_summary, rendered_body, rendered_html,
       recipient, template_id, template_key, template_version, merge_data, send_mode, status, trigger_key
     ) VALUES ($1,$2,'EMAIL','EMAIL','OUTBOUND',$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CREATE_DRAFT','DRAFT',$12) RETURNING *`,
    [
      job.related_entity_type === "lead" ? job.related_entity_id : null,
      job.related_entity_type === "client" ? job.related_entity_id : null,
      subject,
      body.slice(0, 500),
      body,
      brandedEmailHtml(body),
      to || "",
      template?.id || null,
      template?.key || template?.template_key || templateKey || null,
      template?.version || null,
      mergeData,
      job.job_type
    ]
  );
  return { communication: result.rows[0] };
}

async function scheduleCommunicationJob(client, job) {
  const draft = await createDraftJob(client, job);
  const result = await client.query(
    "UPDATE communications SET status='SCHEDULED', send_mode='SCHEDULED', scheduled_at=$1, updated_at=now() WHERE id=$2 RETURNING *",
    [job.scheduled_for, draft.communication.id]
  );
  return { communication: result.rows[0] };
}

async function sendAndRecordEmail(client, job, { to, subject, body, template = null, mergeData = {} }) {
  const html = brandedEmailHtml(body);
  const delivery = await sendEmail({ to, subject, body, html });
  const communication = await client.query(
    `INSERT INTO communications (
       lead_id, client_id, type, channel, direction, subject, rendered_subject, message_summary, rendered_body, rendered_html,
       recipient, template_id, template_key, template_version, merge_data, send_mode, status, trigger_key,
       sent_at, provider, provider_message_id
     )
     VALUES ($1,$2,'EMAIL','EMAIL','OUTBOUND',$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SEND_NOW','SENT_TO_PROVIDER',$12,now(),$13,$14)
     RETURNING *`,
    [
      job.related_entity_type === "lead" ? job.related_entity_id : null,
      job.related_entity_type === "client" ? job.related_entity_id : null,
      subject,
      body.slice(0, 500),
      body,
      html,
      to,
      template?.id || null,
      template?.key || template?.template_key || job.action_config?.template_key || null,
      template?.version || null,
      mergeData,
      job.job_type,
      delivery.provider,
      delivery.providerMessageId
    ]
  );
  await client.query(
    `INSERT INTO email_messages (communication_id, provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
    [communication.rows[0].id, delivery.provider, delivery.providerMessageId, to, subject, delivery.status, body.slice(0, 500)]
  );
  return delivery;
}

async function executeAutomationJob(client, job) {
  const classification = classifyAutomationJobType(job.job_type);
  if (classification !== "IMPLEMENTED") throw unsupportedAutomationJobError(job.job_type);
  if (job.job_type === "SEND_EMAIL_TEMPLATE") return sendTemplateEmailJob(client, job);
  if (job.job_type === "SEND_EMAIL") return sendPlainEmailJob(client, job);
  if (job.job_type === "CREATE_DRAFT_EMAIL") return createDraftJob(client, job);
  if (job.job_type === "SCHEDULE_COMMUNICATION") return scheduleCommunicationJob(client, job);
  throw unsupportedAutomationJobError(job.job_type);
}

export async function processDueJobs({ limit = 25 } = {}) {
  const processed = [];
  await transaction(async (client) => {
    await recoverStaleProcessingJobs(client);
    const jobs = await client.query(
      `SELECT j.*, a.action_config, a.name AS automation_name
       FROM automation_jobs j
       LEFT JOIN automations a ON a.id=j.automation_id
       WHERE j.status='PENDING' AND j.scheduled_for <= now()
       ORDER BY j.scheduled_for LIMIT $1 FOR UPDATE OF j SKIP LOCKED`,
      [limit]
    );
    for (const job of jobs.rows) {
      await client.query("UPDATE automation_jobs SET status='PROCESSING', started_at=now(), attempt_count=attempt_count+1 WHERE id=$1", [job.id]);
      try {
        if (await automationStopConditionMet(client, job)) {
          await client.query("UPDATE automation_jobs SET status='CANCELLED', completed_at=now(), last_error='Stopped by current entity state', updated_at=now() WHERE id=$1", [job.id]);
          await client.query("INSERT INTO automation_runs (automation_id, automation_job_id, trigger_key, entity_type, entity_id, scheduled_for, executed_at, result, error) VALUES ($1,$2,$3,$4,$5,$6,now(),'CANCELLED',$7)", [job.automation_id, job.id, job.job_type, job.related_entity_type, job.related_entity_id, job.scheduled_for, "Stopped by current entity state"]);
          processed.push({ id: job.id, status: "CANCELLED", stopped: true });
          continue;
        }
        await executeAutomationJob(client, job);
        await client.query("UPDATE automation_jobs SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1", [job.id]);
        await client.query("INSERT INTO automation_runs (automation_id, automation_job_id, trigger_key, entity_type, entity_id, scheduled_for, executed_at, result) VALUES ($1,$2,$3,$4,$5,$6,now(),'COMPLETED')", [job.automation_id, job.id, job.job_type, job.related_entity_type, job.related_entity_id, job.scheduled_for]);
        processed.push({ id: job.id, status: "COMPLETED" });
      } catch (error) {
        const canRetry = error.details?.retryable !== false;
        const status = !canRetry || job.attempt_count + 1 >= job.max_attempts ? "FAILED" : "PENDING";
        const retryAfterSeconds = Number(error.details?.retryAfter || 0);
        const delayMinutes = retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds / 60) : Math.min(60, 2 ** Number(job.attempt_count || 0));
        const nextRun = new Date(Date.now() + delayMinutes * 60000);
        await client.query("UPDATE automation_jobs SET status=$1, scheduled_for=$2, last_error=$3, updated_at=now() WHERE id=$4", [status, nextRun, error.message, job.id]);
        await client.query("INSERT INTO automation_runs (automation_id, automation_job_id, trigger_key, entity_type, entity_id, scheduled_for, executed_at, result, error) VALUES ($1,$2,$3,$4,$5,$6,now(),'FAILED',$7)", [job.automation_id, job.id, job.job_type, job.related_entity_type, job.related_entity_id, job.scheduled_for, error.message]);
        processed.push({ id: job.id, status, error: error.message });
      }
    }
  });
  const scheduled = await transaction(async (client) => {
    // A crash after claiming cannot silently strand a message. An unknown external
    // outcome requires operator review rather than an automatic duplicate send.
    await client.query("UPDATE communications SET status='FAILED',failed_at=now(),failure_code='DELIVERY_OUTCOME_UNKNOWN',failure_message='Worker stopped during send. Check provider history before retrying.' WHERE status='PROCESSING' AND updated_at<now()-interval '5 minutes'");
    const due = await client.query(
      `SELECT id FROM communications
       WHERE status='SCHEDULED' AND channel='EMAIL' AND scheduled_at <= now() AND deleted_at IS NULL
       ORDER BY scheduled_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    if (!due.rows.length) return [];
    await client.query(
      "UPDATE communications SET status='PROCESSING', queued_at=COALESCE(queued_at, now()), updated_at=now() WHERE id=ANY($1::uuid[])",
      [due.rows.map((row) => row.id)]
    );
    return due.rows;
  });
  for (const communication of scheduled) {
    try {
      const sent = await sendCommunication(communication.id, {}, { workerClaim: true });
      processed.push({ id: communication.id, status: sent.communication.status, type: "SCHEDULED_COMMUNICATION" });
    } catch (error) {
      await query(
        `UPDATE communications
         SET status='FAILED', failed_at=now(), failure_code=$1, failure_message=$2, updated_at=now()
         WHERE id=$3`,
        [error.code || "SCHEDULED_SEND_FAILED", error.message, communication.id]
      );
      processed.push({ id: communication.id, status: "FAILED", type: "SCHEDULED_COMMUNICATION", error: error.message });
    }
  }
  return { processed };
}

export async function cancelJobsForEntity({ entityType, entityId, reason }) {
  const result = await query(
    `UPDATE automation_jobs SET status='CANCELLED', last_error=$1, updated_at=now()
     WHERE related_entity_type=$2 AND related_entity_id=$3 AND status='PENDING'
     RETURNING *`,
    [reason || "Cancelled by state change", entityType, entityId]
  );
  return result.rows;
}
