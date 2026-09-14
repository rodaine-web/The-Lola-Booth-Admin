import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/018_phase_13b_template_communications_completion.sql", import.meta.url), "utf8");
const automationService = fs.readFileSync(new URL("../server/src/services/automation-service.js", import.meta.url), "utf8");
const approvalService = fs.readFileSync(new URL("../server/src/services/creative-approval-service.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");
const communicationsPage = fs.readFileSync(new URL("../src/pages/Communications.jsx", import.meta.url), "utf8");
const proposalService = fs.readFileSync(new URL("../server/src/services/proposal-service.js", import.meta.url), "utf8");
const invoiceService = fs.readFileSync(new URL("../server/src/services/invoice-service.js", import.meta.url), "utf8");
const systemHealth = fs.readFileSync(new URL("../server/src/services/system-health-service.js", import.meta.url), "utf8");

test("phase 13B migration adds template history, rendered subject snapshots, document templates, and granular permissions", () => {
  for (const token of [
    "rendered_subject",
    "CREATE TABLE IF NOT EXISTS communication_template_versions",
    "proposal_document_templates",
    "invoice_document_templates",
    "document_template_key",
    "editable_sections",
    "corporate_billing",
    "templates.view",
    "communications.send",
    "approvals.manage"
  ]) {
    assert.match(migration, new RegExp(token));
  }
});

test("phase 13B seeds business proposal, invoice, and creative approval templates", () => {
  for (const key of [
    "standard_event_proposal",
    "wedding_proposal",
    "corporate_event_proposal",
    "custom_brand_activation_proposal",
    "custom_experience_proposal",
    "standard_invoice",
    "corporate_invoice",
    "brand_activation_invoice",
    "creative_proof_ready",
    "creative_revision_requested",
    "production_approval",
    "brand_assets_requested"
  ]) {
    assert.match(migration, new RegExp(key));
  }
});

test("template admin supports version history, immutable keys, variable catalog, unresolved preview, and send modes", () => {
  assert.match(automationService, /templateVariableCatalog/);
  assert.match(automationService, /communication_template_versions/);
  assert.match(automationService, /TEMPLATE_KEY_IMMUTABLE/);
  assert.match(automationService, /unresolvedVariables/);
  assert.match(automationService, /canSend/);
  assert.match(automationService, /REVIEW_BEFORE_SEND/);
  assert.match(automationService, /MANUAL/);
  assert.match(automationService, /SCHEDULED/);
  assert.match(automationService, /SMS_PROVIDER_DISABLED/);
});

test("admin and public routes expose Phase 13B workflows with granular RBAC", () => {
  for (const token of [
    'requireAnyPermission("templates.view"',
    'requireAnyPermission("templates.manage"',
    'requireAnyPermission("communications.send"',
    'requireAnyPermission("communications.schedule"',
    'requireAnyPermission("communications.retry"',
    'requireAnyPermission("automations.manage"',
    'requireAnyPermission("approvals.manage"',
    "/creative-approvals/:id/revisions",
    "/creative-approvals/:id/send"
  ]) {
    assert.match(adminRoutes, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(publicRoutes, /\/approvals\/:token/);
  assert.match(publicRoutes, /respondToCreativeApproval/);
});

test("communications UI includes business-user template manager, editor, picker, preview, composer, and automation UX", () => {
  for (const token of [
    "Templates",
    "Automations",
    "Template Editor",
    "Available Variables",
    "Preview With Sample Data",
    "Unresolved:",
    "Composer",
    "Send Now",
    "Schedule",
    "character",
    "Default Send Mode"
  ]) {
    assert.match(communicationsPage, new RegExp(token));
  }
});

test("proposal and invoice documents are template-scaffolded while financial math stays in services", () => {
  assert.match(proposalService, /proposal_document_templates/);
  assert.match(proposalService, /buildEditableProposalSections/);
  assert.match(proposalService, /Activation Objective/);
  assert.match(invoiceService, /document_template_key/);
  assert.match(invoiceService, /corporate_billing/);
  assert.match(invoiceService, /calculateInvoiceTotals/);
});

test("legacy delivery fallbacks warn and communication readiness is surfaced in system health", () => {
  assert.match(proposalService, /recordTemplateFallback/);
  assert.match(invoiceService, /recordTemplateFallback/);
  assert.match(systemHealth, /communicationReadinessCheck/);
  assert.match(systemHealth, /stale_scheduled/);
});

test("creative approval service preserves versioned snapshots and public token responses", () => {
  for (const token of [
    "creative_approval_revisions",
    "approval_snapshot",
    "PENDING_APPROVAL",
    "VIEWED",
    "CHANGES_REQUESTED",
    "APPROVED",
    "publicCreativeApproval",
    "respondToCreativeApproval",
    "approval_approved",
    "approval_changes_requested"
  ]) {
    assert.match(approvalService, new RegExp(token));
  }
});
