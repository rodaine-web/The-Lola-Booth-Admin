import {createHmac, timingSafeEqual} from 'node:crypto';
import {AppError} from '../utils/errors.js';

// Contract: https://www.prodigi.com/print-api/docs/openapi.yml (v5).
// Sandbox order writes are isolated. Managed assets/products/settings are shared
// account resources, so this adapter deliberately cannot write those resources.
const BASE_URL = 'https://api.prodigi.com/v5';
const SAFE_ENVIRONMENTS = new Set(['staging', 'test', 'development']);
const identifier = /^[A-Za-z0-9_-]{1,120}$/;
const error = (message, code = 'PRODIGI_VALIDATION', status = 400) => new AppError(message, status, code);

export function prodigiStatus(config = process.env) {
  const environment = config.APP_ENV || (config.NODE_ENV === 'test' ? 'test' : '');
  const configured = /^sandbox_[A-Za-z0-9_-]+$/.test(config.PRODIGI_SANDBOX_API_KEY || '');
  const permitted = SAFE_ENVIRONMENTS.has(environment);
  return {provider: 'PRODIGI', apiVersion: 'v5', mode: 'SANDBOX', configured,
    enabled: configured && permitted, environment,
    readiness: !permitted ? 'ENVIRONMENT_DISABLED' : configured ? 'SANDBOX_READY' : 'NOT_CONFIGURED'};
}

function validIdentifier(value, label) {
  if (typeof value !== 'string' || !identifier.test(value)) throw error(`Invalid Prodigi ${label}.`);
  return value;
}

function allowedRequest(path, method) {
  if (method === 'GET') return /^\/catalogue\/(?:variants\/[A-Za-z0-9_-]+|products(?:\/[A-Za-z0-9_-]+(?:\/variants)?)?)$/.test(path)
    || /^\/orders\/[A-Za-z0-9_-]+(?:\/shipments)?$/.test(path);
  return method === 'POST' && (path === '/quotes/order' || path === '/orders'
    || /^\/orders\/[A-Za-z0-9_-]+:(submit|cancel)$/.test(path));
}

