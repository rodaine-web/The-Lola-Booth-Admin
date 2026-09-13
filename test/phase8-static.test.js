import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/011_phase_8_social_leads_communications.sql", import.meta.url), "utf8");
const socialService = fs.readFileSync(new URL("../server/src/services/social-lead-service.js", import.meta.url), "utf8");
const automationService = fs.readFileSync(new URL("../server/src/services/automation-service.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");
const webhookRoutes = fs.readFileSync(new URL("../server/src/routes/webhooks.js", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const integrations = fs.readFileSync(new URL("../src/pages/Integrations.jsx", import.meta.url), "utf8");
const communications = fs.readFileSync(new URL("../src/pages/Communications.jsx", import.meta.url), "utf8");
const leads = fs.readFileSync(new URL("../src/pages/Leads.jsx", import.meta.url), "utf8");
const leadDetail = fs.readFileSync(new URL("../src/pages/LeadDetail.jsx", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../server/src/services/operational-intelligence-service.js", import.meta.url), "utf8");
const analytics = fs.readFileSync(new URL("../src/pages/Analytics.jsx", import.meta.url), "utf8");

test("phase 8 migration adds social lead, communications, automation, and job foundation", () => {
  for (const token of [
    "normalized_email", "normalized_phone", "external_lead_id", "duplicate_status",
    "CREATE TABLE IF NOT EXISTS lead_source_events",
    "CREATE TABLE IF NOT EXISTS email_templates",
    "CREATE TABLE IF NOT EXISTS automations",
    "CREATE TABLE IF NOT EXISTS automation_jobs",
    "CREATE TABLE IF NOT EXISTS automation_runs",
    "conversion_postbacks",
    "FAILED_NEEDS_REVIEW",
    "marketing_email_opt_in"
  ]) {
    assert.match(migration, new RegExp(token));
  }
  assert.match(migration, /idx_leads_provider_external/);
  assert.match(migration, /LINKEDIN', 'AWAITING_APPROVAL'/);
});

test("provider normalization and deduplication are shared across website and social leads", () => {
  for (const fn of ["normalizeWebsiteLead", "normalizeMetaLead", "normalizeTikTokLead", "normalizeLinkedInLead", "ingestProviderLead"]) {
    assert.match(socialService, new RegExp(`function ${fn}|${fn} =|export async function ${fn}|export function ${fn}`));
  }
  assert.match(socialService, /normalizeEmail/);
  assert.match(socialService, /normalizePhone/);
  assert.match(socialService, /IDEMPOTENT_REPLAY/);
  assert.match(socialService, /POSSIBLE_DUPLICATE/);
  assert.match(socialService, /fieldMapFor/);
  assert.match(socialService, /Lead requires email or phone/);
});

test("webhooks persist provider events and avoid fake provider support", () => {
  assert.match(webhookRoutes, /\/meta/);
  assert.match(webhookRoutes, /hub\.verify_token/);
  assert.match(webhookRoutes, /\/tiktok/);
  assert.match(webhookRoutes, /\/linkedin/);
  assert.match(socialService, /persistWebhookEvent/);
  assert.match(socialService, /LINKEDIN_AWAITING_APPROVAL/);
  assert.match(socialService, /Provider verification is required/);
});

test("website inquiry endpoint uses the Phase 8 ingestion pipeline with UTMs", () => {
  assert.match(publicRoutes, /ingestProviderLead/);
  assert.match(publicRoutes, /provider: "WEBSITE"/);
  assert.match(publicRoutes, /utm_campaign/);
  assert.match(publicRoutes, /inquiryStatus/);
  assert.doesNotMatch(publicRoutes, /leadId: lead\.id/);
});

test("website lead ingestion preserves booking relationship and venue fields", () => {
  for (const token of [
    "preferred_experience_id",
    "preferredExperienceId",
    "preferred_package_id",
    "preferredPackageId",
    "referral_source",
    "referralSource",
    "venue_address",
    "venueAddress",
    "event_end_time",
    "eventEndTime"
  ]) {
    assert.match(socialService, new RegExp(token));
  }
});

test("automation engine supports templates, durable jobs, retry, and safe variables", () => {
  for (const token of ["allowedTemplateVariables", "renderTemplate", "UNKNOWN_TEMPLATE_VARIABLE", "triggerAutomations", "processDueJobs", "automation_jobs", "attempt_count", "max_attempts", "cancelJobsForEntity", "sendEmail"]) {
    assert.match(automationService, new RegExp(token));
  }
  assert.match(migration, /NEW_INQUIRY_ACKNOWLEDGEMENT/);
  assert.match(migration, /PROPOSAL_REMINDER/);
  assert.match(migration, /BALANCE_REMINDER/);
  assert.match(migration, /REVIEW_REQUEST/);
});

test("admin API exposes integrations, mappings, failed inbound queue, templates, automations, and manual email", () => {
  for (const route of [
    "/integrations/overview",
    "/integrations/:provider/field-maps",
    "/integrations/:provider/test-lead",
    "/integrations/failed-inbound",
    "/communications/templates",
    "/communications/automations",
    "/communications/jobs/process",
    "/communications/send"
  ]) {
    assert.match(adminRoutes, new RegExp(route.replace(/[/:]/g, (match) => match === "/" ? "\\/" : ".")));
  }
  assert.match(adminRoutes, /sourceQualityAnalytics/);
  assert.match(adminRoutes, /LEAD_STATUS_CHANGED/);
});

test("frontend adds integrations and communications workflows without redesigning navigation", () => {
  assert.match(layout, /Communications/);
  assert.match(app, /<Communications \/>/);
  assert.match(integrations, /Lead Sources/);
  assert.match(integrations, /Failed inbound leads/);
  assert.match(integrations, /LinkedIn Lead Sync requires LinkedIn API approval/);
  assert.match(communications, /Email Templates/);
  assert.match(communications, /Automations/);
  assert.match(communications, /Process Due Jobs/);
});

test("lead UI shows source attribution, campaigns, duplicate state, and response SLA", () => {
  assert.match(leads, /All sources/);
  assert.match(leads, /Campaign/);
  assert.match(leadDetail, /Source Details/);
  assert.match(leadDetail, /Advanced raw IDs/);
  assert.match(leadDetail, /Response SLA/);
  assert.match(leadDetail, /friendlySource/);
});

test("dashboard and analytics include Phase 8 source quality signals", () => {
  assert.match(dashboard, /new_social_leads/);
  assert.match(dashboard, /leads_awaiting_response/);
  assert.match(dashboard, /average_first_response_time/);
  assert.match(dashboard, /failed_integration_events/);
  assert.match(adminRoutes, /campaignPerformance/);
  assert.match(analytics, /Lead Source Performance/);
});
