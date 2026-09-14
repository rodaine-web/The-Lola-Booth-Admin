import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/019_phase_13c_production_communication_hardening.sql", import.meta.url), "utf8");
const automationService = fs.readFileSync(new URL("../server/src/services/automation-service.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../server/src/worker.js", import.meta.url), "utf8");
const health = fs.readFileSync(new URL("../server/src/services/system-health-service.js", import.meta.url), "utf8");
const fieldOps = fs.readFileSync(new URL("../server/src/services/field-operations-service.js", import.meta.url), "utf8");
const publicForm = fs.readFileSync(new URL("../server/src/services/public-form-email-service.js", import.meta.url), "utf8");
const notifications = fs.readFileSync(new URL("../server/src/services/notification-service.js", import.meta.url), "utf8");
const coverage = fs.readFileSync(new URL("../docs/LOLA_PHASE_13C_COMMUNICATION_COVERAGE.md", import.meta.url), "utf8");

test("phase 13C migration adds worker processing metadata, fallback events, SMS consent, and business templates", () => {
  for (const token of [
    "last_successful_communication_processing_at",
    "last_failed_communication_processing_at",
    "communication_fallback_events",
    "sms_consent_status",
    "sms_opted_out_at",
    "staff_brief_email",
    "gallery_delivery_email",
    "public_inquiry_owner_notification",
    "public_inquiry_customer_confirmation",
    "notification_email_default"
  ]) {
    assert.match(migration, new RegExp(token));
  }
});

test("existing worker automatically processes scheduled communications with heartbeat result metadata", () => {
  assert.match(worker, /setInterval\(tick, 30000\)/);
  assert.match(worker, /processDueJobs/);
  assert.match(worker, /recordWorkerProcessingResult/);
  assert.match(automationService, /FOR UPDATE SKIP LOCKED/);
  assert.match(automationService, /status='PROCESSING'/);
  assert.match(automationService, /Recovered stale scheduled communication/);
  assert.match(health, /last_successful_communication_processing_at/);
  assert.match(health, /last_failed_communication_processing_at/);
});

test("duplicate send protection and delivery status avoid false delivered claims", () => {
  assert.match(automationService, /Duplicate communication send prevented/);
  assert.match(automationService, /SENT_TO_PROVIDER/);
  assert.doesNotMatch(automationService, /status='DELIVERED'/);
  assert.match(automationService, /idempotency_key=COALESCE/);
});

test("SMS readiness and consent remain safe while provider is disabled", () => {
  assert.match(automationService, /smsProviderStatus/);
  assert.match(automationService, /NOT_CONFIGURED/);
  assert.match(automationService, /DISABLED/);
  assert.match(automationService, /assertSmsConsent/);
  assert.match(automationService, /SMS_MARKETING_CONSENT_REQUIRED/);
  assert.match(automationService, /SMS_RECIPIENT_OPTED_OUT/);
  assert.match(automationService, /SMS_PROVIDER_DISABLED/);
});

test("automation stop conditions cover proposals, invoices, events, gallery state, and creative approvals", () => {
  assert.match(automationService, /automationStopConditionMet/);
  for (const token of ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED", "balance_due", "amount_outstanding", "POSTPONED", "COMPLETED", "ARCHIVED", "REVOKED", "SUPERSEDED"]) {
    assert.match(automationService, new RegExp(token));
  }
});

test("remaining business emails render through centralized templates with fallback events", () => {
  assert.match(fieldOps, /renderBusinessTemplate\("staff_brief_email"/);
  assert.match(fieldOps, /renderBusinessTemplate\("gallery_delivery_email"/);
  assert.match(fieldOps, /renderCommunicationTemplateByKey\(templateKey/);
  assert.match(publicForm, /renderPublicInquiryTemplate\("public_inquiry_owner_notification"/);
  assert.match(publicForm, /renderPublicInquiryTemplate\("public_inquiry_customer_confirmation"/);
  assert.match(publicForm, /renderCommunicationTemplateByKey\(templateKey/);
  assert.match(notifications, /renderCommunicationTemplateByKey\(email\.templateKey \|\| "notification_email_default"/);
  assert.match(fieldOps, /recordTemplateFallback/);
  assert.match(publicForm, /recordTemplateFallback/);
});

test("system health includes worker, communications, fallback, and SMS readiness", () => {
  assert.match(health, /communicationReadinessCheck/);
  assert.match(health, /fallbackCheck/);
  assert.match(health, /smsProviderStatus/);
  assert.match(health, /STALE/);
  assert.match(health, /DOWN/);
});

test("coverage report documents final inventory, smoke steps, and SMS no-go", () => {
  assert.match(coverage, /Coverage Matrix/);
  assert.match(coverage, /Hardcoded Fallback/);
  assert.match(coverage, /Production Smoke Test/);
  assert.match(coverage, /GO with SMS disabled/);
  assert.match(coverage, /SMS remains \*\*NO-GO for live sending\*\*/);
});