export async function prodigiRequest(path, {method = 'GET', body, idempotencyKey} = {}, request = fetch, config = process.env) {
  if (!prodigiStatus(config).enabled) throw error('Prodigi sandbox is not configured for this environment.', 'PRODIGI_UNAVAILABLE', 409);
  method = method.toUpperCase();
  if (!allowedRequest(path, method)) throw error('This Prodigi operation is not permitted.', 'PRODIGI_OPERATION_DISABLED', 403);
  if (path === '/orders' && method === 'POST' && (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 64 || /[\r\n]/.test(idempotencyKey))) {
    throw error('A stable Prodigi order idempotency key is required.');
  }
  if (path === '/orders' && method === 'POST' && body?.submit !== false) throw error('Create a draft before requesting submission.');
  const headers = {'X-API-Key': config.PRODIGI_SANDBOX_API_KEY, Accept: 'application/json'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let response;
  try {
    response = await request(`${BASE_URL}${path}`, {method, headers,
      ...(body !== undefined ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(20000), redirect:'error'});
  } catch {
    throw error('Prodigi could not be reached. Reconcile the order before retrying.', 'PRODIGI_NETWORK_ERROR', 502);
  }
  let payload;
  try { payload = await response.json(); } catch { throw error('Prodigi returned an invalid response.', 'PRODIGI_INVALID_RESPONSE', 502); }
  if (!response.ok) {
    // Supplier messages can echo payloads or credentials. Return only selected
    // operational metadata; never expose arbitrary remote text to clients/logs.
    const details = {providerStatus: response.status, correlationId: response.headers?.get?.('X-Correlation-Id') || null,
      retryAfter: response.headers?.get?.('Retry-After') || null};
    throw new AppError(response.status === 429 ? 'Prodigi rate limit reached. Retry after the specified delay.' : 'Prodigi rejected the request. Review the product, artwork and destination.',
      502, 'PRODIGI_REQUEST_FAILED', details);
  }
  if (payload?.data === undefined || payload.data === null) throw error('Prodigi returned an incomplete response.', 'PRODIGI_INVALID_RESPONSE', 502);
  return payload.data;
}

export const prodigiVariant = (sku, request = fetch, config = process.env) => prodigiRequest(`/catalogue/variants/${validIdentifier(sku, 'SKU')}`, {}, request, config);
export const prodigiQuote = (payload, request = fetch, config = process.env) => prodigiRequest('/quotes/order', {method: 'POST', body: payload}, request, config);
export const getProdigiOrder = (id, request = fetch, config = process.env) => prodigiRequest(`/orders/${validIdentifier(id, 'order ID')}`, {}, request, config);
export const prodigiShipments = (id, request = fetch, config = process.env) => prodigiRequest(`/orders/${validIdentifier(id, 'order ID')}/shipments`, {}, request, config);
export const submitProdigiOrder = (id, request = fetch, config = process.env) => prodigiRequest(`/orders/${validIdentifier(id, 'order ID')}:submit`, {method: 'POST'}, request, config);
export const cancelProdigiOrder = (id, request = fetch, config = process.env) => prodigiRequest(`/orders/${validIdentifier(id, 'order ID')}:cancel`, {method: 'POST'}, request, config);

export function createProdigiDraft(payload, idempotencyKey, request = fetch, config = process.env) {
  if (payload?.submit === true) throw error('Automatic submission is not permitted.');
  if (!Array.isArray(payload?.items) || !payload.items.length || payload.items.length > 100) throw error('Provide between one and 100 order items.');
  for (const item of payload.items) {
    validIdentifier(item.sku, 'SKU');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw error('Invalid item quantity.');
    if (!Array.isArray(item.assets) || !item.assets.length || item.assets.length > 10) throw error('Print-ready artwork URLs are required.');
    for (const asset of item.assets) {
      let url;
      try { url = new URL(asset.url); } catch { throw error('Invalid artwork URL.'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw error('Artwork must use a secure public URL.');
      if (typeof asset.printArea !== 'string' || !asset.printArea || asset.printArea.length > 50) throw error('A verified print area is required.');
    }
  }
  return prodigiRequest('/orders', {method: 'POST', body: {...payload, submit: false}, idempotencyKey}, request, config);
}

// Decimal-string parsing avoids binary float rounding and rejects wrong currencies.
export function prodigiMoneyCents(money, currency = 'USD') {
  if (money?.currency !== currency || typeof money?.amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(money.amount)) throw error('Invalid Prodigi quote currency or amount.');
  const [whole, fraction = ''] = money.amount.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw error('Prodigi quote exceeds the supported amount.');
  return Number(cents);
}

export function verifyProdigiSignature(raw, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || typeof header !== 'string' || typeof secret !== 'string' || secret.length < 16) return false;
  const pairs = header.split(',').map(part => part.trim().split('='));
  const timestamps = pairs.filter(([key]) => key === 't');
  const signatures = pairs.filter(([key]) => key === 'v1').map(([,value]) => value);
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0][1] || '')) return false;
  const timestamp = timestamps[0][1];
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  return signatures.some(signature => /^[a-fA-F0-9]{64}$/.test(signature || '') && timingSafeEqual(expected, Buffer.from(signature, 'hex')));
}

// Catalogue dimensions are measurements, not guessed trim/bleed metadata.
// An operator must record an independently reviewed supplier template before
// marking a product production-ready. Keep that review alongside the SKU.
export function printSpecFromVariant(variant, review = {}) {
  const missing = [];
  const areas = (variant?.printAreas || []).map(area => {
    const widthMm = Number(area.widthMm), heightMm = Number(area.heightMm), dpi = Number(area.recommendedDpi);
    const valid = widthMm > 0 && heightMm > 0 && Number.isInteger(dpi) && dpi > 0 && dpi <= 1200;
    if (!valid) missing.push(`print_area_dimensions:${area.name || 'unknown'}`);
    return {name: area.name, required: area.required === true, widthMm: valid ? widthMm : null,
      heightMm: valid ? heightMm : null, dpi: valid ? dpi : null,
      widthPx: valid ? Math.ceil(widthMm / 25.4 * dpi) : null,
      heightPx: valid ? Math.ceil(heightMm / 25.4 * dpi) : null};
  });
  if (!areas.length) missing.push('print_areas');
  if (!review.templateUrl || !/^https:\/\//.test(review.templateUrl)) missing.push('supplier_template');
  if (!review.reviewedAt || !review.reviewedBy) missing.push('template_review');
  for (const area of areas) {
    const spec = review.areas?.[area.name];
    if (!spec || !Number.isFinite(spec.bleedMm) || spec.bleedMm < 0 || !Number.isFinite(spec.safeInsetMm) || spec.safeInsetMm < 0 || !spec.colorProfile) missing.push(`bleed_safe_color:${area.name}`);
  }
  return {sku: variant?.sku || variant?.id || null, areas, ready: missing.length === 0, missing};
}
