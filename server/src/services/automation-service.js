import { query, transaction } from "../db/pool.js";
import { AppError } from "../utils/errors.js";
import { sendEmail } from "./email-service.js";

export const allowedTemplateVariables = [
  "first_name", "client_name", "event_type", "event_date", "venue", "proposal_number",
  "proposal_url", "invoice_number", "invoice_url", "amount_due", "due_date",
  "remaining_balance", "gallery_url", "business_email", "business_phone", "review_url"
];

export function renderTemplate(text = "", data = {}) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (!allowedTemplateVariables.includes(key)) throw new AppError(`Unknown template variable: ${key}`, 422, "UNKNOWN_TEMPLATE_VARIABLE");
    return data[key] ?? "";
  });
}

export function validateTemplate(body = "", subject = "") {
  const variables = [...`${subject}\n${body}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
  const unknown = variables.filter((variable) => !allowedTemplateVariables.includes(variable));
  if (unknown.length) throw new AppError(`Unknown template variable: ${unknown.join(", ")}`, 422, "UNKNOWN_TEMPLATE_VARIABLE");
  return [...new Set(variables)];
}

export async function listEmailTemplates() {
  const result = await query("SELECT * FROM email_templates WHERE deleted_at IS NULL ORDER BY category, name");
  return { data: result.rows, variables: allowedTemplateVariables };
}

export async function updateEmailTemplate(id, body) {
  const allowed = ["name", "category", "subject", "body", "active", "transactional"];
  const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  if (patch.subject || patch.body) {
    const current = (await query("SELECT subject, body FROM email_templates WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
    if (!current) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
    patch.variables = validateTemplate(patch.body ?? current.body, patch.subject ?? current.subject);
  }
  const fields = Object.keys(patch);
  if (!fields.length) throw new AppError("No supported template fields supplied.", 400, "NO_FIELDS");
  const values = fields.map((field) => patch[field]);
  values.push(id);
  const result = await query(
    `UPDATE email_templates SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=now()
     WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function previewEmailTemplate(id, data = sampleMergeData()) {
  const template = (await query("SELECT * FROM email_templates WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  if (!template) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
  return {
    subject: renderTemplate(template.subject, data),
    body: renderTemplate(template.body, data),
    html: brandedEmailHtml(renderTemplate(template.body, data))
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
    review_url: "https://example.com/review"
  };
}

export function brandedEmailHtml(body) {
  return `<!doctype html><html><body style="margin:0;background:#FAF7F1;color:#1A1A1A;font-family:Montserrat,Arial,sans-serif"><main style="max-width:640px;margin:0 auto;background:#fff;padding:32px"><img src="/brand/LOLA_Horizontal_Dark_Transparent.png" alt="The LOLA Booth" style="width:180px;height:auto"><div style="white-space:pre-wrap;line-height:1.55;margin-top:28px">${body}</div><p style="color:#B89B6B;margin-top:30px">Good people. Better photos.</p></main></body></html>`;
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
    return {
      ...payload,
      first_name: lead.first_name,
      client_name: [lead.first_name, lead.last_name].filter(Boolean).join(" "),
      event_type: lead.event_type,
      event_date: lead.event_date,
      venue: lead.venue_name,
      business_email: settings.business_email,
      business_phone: settings.phone,
      review_url: settings.google_review_url || settings.facebook_review_url || settings.other_review_url
    };
  }
  return { ...sampleMergeData(), ...payload, business_email: settings.business_email, business_phone: settings.phone };
}

async function emailTargetForEntity(client, type, id) {
  if (type === "lead") return (await client.query("SELECT email FROM leads WHERE id=$1", [id])).rows[0]?.email;
  if (type === "client") return (await client.query("SELECT email FROM clients WHERE id=$1", [id])).rows[0]?.email;
  return null;
}

export async function processDueJobs({ limit = 25 } = {}) {
  const processed = [];
  await transaction(async (client) => {
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
        if (job.job_type === "SEND_EMAIL_TEMPLATE" || job.job_type === "SEND_EMAIL") {
          const templateKey = job.action_config?.template_key;
          const template = templateKey ? (await client.query("SELECT * FROM email_templates WHERE template_key=$1 AND active=true AND deleted_at IS NULL", [templateKey])).rows[0] : null;
          if (!template) throw new Error("Active email template not found.");
          const mergeData = await mergeDataForEntity(client, job.related_entity_type, job.related_entity_id, job.payload);
          const to = await emailTargetForEntity(client, job.related_entity_type, job.related_entity_id);
          if (!to) throw new Error("No recipient email available.");
          const subject = renderTemplate(template.subject, mergeData);
          const body = renderTemplate(template.body, mergeData);
          const delivery = await sendEmail({ to, subject, body });
          const communication = await client.query(
            `INSERT INTO communications (lead_id, client_id, type, direction, subject, message_summary)
             VALUES ($1,$2,'EMAIL','OUTBOUND',$3,$4) RETURNING *`,
            [job.related_entity_type === "lead" ? job.related_entity_id : null, job.related_entity_type === "client" ? job.related_entity_id : null, subject, body.slice(0, 500)]
          );
          await client.query(
            `INSERT INTO email_messages (communication_id, provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
            [communication.rows[0].id, delivery.provider, delivery.providerMessageId, to, subject, delivery.status, body.slice(0, 500)]
          );
        }
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
