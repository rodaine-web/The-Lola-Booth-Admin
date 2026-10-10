import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const env = fs.readFileSync(new URL("../server/src/config/env.js", import.meta.url), "utf8");
const example = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../server/src/index.js", import.meta.url), "utf8");
const paymentService = fs.readFileSync(new URL("../server/src/services/payment-service.js", import.meta.url), "utf8");
const publicInvoice = fs.readFileSync(new URL("../src/pages/PublicInvoice.jsx", import.meta.url), "utf8");
const vercel = fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
const csp = JSON.parse(vercel).headers.find(rule => rule.source === "/(.*)").headers.find((header) => header.key === "Content-Security-Policy").value;

test("Stripe hosted checkout is server-side and does not require frontend publishable keys", () => {
  assert.doesNotMatch(env + example + paymentService + publicInvoice, /STRIPE_PUBLISHABLE_KEY|stripePublishable|publishableKey/);
  assert.match(paymentService, /https:\/\/api\.stripe\.com\/v1\/checkout\/sessions/);
  assert.match(paymentService, /Authorization: `Bearer \$\{env\.stripeSecretKey\}`/);
  assert.match(paymentService, /payment_intent_data\[metadata\]\[invoice_id\]/);
  assert.doesNotMatch(publicInvoice, /Stripe\(|loadStripe|js\.stripe\.com/);
});

test("Stripe payment sessions are scoped to trusted invoice payment choices and invoice idempotency", () => {
  const sessionSlice = paymentService.slice(paymentService.indexOf("export async function createPaymentSession"), paymentService.indexOf("export async function recordManualPayment"));
  assert.match(paymentService, /amountChoice = "DEPOSIT"/);
  assert.match(sessionSlice, /selectedAmount = options\.amountDue/);
  assert.match(sessionSlice, /selectedAmount = options\.fullAmount/);
  assert.match(sessionSlice, /selectedAmount < options\.minimumAmount \|\| selectedAmount > options\.fullAmount/);
  assert.match(sessionSlice, /cents\(selectedAmount\)/);
  assert.match(sessionSlice, /WHERE idempotency_key=\$1 AND invoice_id=\$2 AND provider=\$3/);
  assert.doesNotMatch(sessionSlice, /req\.body\.amount|body\.amountDue|amount_total: req/);
});

test("Stripe webhook keeps raw body before JSON parsing and verifies signatures", () => {
  assert.ok(index.indexOf('app.use("/api/webhooks", express.raw') < index.indexOf('app.use(express.json'));
  assert.match(paymentService, /validStripeSignature/);
  assert.match(paymentService, /crypto\.timingSafeEqual/);
  assert.match(paymentService, /INVALID_STRIPE_SIGNATURE/);
  assert.match(paymentService, /ON CONFLICT\s*\(provider,\s*external_event_id\) DO UPDATE SET/);
  assert.match(paymentService, /row\.status === "PROCESSED"/);
  assert.match(paymentService, /status IN \('RECEIVED','FAILED','FAILED_NEEDS_REVIEW'\)/);
});

test("Deposit-paid booking policy requires the configured deposit amount", () => {
  const reconciliation = fs.readFileSync(new URL("../server/src/services/payment-reconciliation-service.js", import.meta.url), "utf8");
  assert.match(reconciliation, /sum\(deposit_required\)/);
  assert.match(reconciliation, /const depositSatisfied = depositRequired > 0 \? paid >= depositRequired : paid > 0/);
  assert.match(reconciliation, /policy === "DEPOSIT_PAID" && depositSatisfied/);
});

test("Manual payments inherit client and event from the invoice", () => {
  const start = paymentService.indexOf("export async function recordManualPayment");
  const end = paymentService.indexOf("export async function getPayment", start);
  const slice = paymentService.slice(start, end);
  assert.match(slice, /const paymentEventId = invoice \? invoice\.event_id : req\.body\.event_id/);
  assert.match(slice, /const paymentClientId = invoice \? invoice\.client_id : req\.body\.client_id/);
  assert.match(slice, /\[paymentEventId, paymentClientId, req\.body\.invoice_id \|\| null/);
});

test("Payment confirmation communication binding matches SQL placeholders", () => {
  const start = paymentService.indexOf("async function sendRecordedPaymentEmail");
  const end = paymentService.indexOf("async function recordProviderPaymentFailure", start);
  const slice = paymentService.slice(start, end);
  assert.match(slice, /VALUES\(\$1,\$2,\$3,'EMAIL','EMAIL','OUTBOUND',\$4,\$5,\$5,\$6,\$7,\$8,'DRAFT','SEND_NOW',\$9,\$10\)/);
  assert.match(slice, /\[payment\.client_id,payment\.event_id,invoice\.id,to,subject,body\.slice\(0,500\),body,html,idempotencyKey,triggerKey\]/);
});

test("Stripe test sprint handles success, failure, and refund webhooks without duplicate payments", () => {
  for (const token of [
    "checkout.session.completed",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "charge.refunded",
    "recordProviderPaymentFailure",
    "recordProviderRefund",
    "idx_payments_provider_payment"
  ]) {
    assert.match(paymentService + fs.readFileSync(new URL("../server/migrations/007_phase_4_payments.sql", import.meta.url), "utf8"), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Admin CSP remains narrow and does not whitelist unused Google or Stripe browser resources", () => {
  assert.match(csp, /connect-src 'self' https:\/\/stagingapi\.thelolabooth\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)?.[0] || '', /'unsafe-inline'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(csp, /\*|'unsafe-eval'|js\.stripe\.com|checkout\.stripe\.com|googletagmanager\.com|google-analytics\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/);
});
