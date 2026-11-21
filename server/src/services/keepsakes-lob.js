import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts} from '@napi-rs/canvas';
import sharp from 'sharp';
import {AppError} from '../utils/errors.js';
import {normalizeUsMailAddress} from '../../../shared/us-mail-address.js';
import {renderPhoto} from './lob-print-ready-service.js';

const WIDTH = 1875, HEIGHT = 1275, SAFE = 37;
const fontReady = GlobalFonts.registerFromPath(fileURLToPath(new URL('../assets/postcard-fonts/LiberationSans-Regular.ttf', import.meta.url)), 'LolaKeepsakesMessage');
const fail = (message, code = 'KEEPSAKES_LOB_INVALID', status = 422, details) => {throw new AppError(message, status, code, details);};

function assertSandbox(config) {
  const environment = config.APP_ENV || config.NODE_ENV;
  if (!['staging', 'development', 'test'].includes(environment) || config.APP_ENV === 'production'
      || config.LOB_STAGING_TEST_ENABLED !== 'true' || !/^test_[A-Za-z0-9]+$/.test(config.LOB_TEST_API_KEY || '')) {
    fail('Guest postcard fulfillment requires the explicitly enabled Lob sandbox and a test secret key.', 'KEEPSAKES_LOB_SANDBOX_REQUIRED', 403);
  }
}

async function backCanvas(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 18 * 1024 * 1024) fail('Approved postcard back bytes are required.');
  try {
    const metadata = await sharp(bytes, {limitInputPixels: 10_000_000}).metadata();
    if (!['png', 'jpeg'].includes(metadata.format) || (metadata.pages ?? 1) !== 1 || metadata.width !== WIDTH || metadata.height !== HEIGHT
        || metadata.orientation && metadata.orientation !== 1) fail('The approved back must be an upright 1875 × 1275 image. Review its layout before use.', 'KEEPSAKES_LOB_BACK_SPEC');
    return sharp(bytes, {limitInputPixels: 10_000_000}).flatten({background: '#ffffff'}).removeAlpha();
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail('The approved postcard back could not be decoded.', 'KEEPSAKES_LOB_BACK_SPEC');
  }
}

export function validateKeepsakesMessageZone(zone) {
  if (!zone || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(zone[key]))
      || zone.x < SAFE || zone.y < SAFE || zone.width < 100 || zone.height < 80
      || zone.x + zone.width > 900 || zone.y + zone.height > HEIGHT - SAFE) {
    fail('Configure an approved blank message area on the left of the postcard, inside its safe margin.', 'MESSAGE_ZONE_REQUIRED');
  }
  return {x: zone.x, y: zone.y, width: zone.width, height: zone.height};
}

