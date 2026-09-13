import crypto from "node:crypto";
import { env } from "../config/env.js";
import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { writeAudit } from "./audit-service.js";
import { applyBookingConfirmationPolicy, reconcileInvoice } from "./payment-reconciliation-service.js";

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const cents = (value) => Math.round(Number(value || 0) * 100);

export function providerStatus() {
  return {
    stripe: {
      provider: "STRIPE",
      configured: Boolean(env.stripeSecretKey && env.stripePublishableKey),
      webhookConfigured: Boolean(env.stripeWebhookSecret),
      mode: env.stripeSecretKey?.startsWith("sk_live_") ? "LIVE" : "TEST",
      enabled: Boolean(env.stripeSecretKey && env.stripePublishableKey)
    },
    paypal: {
      provider: "PAYPAL",
      configured: Boolean(env.paypalClientId && env.paypalClientSecret),
      webhookConfigured: Boolean(env.paypalWebhookId),
      mode: env.paypalEnvironment === "live" ? "LIVE" : "SANDBOX",
      enabled: Boolean(env.paypalClientId && env.paypalClientSecret)
    }
  };
}

export async function publicPaymentOptions(invoice) {
  const settings = await query("SELECT stripe_enabled, paypal_enabled, offline_payment_instructions, currency FROM business_settings LIMIT 1");
  const s = settings.rows[0] || {};
  const status = providerStatus();
  const payable = isInvoicePayable(invoice);
  return {
    payable,
    amountDue: money(invoice.amount_outstanding || invoice.balance_due),
    currency: invoice.currency || s.currency || "USD",
    providers: [
      ...(payable && s.stripe_enabled && status.stripe.enabled ? [{ provider: "STRIPE", label: "Card / wallet checkout", publishableKey: env.stripePublishableKey }] : []),
      ...(payable && s.paypal_enabled && status.paypal.enabled ? [{ provider: "PAYPAL", label: "PayPal checkout" }] : [])
    ],
    offlinePaymentInstructions: s.offline_payment_instructions || ""
  };
}

export async function createPaymentSession({ token, provider, idempotencyKey }) {
  const invoice = await loadInvoiceByToken(token);
  if (!isInvoicePayable(invoice)) throw new AppError("This invoice is not payable.", 409, "INVOICE_NOT_PAYABLE");
  const normalizedProvider = String(provider || "").toUpperCase();
  if (!["STRIPE", "PAYPAL"].includes(normalizedProvider)) throw new AppError("Unsupported payment provider.", 400, "UNSUPPORTED_PROVIDER");
  const options = await publicPaymentOptions(invoice);
  if (!options.providers.some((item) => item.provider === normalizedProvider)) throw new AppError("This payment provider is not configured.", 409, "PAYMENT_PROVIDER_UNAVAILABLE");
  const key = idempotencyKey || `${normalizedProvider}:${invoice.id}:${cents(options.amountDue)}`;
  const existing = await query("SELECT * FROM payment_attempts WHERE idempotency_key=$1 LIMIT 1", [key]);
  if (existing.rows[0]) return safeSession(existing.rows[0], normalizedProvider);
  if (normalizedProvider === "STRIPE") return createStripeCheckout(invoice, key, options.currency);
  return createPaypalOrder(invoice, key, options.currency);
}

