import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/006_phase_3_documents_invoices.sql", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");
const proposalService = fs.readFileSync(new URL("../server/src/services/proposal-service.js", import.meta.url), "utf8");
const invoiceService = fs.readFileSync(new URL("../server/src/services/invoice-service.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const resourcePage = fs.readFileSync(new URL("../src/pages/ResourcePage.jsx", import.meta.url), "utf8");
const documentService = fs.readFileSync(new URL("../server/src/services/document-service.js", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");

test("phase 3 migration adds document, delivery, token, and numbering fields", () => {
  for (const snippet of [
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS proposal_number",
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS secure_token",
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS pricing_snapshot",
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS secure_token",
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS proposal_id",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id",
    "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS next_invoice_number",
    "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS proposal_default_intro"
  ]) {
    assert.match(migration, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("proposal and invoice admin workflows expose lifecycle actions", () => {
  for (const route of [
    '"/proposals/:id/preview"',
    '"/proposals/:id/pdf"',
    '"/proposals/:id/docx"',
    '"/proposals/:id/send"',
    '"/proposals/:id/create-invoice"',
    '"/invoices/:id/pdf"',
    '"/invoices/:id/send"',
    '"/invoices/:id/void"'
  ]) {
    assert.match(adminRoutes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("secure public views track proposal and invoice access", () => {
  assert.match(publicRoutes, /getProposal\(req\.params\.token, \{ publicView: true \}\)/);
  assert.match(publicRoutes, /first_viewed_at=COALESCE\(first_viewed_at, now\(\)\)/);
  assert.match(publicRoutes, /accepted_by_name/);
  assert.match(publicRoutes, /getInvoice\(req\.params\.token, \{ publicView: true \}\)/);
});

test("services snapshot pricing and generate branded documents", () => {
  assert.match(proposalService, /buildProposalSnapshot/);
  assert.match(proposalService, /createProposalVersion/);
  assert.match(proposalService, /proposal_deliveries/);
  assert.match(invoiceService, /calculateInvoiceTotals/);
  assert.match(invoiceService, /amount_outstanding/);
});

test("frontend replaces raw proposal and invoice placeholders with dedicated workflows", () => {
  assert.match(app, /<Proposals \/>/);
  assert.match(app, /<ProposalEditor \/>/);
  assert.match(app, /<InvoiceEditor \/>/);
  assert.match(app, /<PublicProposal \/>/);
  assert.match(resourcePage, /RelationshipSelect/);
});

test("LOLA logo branding is applied to admin chrome and generated documents", () => {
  assert.match(layout, /\/brand\/LOLA_Primary_Dark_Transparent\.png/);
  assert.match(layout, /brand-logo-admin-stacked/);
  assert.match(documentService, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(documentService, /ImageRun/);
  assert.match(documentService, /doc\.image\(selectedLogo/);
});
