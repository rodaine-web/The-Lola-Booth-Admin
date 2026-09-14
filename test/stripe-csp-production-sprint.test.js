import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const env = fs.readFileSync(new URL("../server/src/config/env.js", import.meta.url), "utf8");
const example = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../server/src/index.js", import.meta.url), "utf8");
const paymentService = fs.readFileSync(new URL("../server/src/services/payment-service.js", import.meta.url), "utf8");
const publicInvoice = fs.readFileSync(new URL("../src/pages/PublicInvoice.jsx", import.meta.url), "utf8");
const vercel = fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
const csp = JSON.parse(vercel).headers[0].headers.find((header) => header.key === "Content-Security-Policy").value;

test("Stripe hosted checkout is server-side and does not require frontend publishable keys", () => {
  assert.doesNotMatch(env + example + paymentService + publicInvoice, /STRIPE_PUBLISHABLE_KEY|stripePublishable|publishableKey/);
  assert.match(paymentService, /https:\/\/api\.stripe\.com\/v1\/checkout\/sessions/);
  assert.match(paymentService, /Authorization: `Bearer \$\{env\.stripeSecretKey\}`/);
  assert.match(paymentService, /payment_intent_data\[metadata\]\[invoice_id\]/);
  assert.doesNotMatch(publicInvoice, /Stripe\(|loadStripe|js\.stripe\.com/);
});

test("Stripe payment sessions are scoped to trusted invoice amount and invoice idempotency", () => {
  const sessionSlice = paymentService.slice(paymentService.indexOf("export async function createPaymentSession"), paymentService.indexOf("export async function recordManualPayment"));
  assert.match(paymentService, /const amount = money\(invoice\.amount_outstanding \|\| invoice\.balance_due\)/);
  assert.match(sessionSlice, /const key = `\$\{normalizedProvider\}:\$\{invoice\.id\}:\$\{cents\(options\.amountDue\)\}:/);
  assert.match(sessionSlice, /WHERE idempotency_key=\$1 AND invoice_id=\$2 AND provider=\$3/);
  assert.doesNotMatch(sessionSlice, /req\.body\.amount|body\.amountDue|amount_total: req/);
});

test("Stripe webhook keeps raw body before JSON parsing and verifies signatures", () => {
  assert.ok(index.indexOf('app.use("/api/webhooks", express.raw') < index.indexOf('app.use(express.json'));
  assert.match(paymentService, /validStripeSignature/);
  assert.match(paymentService, /crypto\.timingSafeEqual/);
  assert.match(paymentService, /INVALID_STRIPE_SIGNATURE/);
  assert.match(paymentService, /ON CONFLICT \(provider, external_event_id\) DO NOTHING/);
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
  assert.match(csp, /connect-src 'self' https:\/\/api\.thelolabooth\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /\*|'unsafe-inline'|'unsafe-eval'|js\.stripe\.com|checkout\.stripe\.com|googletagmanager\.com|google-analytics\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/);
});