export async function recordManualPayment(req) {
  const invoice = req.body.invoice_id ? await lockableInvoice(req.body.invoice_id) : null;
  const amount = money(req.body.amount);
  if (invoice && amount > Number(invoice.amount_outstanding || invoice.balance_due || 0)) {
    throw new AppError("Manual payment cannot exceed the invoice balance.", 409, "PAYMENT_EXCEEDS_BALANCE");
  }
  const payment = await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO payments (event_id, client_id, invoice_id, provider, amount, currency, payment_method, reference_number, payment_date, paid_at, notes, recorded_by, status, idempotency_key)
       VALUES ($1,$2,$3,'MANUAL',$4,$5,$6,$7,$8,$8::date::timestamptz,$9,$10,'SUCCEEDED',$11)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at=now()
       RETURNING *`,
      [req.body.event_id, req.body.client_id, req.body.invoice_id || null, amount, req.body.currency || "USD", req.body.payment_method, req.body.reference_number || null, req.body.payment_date, req.body.notes || null, req.user.id, req.body.idempotency_key || null]
    );
    return inserted.rows[0];
  });
  if (payment.invoice_id) {
    await reconcileInvoice(payment.invoice_id, { req, actorUserId: req.user.id, action: "manual_payment_recorded" });
    await applyBookingConfirmationPolicy(payment.event_id);
  }
  await writeAudit({ req, action: "payment_recorded", entity: "payment", entityId: payment.id, after: payment });
  await recordActivity({ actorUserId: req.user.id, entityType: "event", entityId: payment.event_id, action: "payment_recorded", summary: `Payment recorded: $${payment.amount}` });
  return payment;
}

export async function getPayment(id) {
  const payment = await query(
    `SELECT p.*, c.name AS client_name, e.event_name, i.invoice_number
     FROM payments p
     LEFT JOIN clients c ON c.id=p.client_id
     LEFT JOIN events e ON e.id=p.event_id
     LEFT JOIN invoices i ON i.id=p.invoice_id
     WHERE p.id=$1 AND p.deleted_at IS NULL`,
    [id]
  );
  if (!payment.rows[0]) throw notFound("Payment");
  const refunds = await query("SELECT * FROM refunds WHERE payment_id=$1 ORDER BY created_at DESC", [id]);
  return { ...payment.rows[0], refunds: refunds.rows };
}

export async function createRefund(req) {
  const payment = await getPayment(req.params.id);
  const amount = money(req.body.amount || (Number(payment.amount) - Number(payment.refunded_amount || 0)));
  const max = money(Number(payment.amount) - Number(payment.refunded_amount || 0));
  if (amount <= 0 || amount > max) throw new AppError("Refund amount is outside the refundable balance.", 409, "INVALID_REFUND_AMOUNT");
  if (payment.provider !== "MANUAL") {
    throw new AppError("Provider refund adapters are prepared, but live refund calls require configured Stripe or PayPal credentials.", 409, "PROVIDER_REFUND_NOT_CONFIGURED");
  }
  const refund = await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO refunds (payment_id, invoice_id, event_id, client_id, provider, amount, currency, reason, notes, refund_type, status, provider_reference, created_by, idempotency_key)
       VALUES ($1,$2,$3,$4,'MANUAL',$5,$6,$7,$8,$9,'SUCCEEDED',$10,$11,$12)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at=now()
       RETURNING *`,
      [payment.id, payment.invoice_id, payment.event_id, payment.client_id, amount, payment.currency, req.body.reason || null, req.body.notes || null, amount === Number(payment.amount) ? "FULL" : "PARTIAL", req.body.reference_number || null, req.user.id, req.body.idempotency_key || null]
    );
    await client.query(
      `UPDATE payments SET refunded_amount=refunded_amount+$1::numeric,
        status=CASE WHEN refunded_amount+$1::numeric >= amount THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END,
        updated_at=now()
       WHERE id=$2`,
      [amount, payment.id]
    );
    return inserted.rows[0];
  });
  if (payment.invoice_id) await reconcileInvoice(payment.invoice_id, { req, actorUserId: req.user.id, action: "refund_completed" });
  await writeAudit({ req, action: "refund_completed", entity: "refund", entityId: refund.id, after: refund });
  return refund;
}

