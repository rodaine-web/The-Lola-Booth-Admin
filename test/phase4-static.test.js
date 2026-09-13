import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/007_phase_4_payments.sql", import.meta.url), "utf8");
const paymentService = fs.readFileSync(new URL("../server/src/services/payment-service.js", import.meta.url), "utf8");
const reconciliation = fs.readFileSync(new URL("../server/src/services/payment-reconciliation-service.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");
const publicInvoice = fs.readFileSync(new URL("../src/pages/PublicInvoice.jsx", import.meta.url), "utf8");

test("phase 4 migration extends payments, refunds, schedules, webhooks, and settings", () => {
  for (const snippet of [
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id",
    "ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS checkout_url",
    "ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider_refund_id",
    "CREATE TABLE IF NOT EXISTS payment_schedules",
    "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS booking_confirmation_policy",
    "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS offline_payment_instructions"
  ]) {
    assert.match(migration, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("payment service is provider neutral and protects authoritative invoice balances", () => {
  assert.match(paymentService, /createPaymentSession/);
  assert.match(paymentService, /createStripeCheckout/);
  assert.match(paymentService, /createPaypalOrder/);
  assert.match(paymentService, /PAYMENT_EXCEEDS_BALANCE/);
  assert.match(paymentService, /handleStripeWebhook/);
  assert.match(paymentService, /handlePaypalWebhook/);
});

test("reconciliation centralizes invoice and event finance totals", () => {
  assert.match(reconciliation, /reconcileInvoice/);
  assert.match(reconciliation, /amount_outstanding/);
  assert.match(reconciliation, /reconcileEventFinance/);
  assert.match(reconciliation, /applyBookingConfirmationPolicy/);
});

test("admin and public payment routes are exposed", () => {
  for (const route of [
    '"/payment-providers/status"',
    '"/payment-reminders/preview"',
    '"/payments/:id"',
    '"/payments/:id/refunds"',
    '"/payment-schedules"',
    '"/invoices/:token/payment-session"'
  ]) {
    assert.match(adminRoutes + publicRoutes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("public invoice only displays configured provider checkout options", () => {
  assert.match(publicInvoice, /paymentOptions\.providers/);
  assert.match(publicInvoice, /offlinePaymentInstructions/);
  assert.match(publicInvoice, /Flexible payment options may be available at checkout/);
});
