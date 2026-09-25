import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(new URL("../server/migrations/020_customer_documents_iam_branding.sql", import.meta.url), "utf8");
const documentService = fs.readFileSync(new URL("../server/src/services/document-service.js", import.meta.url), "utf8");
const proposalService = fs.readFileSync(new URL("../server/src/services/proposal-service.js", import.meta.url), "utf8");
const invoiceService = fs.readFileSync(new URL("../server/src/services/invoice-service.js", import.meta.url), "utf8");
const automationService = fs.readFileSync(new URL("../server/src/services/automation-service.js", import.meta.url), "utf8");
const publicFormEmail = fs.readFileSync(new URL("../server/src/services/public-form-email-service.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const authRoutes = fs.readFileSync(new URL("../server/src/routes/auth.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");
const appRoutes = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const proposalEditor = fs.readFileSync(new URL("../src/pages/ProposalEditor.jsx", import.meta.url), "utf8");
const setupPasswordPage = fs.readFileSync(new URL("../src/pages/SetupPassword.jsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");
const report = fs.readFileSync(new URL("../docs/LOLA_CUSTOMER_DOCUMENTS_IAM_BRANDING_REPORT.md", import.meta.url), "utf8");

test("phase 14 customer document migration supports uploaded proposals, normalized templates, and IAM", () => {
  for (const fragment of [
    "proposal_source",
    "external_document_storage_key",
    "user_account_tokens",
    "SENT_TO_PROVIDER",
    "SUPER_ADMIN",
    "BOOKING_INQUIRY_CONFIRMATION",
    "CONTACT_CONFIRMATION",
    "PROPOSAL_DELIVERY",
    "INVOICE_DELIVERY",
    "PAYMENT_CONFIRMATION",
    "GENERIC"
  ]) {
    assert.match(migration, new RegExp(fragment));
  }
});

test("proposal workflow supports generated and uploaded modes with custom sections and shared lifecycle", () => {
  assert.match(proposalEditor, /Create in LOLA/);
  assert.match(proposalEditor, /Upload External Proposal/);
  assert.match(proposalEditor, /corporateSections/);
  assert.match(proposalEditor, /custom_line_items/);
  assert.match(proposalService, /createUploadedProposal/);
  assert.match(proposalService, /proposalPdfBuffer/);
  assert.match(publicRoutes, /proposalPdfBuffer\(proposal\)/);
  assert.match(adminRoutes, /\/proposals\/upload/);
});

test("documents and emails follow the screenshot-derived visual system and link-first URLs", () => {
  for (const fragment of ["thin gold outer border", "P R O P O S A L", "Proposal Overview", "CONTINUED LINE ITEMS", "PAYMENT INFORMATION", "QRCode.create", "publicUrl\\(\"pay\""]) {
    assert.match(documentService, new RegExp(fragment));
  }
  assert.match(automationService, /Events&nbsp;&nbsp; \| &nbsp;&nbsp;Brand Activations/);
  assert.match(automationService, /Follow Our Journey/);
  assert.match(automationService, /@thelolabooth/);
  assert.match(proposalService, /publicProposalUrl\(proposal\)/);
  assert.match(invoiceService, /publicInvoiceUrl\(invoice\)/);
  assert.doesNotMatch(automationService, /Facebook|Pinterest/);
});

test("manual communication and user management routes include RBAC protections", () => {
  assert.match(adminRoutes, /communications\.compose/);
  assert.match(adminRoutes, /template_key: "GENERIC"/);
  assert.match(adminRoutes, /assertAssignableRoles/);
  assert.match(adminRoutes, /OWNER_ESCALATION_BLOCKED/);
  assert.match(adminRoutes, /ROOT_ROLE_BLOCKED/);
  assert.match(adminRoutes, /\/users\/:id\/password-reset/);
  assert.match(adminRoutes, /\/users\/:id\/reactivate/);
  assert.match(adminRoutes, /\/users\/:id\/resend-invitation/);
  assert.match(authRoutes, /\/setup-password/);
  assert.match(authRoutes, /used_at IS NULL/);
  assert.match(authRoutes, /expires_at > now\(\)/);
  assert.match(authRoutes, /UPDATE user_account_tokens SET used_at=now\(\)/);
  assert.match(appRoutes, /path="\/setup-password"/);
  assert.match(setupPasswordPage, /Set password/);
  assert.match(publicFormEmail, /BOOKING_INQUIRY_CONFIRMATION/);
  assert.match(publicFormEmail, /CONTACT_CONFIRMATION/);
});

test("admin branding uses the approved logo and Admin Portal label only", () => {
  assert.match(layout, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(layout, /Admin Portal/);
  assert.doesNotMatch(layout, /LOLA Admin/);
  assert.doesNotMatch(layout, /Private operations/);
});

test("customer documents IAM branding report records evidence and verdict", () => {
  assert.match(report, /AREA \| STATUS \| EVIDENCE \| ACTION/);
  assert.match(report, /CUSTOMER DOCUMENTS \+ IAM READY WITH CONFIGURATION/);
});