export async function handleStripeWebhook(rawBody, signature) {
  if (!env.stripeWebhookSecret) throw new AppError("Stripe webhook secret is not configured.", 503, "STRIPE_WEBHOOK_NOT_CONFIGURED");
  const expected = stripeSignature(rawBody, signature, env.stripeWebhookSecret);
  if (!signature?.includes(expected)) throw new AppError("Invalid Stripe signature.", 400, "INVALID_STRIPE_SIGNATURE");
  const event = JSON.parse(rawBody.toString("utf8"));
  return persistWebhookEvent("STRIPE", event.id, event.type, event, async () => {
    if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
      const object = event.data?.object || {};
      await recordProviderPayment({
        provider: "STRIPE",
        providerPaymentId: object.payment_intent || object.id,
        providerSessionId: object.id,
        invoiceId: object.metadata?.invoice_id,
        clientId: object.metadata?.client_id,
        eventId: object.metadata?.event_id,
        amount: money((object.amount_total || object.amount_received || 0) / 100),
        currency: String(object.currency || "usd").toUpperCase(),
        paymentMethod: "ONLINE"
      });
    }
  });
}

export async function handlePaypalWebhook(rawBody) {
  const event = JSON.parse(rawBody.toString("utf8"));
  return persistWebhookEvent("PAYPAL", event.id, event.event_type, event, async () => {
    const resource = event.resource || {};
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      await recordProviderPayment({
        provider: "PAYPAL",
        providerPaymentId: resource.id,
        providerSessionId: resource.supplementary_data?.related_ids?.order_id,
        invoiceId: resource.custom_id || resource.invoice_id,
        amount: money(resource.amount?.value),
        currency: resource.amount?.currency_code || "USD",
        paymentMethod: "PAYPAL"
      });
    }
  });
}

async function recordProviderPayment(input) {
  if (!input.invoiceId) return null;
  const invoice = await query("SELECT * FROM invoices WHERE id=$1", [input.invoiceId]);
  if (!invoice.rows[0]) return null;
  const payment = await transaction(async (client) => {
    const result = await client.query(
      `INSERT INTO payments (invoice_id, event_id, client_id, provider, provider_payment_id, provider_session_id, amount, currency, payment_method, payment_date, paid_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,current_date,now(),'SUCCEEDED')
       ON CONFLICT (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL DO UPDATE SET updated_at=now()
       RETURNING *`,
      [input.invoiceId, input.eventId || invoice.rows[0].event_id, input.clientId || invoice.rows[0].client_id, input.provider, input.providerPaymentId, input.providerSessionId || null, input.amount, input.currency, input.paymentMethod]
    );
    await client.query("UPDATE payment_attempts SET status='SUCCEEDED', updated_at=now() WHERE invoice_id=$1 AND provider=$2 AND (provider_session_id=$3 OR provider_reference=$4)", [input.invoiceId, input.provider, input.providerSessionId || null, input.providerPaymentId || null]);
    return result.rows[0];
  });
  await reconcileInvoice(input.invoiceId, { action: "payment_succeeded" });
  await applyBookingConfirmationPolicy(payment.event_id);
  return payment;
}

async function createStripeCheckout(invoice, key, currency) {
  const amount = money(invoice.amount_outstanding || invoice.balance_due);
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${env.publicBaseUrl}/invoice/${invoice.secure_token}?payment=success`,
    cancel_url: `${env.publicBaseUrl}/invoice/${invoice.secure_token}?payment=cancelled`,
    "line_items[0][price_data][currency]": currency.toLowerCase(),
    "line_items[0][price_data][product_data][name]": `LOLA Booths Invoice ${invoice.invoice_number}`,
    "line_items[0][price_data][unit_amount]": String(cents(amount)),
    "line_items[0][quantity]": "1",
    "metadata[invoice_id]": invoice.id,
    "metadata[client_id]": invoice.client_id || "",
    "metadata[event_id]": invoice.event_id || ""
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": key },
    body: params
  });
  const data = await response.json();
  if (!response.ok) throw new AppError(safeProviderMessage(data.error?.message), 502, "STRIPE_SESSION_FAILED");
  await insertAttempt({ invoice, provider: "STRIPE", key, amount, currency, providerSessionId: data.id, checkoutUrl: data.url, status: "PENDING" });
  return { provider: "STRIPE", checkoutUrl: data.url, sessionId: data.id, amount, currency };
}

async function createPaypalOrder(invoice, key, currency) {
  const amount = money(invoice.amount_outstanding || invoice.balance_due);
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": key },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ custom_id: invoice.id, invoice_id: invoice.id, amount: { currency_code: currency, value: amount.toFixed(2) } }],
      application_context: { return_url: `${env.publicBaseUrl}/invoice/${invoice.secure_token}?payment=success`, cancel_url: `${env.publicBaseUrl}/invoice/${invoice.secure_token}?payment=cancelled` }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new AppError(safeProviderMessage(data.message), 502, "PAYPAL_ORDER_FAILED");
  const checkoutUrl = data.links?.find((link) => link.rel === "approve")?.href;
  await insertAttempt({ invoice, provider: "PAYPAL", key, amount, currency, providerSessionId: data.id, checkoutUrl, status: "PENDING" });
  return { provider: "PAYPAL", checkoutUrl, sessionId: data.id, amount, currency };
}

async function insertAttempt({ invoice, provider, key, amount, currency, providerSessionId, checkoutUrl, status }) {
  await query(
    `INSERT INTO payment_attempts (invoice_id, client_id, event_id, proposal_id, provider, provider_reference, provider_session_id, checkout_url, amount, currency, status, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [invoice.id, invoice.client_id, invoice.event_id, invoice.proposal_id, provider, providerSessionId, checkoutUrl, amount, currency, status, key, JSON.stringify({ invoice_number: invoice.invoice_number })]
  );
}

