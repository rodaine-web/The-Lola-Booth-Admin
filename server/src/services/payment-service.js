import crypto from "node:crypto";
import { invoiceBalance } from "../../../shared/invoice-balance.js";
import { brandedEmailHtml } from "./automation-service.js";
import { env } from "../config/env.js";
import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { writeAudit } from "./audit-service.js";
import { applyBookingConfirmationPolicy, reconcileInvoice } from "./payment-reconciliation-service.js";

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const cents = (value) => Math.round(Number(value || 0) * 100);

export function providerStatus() {
  const stripeConfigured = Boolean(env.stripeSecretKey?.startsWith("sk_test_"));
  const stripeWebhookConfigured = Boolean(env.stripeWebhookSecret);
  const stripeMode = env.stripeSecretKey?.startsWith("sk_live_") ? "LIVE" : "TEST";
  return {
    stripe: {
      provider: "STRIPE",
      configured: stripeConfigured,
      webhookConfigured: stripeWebhookConfigured,
      mode: stripeMode,
      readiness: stripeMode === "LIVE" ? "DISABLED" : stripeConfigured && stripeWebhookConfigured ? "TEST_READY" : stripeConfigured ? "ERROR" : "NOT_CONFIGURED",
      enabled: stripeConfigured
    },
    paypal: {
      provider: "PAYPAL",
      configured: Boolean(env.paypalClientId && env.paypalClientSecret),
      webhookConfigured: Boolean(env.paypalWebhookId),
      mode: env.paypalEnvironment === "live" ? "LIVE" : "SANDBOX",
      readiness: env.paypalClientId && env.paypalClientSecret && env.paypalWebhookId ? (env.paypalEnvironment === "live" ? "LIVE_READY" : "TEST_READY") : env.paypalClientId || env.paypalClientSecret ? "MISCONFIGURED" : "NOT_CONFIGURED",
      enabled: false // PayPal stays disabled until its separate hosted/capture qualification passes.
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
    amountDue: invoiceBalance(invoice),
    currency: invoice.currency || s.currency || "USD",
    providers: [
      ...(payable && s.stripe_enabled && status.stripe.enabled && ["TEST_READY", "LIVE_READY"].includes(status.stripe.readiness) ? [{ provider: "STRIPE", label: "Card / wallet checkout" }] : []),
      ...(payable && s.paypal_enabled && status.paypal.enabled && ["TEST_READY", "LIVE_READY"].includes(status.paypal.readiness) ? [{ provider: "PAYPAL", label: "PayPal checkout" }] : [])
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
  const pending=(await query("SELECT * FROM payment_attempts WHERE invoice_id=$1 AND provider=$2 AND amount=$3 AND status='PENDING' AND created_at>now()-interval '23 hours' ORDER BY created_at DESC LIMIT 1",[invoice.id,normalizedProvider,options.amountDue])).rows[0];
  if(pending)return safeSession(pending,normalizedProvider);
  const key = `${normalizedProvider}:${invoice.id}:${cents(options.amountDue)}:${idempotencyKey || "default"}`;
  const existing = await query("SELECT * FROM payment_attempts WHERE idempotency_key=$1 AND invoice_id=$2 AND provider=$3 LIMIT 1", [key, invoice.id, normalizedProvider]);
  if (existing.rows[0] && existing.rows[0].status === "PENDING" && Date.now()-new Date(existing.rows[0].created_at).getTime()<23*3600000) return safeSession(existing.rows[0], normalizedProvider);
  if (existing.rows[0]) throw new AppError("This checkout has ended. Please refresh and try again.", 409, "CHECKOUT_ENDED");
  if (normalizedProvider === "STRIPE") return createStripeCheckout(invoice, key, options.currency);
  return createPaypalOrder(invoice, key, options.currency);
}

export async function recordManualPayment(req) {
  const invoice = req.body.invoice_id ? await lockableInvoice(req.body.invoice_id) : null;
  const amount = money(req.body.amount);
  if (invoice && amount > invoiceBalance(invoice)) {
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
  if (!validStripeSignature(rawBody, signature, env.stripeWebhookSecret)) throw new AppError("Invalid Stripe signature.", 400, "INVALID_STRIPE_SIGNATURE");
  const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
  if (event.livemode !== false || env.stripeSecretKey?.startsWith("sk_live_")) throw new AppError("Only Stripe test events are enabled.", 403, "LIVE_PAYMENTS_DISABLED");
  return persistWebhookEvent("STRIPE", event.id, event.type, event, async () => {
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded"].includes(event.type)) {
      const object = event.data?.object || {};
      if (event.type.startsWith("checkout.") && object.payment_status !== "paid") return;
      await recordProviderPayment({
        provider: "STRIPE",
        providerPaymentId: object.payment_intent || object.id,
        providerSessionId: object.id,
        invoiceId: object.metadata?.invoice_id,
        clientId: object.metadata?.client_id,
        eventId: object.metadata?.event_id,
        amount: money((object.amount_total ?? object.amount_received ?? 0) / 100),
        currency: String(object.currency || "usd").toUpperCase(),
        paymentMethod: "ONLINE"
      });
    }
    if (event.type === "payment_intent.payment_failed") {
      const object = event.data?.object || {};
      await recordProviderPaymentFailure({
        provider: "STRIPE",
        providerPaymentId: object.id,
        invoiceId: object.metadata?.invoice_id,
        failureCode: object.last_payment_error?.code || object.last_payment_error?.decline_code || "payment_failed"
      });
    }
    if (event.type === "charge.refunded") {
      const object = event.data?.object || {};
      await recordProviderRefund({
        provider: "STRIPE",
        providerPaymentId: object.payment_intent,
        providerRefundId: object.refunds?.data?.[0]?.id || object.id,
        amount: money((object.amount_refunded || 0) / 100),
        currency: String(object.currency || "usd").toUpperCase()
      });
    }
  });
}

export async function handlePaypalWebhook() {
  throw new AppError("PayPal webhook processing is disabled until verification and capture are qualified.", 503, "PAYPAL_DISABLED");
}

async function recordProviderPayment(input) {
  if (!input.invoiceId || !input.providerPaymentId) throw new AppError("Missing payment relationship.",422,"PAYMENT_RELATIONSHIP_REQUIRED");
  const invoice = await query("SELECT * FROM invoices WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [input.invoiceId]);
  if (!invoice.rows[0]) throw notFound("Invoice");
  const prior = (await query("SELECT * FROM payments WHERE provider=$1 AND provider_payment_id=$2",[input.provider,input.providerPaymentId])).rows[0];
  if (prior) return prior;
  const attempt = (await query("SELECT * FROM payment_attempts WHERE invoice_id=$1 AND provider=$2 AND (provider_session_id=$3 OR provider_reference=$4 OR status='PENDING') ORDER BY created_at DESC LIMIT 1",[input.invoiceId,input.provider,input.providerSessionId,input.providerPaymentId])).rows[0];
  if (!attempt || cents(attempt.amount)!==cents(input.amount) || attempt.currency!==input.currency || input.amount<=0 || input.amount>invoiceBalance(invoice.rows[0])) throw new AppError("Payment does not match the server invoice checkout.",409,"PAYMENT_MISMATCH");
  input.clientId=invoice.rows[0].client_id;
  input.eventId=invoice.rows[0].event_id;
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
  await query("INSERT INTO payment_receipts(payment_id,invoice_id) VALUES($1,$2) ON CONFLICT(payment_id) DO NOTHING",[payment.id,input.invoiceId]);
  const customer=(await query("SELECT name,email FROM clients WHERE id=$1",[payment.client_id])).rows[0];
  if(customer?.email){
    const url=`${env.publicBaseUrl}/pay/${invoice.rows[0].secure_token}`;
    const subject=`Payment confirmation — ${invoice.rows[0].invoice_number}`;
    const body=`Thank you, ${customer.name}.\nWe received ${Number(payment.amount).toFixed(2)} ${payment.currency} for invoice ${invoice.rows[0].invoice_number}.\nView your invoice and download your receipt: ${url}`;
    await query(`INSERT INTO communications(client_id,event_id,invoice_id,type,channel,direction,recipient,subject,rendered_subject,rendered_body,rendered_html,status,send_mode,scheduled_at,idempotency_key,trigger_key)
      VALUES($1,$2,$3,'EMAIL','EMAIL','OUTBOUND',$4,$5,$5,$6,$7,'SCHEDULED','SCHEDULED',now(),$8,'PAYMENT_CONFIRMATION')
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,[payment.client_id,payment.event_id,input.invoiceId,customer.email,subject,body,brandedEmailHtml(body),`payment-confirmation:${payment.id}`]);
  }
  await writeAudit({req:{},action:"payment_succeeded",entity:"payment",entityId:payment.id,after:{invoice_id:input.invoiceId,amount:payment.amount,currency:payment.currency,provider:payment.provider}});
  return payment;
}

async function recordProviderPaymentFailure(input) {
  if (!input.invoiceId && !input.providerPaymentId) return null;
  await query(
    `UPDATE payment_attempts
     SET status='FAILED', provider_reference=COALESCE(provider_reference,$1), failure_code=$2, updated_at=now()
     WHERE provider=$3 AND (
       provider_reference=$1
       OR provider_session_id=$1
       OR ($4::uuid IS NOT NULL AND invoice_id=$4 AND status='PENDING')
     ) AND status <> 'SUCCEEDED'`,
    [input.providerPaymentId || null, input.failureCode || "payment_failed", input.provider, input.invoiceId || null]
  );
  return { status: "FAILED" };
}

async function recordProviderRefund(input) {
  if (!input.providerPaymentId || !input.amount) return null;
  const payment = (await query("SELECT * FROM payments WHERE provider=$1 AND provider_payment_id=$2 AND deleted_at IS NULL", [input.provider, input.providerPaymentId])).rows[0];
  if (!payment) return null;
  const refund = await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO refunds (payment_id, invoice_id, event_id, client_id, provider, amount, currency, reason, refund_type, status, provider_refund_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Stripe refund webhook',$8,'SUCCEEDED',$9,$10)
       ON CONFLICT (provider, provider_refund_id) WHERE provider_refund_id IS NOT NULL DO UPDATE SET updated_at=now()
       RETURNING *`,
      [payment.id, payment.invoice_id, payment.event_id, payment.client_id, input.provider, input.amount, input.currency || payment.currency, input.amount >= Number(payment.amount) ? "FULL" : "PARTIAL", input.providerRefundId, `${input.provider}:refund:${input.providerRefundId}`]
    );
    await client.query(
      `UPDATE payments SET refunded_amount=GREATEST(refunded_amount,$1::numeric),
        status=CASE WHEN $1::numeric >= amount THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END,
        updated_at=now()
       WHERE id=$2`,
      [input.amount, payment.id]
    );
    return inserted.rows[0];
  });
  if (payment.invoice_id) await reconcileInvoice(payment.invoice_id, { action: "refund_completed" });
  return refund;
}

async function createStripeCheckout(invoice, key, currency) {
  const amount = invoiceBalance(invoice);
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${env.publicBaseUrl}/pay/${invoice.secure_token}?payment=success`,
    cancel_url: `${env.publicBaseUrl}/pay/${invoice.secure_token}?payment=cancelled`,
    "line_items[0][price_data][currency]": currency.toLowerCase(),
    "line_items[0][price_data][product_data][name]": `LOLA Booths Invoice ${invoice.invoice_number}`,
    "line_items[0][price_data][unit_amount]": String(cents(amount)),
    "line_items[0][quantity]": "1",
    "metadata[invoice_id]": invoice.id,
    "metadata[client_id]": invoice.client_id || "",
    "metadata[event_id]": invoice.event_id || "",
    "payment_intent_data[metadata][invoice_id]": invoice.id,
    "payment_intent_data[metadata][client_id]": invoice.client_id || "",
    "payment_intent_data[metadata][event_id]": invoice.event_id || ""
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
  const amount = invoiceBalance(invoice);
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": key },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ custom_id: invoice.id, invoice_id: invoice.id, amount: { currency_code: currency, value: amount.toFixed(2) } }],
      application_context: { return_url: `${env.publicBaseUrl}/pay/${invoice.secure_token}?payment=success`, cancel_url: `${env.publicBaseUrl}/pay/${invoice.secure_token}?payment=cancelled` }
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
  const invoice = await query("SELECT * FROM invoices WHERE secure_token=$1 AND deleted_at IS NULL AND token_revoked_at IS NULL AND (token_expires_at IS NULL OR token_expires_at>now())", [token]);
  if (!invoice.rows[0]) throw notFound("Invoice");
  return invoice.rows[0];
}

async function lockableInvoice(id) {
  const invoice = await query("SELECT * FROM invoices WHERE id=$1 AND deleted_at IS NULL", [id]);
  if (!invoice.rows[0]) throw notFound("Invoice");
  return invoice.rows[0];
}

function isInvoicePayable(invoice) {
  return invoice && !invoice.archived_at && ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status) && invoiceBalance(invoice) > 0;
}

function safeSession(row, provider) {
  return { provider, checkoutUrl: row.checkout_url, sessionId: row.provider_session_id, amount: money(row.amount), currency: row.currency };
}

function validStripeSignature(rawBody, signature, secret) {
  const parts = String(signature || "").split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>300) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return signatures.some((candidate) => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    const candidateBuffer = Buffer.from(candidate, "hex");
    return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}

async function persistWebhookEvent(provider, eventId, eventType, payload, processor) {
  if (!eventId || !eventType) throw new AppError("Invalid webhook event.",400,"INVALID_WEBHOOK");
  const payloadText=JSON.stringify(payload);
  const payloadHash=crypto.createHash("sha256").update(payloadText).digest("hex");
  try {
    return await transaction(async client=>{
      await client.query(`INSERT INTO webhook_events(provider,external_event_id,event_type,payload,payload_hash,status)
        VALUES($1,$2,$3,$4,$5,'RECEIVED') ON CONFLICT(provider,external_event_id) DO NOTHING`,[provider,eventId,eventType,payloadText,payloadHash]);
      const row=(await client.query("SELECT * FROM webhook_events WHERE provider=$1 AND external_event_id=$2 FOR UPDATE",[provider,eventId])).rows[0];
      if(row.payload_hash!==payloadHash)throw new AppError("Webhook payload changed.",409,"WEBHOOK_PAYLOAD_MISMATCH");
      if(row.status==='PROCESSED')return {duplicate:true,status:'IGNORED'};
      await processor();
      await client.query("UPDATE webhook_events SET status='PROCESSED',processed_at=now(),error_message=NULL WHERE id=$1",[row.id]);
      return {duplicate:false,status:'PROCESSED'};
    });
  } catch(error) {
    await query(`INSERT INTO webhook_events(provider,external_event_id,event_type,payload,payload_hash,status,error_message)
      VALUES($1,$2,$3,$4,$5,'FAILED',$6) ON CONFLICT(provider,external_event_id) DO UPDATE SET error_message=EXCLUDED.error_message
      WHERE webhook_events.status <> 'PROCESSED'`,[provider,eventId,eventType,payloadText,payloadHash,error.code||'WEBHOOK_PROCESSING_FAILED']);
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
