import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
export const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')),
    y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function redactProvider(value) {
  if (Array.isArray(value)) return value.map(redactProvider);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !/(token|secret|password|authorization|cookie|credential|signature|code_verifier)/i.test(k)).map(([k, v]) => [k, redactProvider(v)]));
  return value;
}
export function verifyMeta(body, signature, secret) {
  return Boolean(secret && sameSecret(signature, `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`));
}
// TikTok's documented t/s envelope signs timestamp + '.' + exact request bytes.
export function verifyTikTok(body, signature, secret, now = Date.now()) {
  const fields = Object.fromEntries(String(signature || '').split(',').map(x => x.trim().split('=')));
  if (!secret || !/^\d+$/.test(fields.t || '') || Math.abs(now / 1000 - Number(fields.t)) > 300) return false;
  return sameSecret(fields.s, crypto.createHmac('sha256', secret).update(`${fields.t}.`).update(body).digest('hex'));
}
export function verifyMailchimp(body, signature, secret, now = Date.now()) {
  const fields = Object.fromEntries(String(signature || '').split(',').map(x => x.trim().split('=')));
  if (!secret || !/^\d+$/.test(fields.t || '') || Math.abs(now / 1000 - Number(fields.t)) > 300) return false;
  return sameSecret(fields.v1, crypto.createHmac('sha256', secret).update(`${fields.t}.`).update(body).digest('hex'));
}
export function checkedRedirect(value, slug) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('Configure the OAuth callback URL.', 422, 'OAUTH_REDIRECT_REQUIRED');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== `/api/integrations/${slug}/callback` || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new AppError('Use the exact HTTPS OAuth callback URL (localhost is allowed for development).', 422, 'OAUTH_REDIRECT_INVALID');
  return url.toString();
}
export function mailchimpOrigin(dc) {
  if (!/^us\d{1,3}$/.test(dc || '')) throw new AppError('Mailchimp returned an invalid region.', 502, 'PROVIDER_REGION_INVALID');
  return `https://${dc}.api.mailchimp.com/3.0`;
}
export function memberHash(email) {
  return crypto.createHash('md5').update(String(email).trim().toLowerCase()).digest('hex');
}
export function memberUpdate(contact, existing, allowed = ['FNAME', 'LNAME']) {
  // Never set status for an existing contact: provider opt-outs always win.
  return {
    email_address: contact.email.toLowerCase(),
    ...(!existing ? {
      status_if_new: 'subscribed'
    } : {}),
    merge_fields: Object.fromEntries(Object.entries({
      FNAME: contact.first_name || '',
      LNAME: contact.last_name || '',
      COMPANY: contact.company || '',
      PHONE: contact.phone || ''
    }).filter(([key]) => allowed.includes(key)))
  };
}
export async function providerRequest(url, {
  token,
  headers = {},
  body,
  method = 'GET',
  fetcher = fetch
} = {}) {
  let response;
  try {
    response = await fetcher(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json',
        ...(token ? {
          Authorization: `Bearer ${token}`
        } : {}),
        ...(body ? {
          'Content-Type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json'
        } : {}),
        ...headers
      },
      ...(body ? {
        body: body instanceof URLSearchParams ? body : JSON.stringify(body)
      } : {})
    });
  } catch {
    const e = new AppError('The provider could not be reached. Retry shortly.', 502, 'PROVIDER_UNAVAILABLE');
    e.retryable = true;
    throw e;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error || typeof data.code === 'number' && data.code !== 0) {
    const status = data.error === 'invalid_grant' || data.error?.code === 190 ? 401 : response.status;
    const e = new AppError(status === 401 ? 'The provider authorization expired. Reconnect this account.' : status === 403 ? 'The provider denied this operation. Review its permissions.' : status === 429 ? 'The provider rate limit was reached. The worker will retry.' : 'The provider rejected the request.', 502, status === 401 ? 'PROVIDER_AUTH_EXPIRED' : status === 403 ? 'PROVIDER_PERMISSION_DENIED' : status === 429 ? 'PROVIDER_RATE_LIMIT' : status === 404 ? 'PROVIDER_NOT_FOUND' : 'PROVIDER_REJECTED');
    e.retryable = status === 429 || status >= 500;
    e.providerStatus = status;
    throw e;
  }
  return data;
}