function wrapMessage(message, context, maxWidth) {
  const lines = [];
  for (const paragraph of message.split('\n')) {
    if (!paragraph) {lines.push(''); continue;}
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {line = candidate; continue;}
      if (line) {lines.push(line); line = '';}
      // Long words are wrapped, never truncated. Canvas text rendering treats
      // angle brackets and XML entities literally; no guest text enters SVG.
      for (const {segment} of new Intl.Segmenter('en', {granularity: 'grapheme'}).segment(word)) {
        if (context.measureText(segment).width > maxWidth) fail('This message does not fit the approved message area.', 'MESSAGE_ZONE_REQUIRED');
        if (context.measureText(line + segment).width > maxWidth) {lines.push(line); line = '';}
        line += segment;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Preserve the approved composition exactly; only a configured blank left-side
 * message zone is drawn upon. No resize, brand relocation or guessed text area.
 * An empty message requires no zone. Output is always full-resolution PNG.
 */
export async function renderKeepsakesPostcardBack({bytes, message = '', messageZone, zone} = {}) {
  const canvas = await backCanvas(bytes);
  if (typeof message !== 'string' || message.length > 600 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)) fail('The postcard message is invalid.');
  const text = message.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  if (!text) return canvas.png({compressionLevel: 9}).toBuffer();
  const area = validateKeepsakesMessageZone(messageZone || zone);
  if (!fontReady) fail('The licensed postcard message font is unavailable.', 'KEEPSAKES_LOB_FONT_UNAVAILABLE', 503);
  const pixels = await canvas.clone().extract({left: area.x, top: area.y, width: area.width, height: area.height}).raw().toBuffer();
  // Text may not erase brand art or an existing message. Only an explicitly
  // approved, genuinely blank light area is compatible with personalization.
  if (pixels.some(value => value < 245)) fail('The configured message area contains artwork. Choose an approved blank area.', 'MESSAGE_ZONE_REQUIRED');
  const image = createCanvas(area.width, area.height), context = image.getContext('2d');
  context.font = '40px LolaKeepsakesMessage';
  context.fillStyle = '#26221d'; context.textBaseline = 'top';
  const padding = 12, lineHeight = 52;
  const lines = wrapMessage(text, context, area.width - padding * 2);
  if (lines.length * lineHeight > area.height - padding * 2) fail('The complete message does not fit the approved area. Shorten it or choose a larger approved zone.', 'MESSAGE_ZONE_REQUIRED');
  lines.forEach((line, index) => context.fillText(line, padding, padding + index * lineHeight));
  return canvas.composite([{input: image.toBuffer('image/png'), left: area.x, top: area.y}]).png({compressionLevel: 9}).toBuffer();
}

export function keepsakesLobAddress(address) {
  const normalized = normalizeUsMailAddress({name: address?.name, address_line1: address?.address1, address_line2: address?.address2,
    address_city: address?.city, address_state: address?.state, address_zip: address?.zip, address_country: address?.country});
  if (!normalized || normalized.name.length > 40 || normalized.address_line1.length > 64 || normalized.address_line2.length > 64) {
    fail('A complete US recipient and return address within Lob field limits are required.', 'KEEPSAKES_LOB_ADDRESS');
  }
  return normalized;
}

const safeText = value => typeof value === 'string' ? value.slice(0, 200) : null;
function postcardResult(value, expectedId) {
  if (!/^psc_[a-zA-Z0-9]+$/.test(value?.id || '') || expectedId && value.id !== expectedId) fail('The Lob sandbox response could not be reconciled.', 'KEEPSAKES_LOB_RESPONSE_INVALID', 502, {outcomeUnknown: true, retryable: false});
  // Preserve provider status values verbatim without returning private addresses,
  // prices, provider failure messages or any submitted metadata to the browser.
  return {id: value.id, status: safeText(value.status) || 'processed', send_date: safeText(value.send_date), expected_delivery_date: safeText(value.expected_delivery_date),
    date_created: safeText(value.date_created), date_modified: safeText(value.date_modified),
    tracking_events: Array.isArray(value.tracking_events) ? value.tracking_events.slice(0, 100).map(event => ({id: safeText(event.id), type: safeText(event.type), name: safeText(event.name), time: safeText(event.time)})) : [],
    failure_code: safeText(value.failure_reason?.error_code || value.failure_reason?.code)};
}

async function lobRequest(path, options, request, config, expectedId) {
  let response;
  try {
    response = await request(`https://api.lob.com/v1/${path}`, {...options, headers: {Authorization: 'Basic ' + Buffer.from(`${config.LOB_TEST_API_KEY}:`).toString('base64'), ...options.headers}, signal: AbortSignal.timeout(45000), redirect: 'error'});
  } catch {
    fail('Lob sandbox outcome is unconfirmed. Reconcile provider history before retrying.', 'KEEPSAKES_LOB_OUTCOME_UNKNOWN', 502, {outcomeUnknown: true, retryable: false});
  }
  if (!response.ok) {
    const uncertain = response.status >= 500;
    fail(uncertain ? 'Lob sandbox outcome is unconfirmed. Reconcile provider history before retrying.' : 'Lob rejected the sandbox request. Review artwork, address and account settings.',
      uncertain ? 'KEEPSAKES_LOB_OUTCOME_UNKNOWN' : 'KEEPSAKES_LOB_REJECTED', 502, {providerStatus: response.status, outcomeUnknown: uncertain, retryable: false});
  }
  let value;
  try {value = await response.json();} catch {fail('The Lob sandbox response could not be read. Reconcile before retrying.', 'KEEPSAKES_LOB_OUTCOME_UNKNOWN', 502, {outcomeUnknown: true, retryable: false});}
  return postcardResult(value, expectedId);
}

/** One paid retail postcard per persisted recipient/copy reservation. Caller
 * verifies Stripe payment and stores the idempotency key BEFORE calling this.
 * Lob keys expire after 24 hours: ambiguous older attempts require operator
 * reconciliation, never a fresh key or an automatic replay.
 */
export async function sendKeepsakesLob({idempotencyKey, front, back, to, from, quantity = 1} = {}, request = fetch, config = process.env) {
  assertSandbox(config);
  if (quantity !== 1) fail('Persist a separate recipient/copy reservation for each postcard.', 'KEEPSAKES_LOB_QUANTITY');
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(idempotencyKey)) fail('A persisted postcard idempotency key is required.', 'KEEPSAKES_LOB_IDEMPOTENCY');
  const recipient = keepsakesLobAddress(to), sender = keepsakesLobAddress(from);
  if (!Buffer.isBuffer(front) || !front.length || front.length > 18 * 1024 * 1024) fail('Print-resolution front artwork bytes are required.', 'KEEPSAKES_LOB_FRONT_SPEC');
  const frontPng = await renderPhoto(front), backPng = await (await backCanvas(back)).png({compressionLevel: 9}).toBuffer();
  if (frontPng.length + backPng.length > 4_800_000) fail('The complete print files exceed the safe Lob upload budget.', 'KEEPSAKES_LOB_ARTWORK_SIZE');
  const form = new FormData();
  for (const [prefix, address] of [['to', recipient], ['from', sender]]) for (const [key, value] of Object.entries(address)) if (value) form.append(`${prefix}[${key}]`, value);
  form.append('size', '4x6'); form.append('mail_type', 'usps_first_class'); form.append('use_type', 'operational');
  form.append('description', 'The Lola Keepsakes guest-purchased postcard · sandbox');
  form.append('metadata[keepsakes_reservation]', idempotencyKey);
  form.append('front', new Blob([frontPng], {type: 'image/png'}), 'keepsakes-front.png');
  form.append('back', new Blob([backPng], {type: 'image/png'}), 'keepsakes-approved-back.png');
  return lobRequest('postcards', {method: 'POST', headers: {'Idempotency-Key': idempotencyKey}, body: form}, request, config);
}

export async function reconcileKeepsakesLob(id, request = fetch, config = process.env) {
  assertSandbox(config);
  if (!/^psc_[a-zA-Z0-9]+$/.test(id || '')) fail('A persisted Lob postcard reference is required.', 'KEEPSAKES_LOB_REFERENCE');
  return lobRequest(`postcards/${encodeURIComponent(id)}`, {method: 'GET'}, request, config, id);
}