async function loadInvoiceByToken(token) {
  const invoice = await query("SELECT * FROM invoices WHERE secure_token=$1 AND deleted_at IS NULL", [token]);
  if (!invoice.rows[0]) throw notFound("Invoice");
  return invoice.rows[0];
}

async function lockableInvoice(id) {
  const invoice = await query("SELECT * FROM invoices WHERE id=$1 AND deleted_at IS NULL", [id]);
  if (!invoice.rows[0]) throw notFound("Invoice");
  return invoice.rows[0];
}

function isInvoicePayable(invoice) {
  return invoice && !invoice.archived_at && !["PAID", "VOID", "REFUNDED"].includes(invoice.status) && Number(invoice.amount_outstanding || invoice.balance_due || 0) > 0;
}

function safeSession(row, provider) {
  return { provider, checkoutUrl: row.checkout_url, sessionId: row.provider_session_id, amount: money(row.amount), currency: row.currency };
}

function stripeSignature(rawBody, signature, secret) {
  const timestamp = String(signature || "").split(",").find((part) => part.startsWith("t="))?.slice(2);
  if (!timestamp) return "";
  const headerPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  return crypto.createHmac("sha256", secret).update(headerPayload).digest("hex");
}

async function persistWebhookEvent(provider, eventId, eventType, payload, processor) {
  const payloadText = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadText).digest("hex");
  const inserted = await query(
    `INSERT INTO webhook_events (provider, external_event_id, event_type, payload, payload_hash, status)
     VALUES ($1,$2,$3,$4,$5,'RECEIVED')
     ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING *`,
    [provider, eventId, eventType, payloadText, payloadHash]
  );
  if (!inserted.rows[0]) return { duplicate: true, status: "IGNORED" };
  try {
    await processor();
    await query("UPDATE webhook_events SET status='PROCESSED', processed_at=now() WHERE id=$1", [inserted.rows[0].id]);
    return { duplicate: false, status: "PROCESSED" };
  } catch (error) {
    await query("UPDATE webhook_events SET status='FAILED', error_message=$1 WHERE id=$2", [safeProviderMessage(error.message), inserted.rows[0].id]);
    throw error;
  }
}

async function paypalAccessToken() {
  const auth = Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64");
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const data = await response.json();
  if (!response.ok) throw new AppError(safeProviderMessage(data.error_description), 502, "PAYPAL_AUTH_FAILED");
  return data.access_token;
}

function paypalBaseUrl() {
  return env.paypalEnvironment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function safeProviderMessage(message = "Payment provider request failed.") {
  return String(message).replace(/sk_(test|live)_[A-Za-z0-9]+/g, "[redacted]").slice(0, 240);
}
