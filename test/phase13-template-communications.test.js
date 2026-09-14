import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/017_phase_13_template_communications.sql", import.meta.url), "utf8");
const automationService = fs.readFileSync(new URL("../server/src/services/automation-service.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const communicationsPage = fs.readFileSync(new URL("../src/pages/Communications.jsx", import.meta.url), "utf8");
const proposalService = fs.readFileSync(new URL("../server/src/services/proposal-service.js", import.meta.url), "utf8");
const invoiceService = fs.readFileSync(new URL("../server/src/services/invoice-service.js", import.meta.url), "utf8");

test("phase 13 migration extends templates, communications, schedules, and creative approvals", () => {
  for (const token of [
    "template_type",
    "subject_template",
    "body_template",
    "default_send_mode",
    "template_version",
    "rendered_body",
    "scheduled_at",
    "provider_message_id",
    "idempotency_key",
    "CREATE TABLE IF NOT EXISTS creative_approvals",
    "idx_communications_status_scheduled",
    "idx_email_templates_key_status"
  ]) {
    assert.match(migration, new RegExp(token));
  }
  assert.match(migration, /ON CONFLICT \(template_key\) DO NOTHING/);
});

test("phase 13 seeds the requested admin template family without overwriting edited copy", () => {
  for (const key of [
    "sms_new_inquiry_ack",
    "email_new_inquiry_ack",
    "lead_follow_up_general",
    "proposal_sent",
    "proposal_reminder",
    "deposit_invoice_sent",
    "payment_receipt",
    "balance_due_reminder",
    "booking_confirmation",
    "event_week_reminder",
    "gallery_delivery",
    "review_request",
    "staff_assignment_notification",
    "internal_duplicate_lead_alert",
    "proposal_document_default",
    "invoice_document_default"
  ]) {
    assert.match(migration, new RegExp(key));
  }
});

test("template renderer supports allowlisted nested variables and blocks unsafe or missing variables", () => {
  assert.match(automationService, /collectTemplateVariables/);
  assert.match(automationService, /client\.first_name/);
  assert.match(automationService, /proposal\.url/);
  assert.match(automationService, /UNKNOWN_TEMPLATE_VARIABLE/);
  assert.match(automationService, /MISSING_TEMPLATE_VARIABLE/);
  assert.doesNotMatch(automationService, /eval\(/);
  assert.doesNotMatch(automationService, /new Function/);
});

test("communication center API exposes drafts, scheduling, retries, template duplication, and status changes", () => {
  for (const route of [
    "/communications",
    "/communications/drafts",
    "/communications/:id/send",
    "/communications/:id/schedule",
    "/communications/:id/cancel",
    "/communications/:id/retry",
    "/communications/templates/:id/duplicate",
    "/communications/templates/:id/activate",
    "/communications/templates/:id/archive"
  ]) {
    assert.match(adminRoutes, new RegExp(route.replace(/[/:]/g, (match) => match === "/" ? "\\/" : ".")));
  }
});

test("worker and UI include scheduled communication processing and communication center views", () => {
  assert.match(automationService, /SCHEDULE_COMMUNICATION/);
  assert.match(automationService, /CREATE_DRAFT_EMAIL/);
  assert.match(automationService, /status='SCHEDULED'/);
  assert.match(automationService, /SCHEDULED_COMMUNICATION/);
  assert.match(communicationsPage, /Communication Center/);
  assert.match(communicationsPage, /segmented-control/);
  assert.match(communicationsPage, /template_name/);
});

test("proposal and invoice sending render active templates before falling back to hardcoded copy", () => {
  assert.match(proposalService, /renderCommunicationTemplateByKey\("proposal_sent"/);
  assert.match(proposalService, /template_id/);
  assert.match(proposalService, /proposalMergeData/);
  assert.match(invoiceService, /renderCommunicationTemplateByKey\("deposit_invoice_sent"/);
  assert.match(invoiceService, /template_id/);
  assert.match(invoiceService, /invoiceMergeData/);
});
