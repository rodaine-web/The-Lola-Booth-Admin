import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyMeta, verifyTikTok, redactProvider, checkedRedirect, mailchimpOrigin, memberHash, memberUpdate, providerRequest } from '../server/src/services/external-provider-security.js';
import { analyticsDates, reportRows } from '../server/src/services/external-reporting-service.js';
import { oauthUrl, exchangeCode } from '../server/src/services/external-provider-adapters.js';
import { encryptSecretJson, decryptSecretJson } from '../server/src/services/integration-secrets.js';
import { requirePermission } from '../server/src/middleware/auth.js';
test('Meta authenticates exact bytes and rejects absent/wrong signatures', () => {
  const body = Buffer.from('{"entry":[]}'),
    secret = 'test-secret';
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.ok(verifyMeta(body, signature, secret));
  assert.ok(!verifyMeta(Buffer.from('{}'), signature, secret));
  assert.ok(!verifyMeta(body, signature, ''));
  assert.ok(!verifyMeta(body, '', secret));
});
test('TikTok authenticates timestamp and body and rejects replay beyond five minutes', () => {
  const t = Math.floor(Date.now() / 1000),
    body = Buffer.from('{}'),
    s = crypto.createHmac('sha256', 'test-secret').update(`${t}.`).update(body).digest('hex');
  assert.ok(verifyTikTok(body, `t=${t},s=${s}`, 'test-secret'));
  assert.ok(!verifyTikTok(body, `t=${t},s=${s}`, 'test-secret', (t + 301) * 1000));
  assert.ok(!verifyTikTok(body, `t=${t},s=invalid`, 'test-secret'));
});
test('secrets remain encrypted and nested credentials never escape redaction', () => {
  const value = {
    access_token: 'not-for-browser',
    refresh_token: 'refresh-value'
  };
  const encrypted = encryptSecretJson(value);
  assert.ok(!JSON.stringify(encrypted).includes('not-for-browser'));
  assert.deepEqual(decryptSecretJson(encrypted), value);
  assert.throws(() => decryptSecretJson({
    ...encrypted,
    tag: Buffer.alloc(16).toString('base64')
  }));
  assert.deepEqual(redactProvider({
    account: 'LOLA',
    nested: {
      access_token: 'bad',
      items: [{
        client_secret: 'bad',
        name: 'ok'
      }]
    }
  }), {
    account: 'LOLA',
    nested: {
      items: [{
        name: 'ok'
      }]
    }
  });
});
test('OAuth callbacks require canonical HTTPS paths and never allow arbitrary redirects', () => {
  assert.equal(checkedRedirect('https://example.invalid/api/integrations/meta/callback', 'meta'), 'https://example.invalid/api/integrations/meta/callback');
  for (const url of ['https://example.invalid/other', 'http://example.invalid/api/integrations/meta/callback', 'https://example.invalid/api/integrations/meta/callback?next=evil', 'https://a:b@example.invalid/api/integrations/meta/callback']) assert.throws(() => checkedRedirect(url, 'meta'));
});
test('Mailchimp host is fixed to a validated region; identifiers normalize email', () => {
  assert.equal(mailchimpOrigin('us21'), 'https://us21.api.mailchimp.com/3.0');
  assert.throws(() => mailchimpOrigin('us21.evil.invalid'));
  assert.equal(memberHash(' Person@Example.com '), memberHash('person@example.com'));
});
test('Mailchimp updates never change an existing unsubscribed or cleaned status', () => {
  for (const status of ['subscribed', 'unsubscribed', 'cleaned', 'pending']) {
    const body = memberUpdate({
      email: 'a@b.com',
      first_name: 'A'
    }, {
      status
    });
    assert.ok(!('status' in body));
    assert.ok(!('status_if_new' in body));
  }
  assert.equal(memberUpdate({
    email: 'a@b.com'
  }, null).status_if_new, 'subscribed');
});
test('provider failures redact bodies and network errors are retryable', async () => {
  await assert.rejects(() => providerRequest('https://example.invalid', {
    fetcher: async () => new Response(JSON.stringify({
      error: 'access-token-leak'
    }), {
      status: 401
    })
  }), e => e.code === 'PROVIDER_AUTH_EXPIRED' && !e.message.includes('leak'));
  await assert.rejects(() => providerRequest('https://example.invalid', {
    fetcher: async () => {
      throw new Error('secret');
    }
  }), e => e.retryable === true && !e.message.includes('secret'));
  await assert.rejects(() => providerRequest('https://example.invalid', {
    fetcher: async () => new Response('{}', {
      status: 429
    })
  }), e => e.code === 'PROVIDER_RATE_LIMIT' && e.retryable);
});
test('website analytics dates use property timezone and validate custom windows', () => {
  const d = analyticsDates({
    range: 'today'
  }, 'America/Chicago', new Date('2026-10-06T02:00:00Z'));
  assert.equal(d.startDate, '2026-10-05');
  assert.equal(d.endDate, '2026-10-05');
  assert.throws(() => analyticsDates({
    range: 'custom',
    from: '2026-02-30',
    to: '2026-03-03'
  }));
  assert.throws(() => analyticsDates({
    range: 'custom',
    from: '2026-10-06',
    to: '2026-10-01'
  }));
  assert.deepEqual(reportRows({
    dimensionHeaders: [{
      name: 'date'
    }],
    metricHeaders: [{
      name: 'sessions'
    }],
    rows: [{
      dimensionValues: [{
        value: '20261006'
      }],
      metricValues: [{
        value: '5'
      }]
    }]
  }), [{
    date: '20261006',
    sessions: 5
  }]);
});
test('read-only integration access cannot connect or sync', () => {
  const next = e => assert.equal(e.code, 'FORBIDDEN');
  requirePermission('write:integrations')({
    user: {
      permissions: ['read:integrations']
    }
  }, {}, next);
  requirePermission('read:integrations')({
    user: {
      permissions: ['read:integrations']
    }
  }, {}, e => assert.equal(e, undefined));
});
test('Google OAuth uses least privilege, PKCE, offline access and fixed callback', () => {
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'test-only-id',
    GOOGLE_CLIENT_SECRET: 'test-only-secret',
    GOOGLE_ANALYTICS_REDIRECT_URI: 'https://example.invalid/api/integrations/google-analytics/callback',
    INTEGRATION_SECRET_KEY: 'test-only-key-with-at-least-32-characters'
  });
  const u = new URL(oauthUrl('GA4', 'state', {
    challenge: 'challenge'
  }));
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/analytics.readonly');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
});
test('Google code exchange sends server secret and PKCE only to fixed token endpoint', async () => {
  let called = false;
  const result = await exchangeCode('GA4', 'auth-code', 'verifier', async (url, opts) => {
    called = true;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(opts.body.get('code_verifier'), 'verifier');
    return new Response(JSON.stringify({
      access_token: 'test-token',
      refresh_token: 'test-refresh',
      expires_in: 3600
    }), {
      status: 200
    });
  });
  assert.ok(called);
  assert.equal(result.refresh_token, 'test-refresh');
});
import { verifyMailchimp } from '../server/src/services/external-provider-security.js';
test('Mailchimp signs exact form bytes and rejects stale or modified deliveries', () => {
  const body = Buffer.from('type=unsubscribe&data%5Bemail%5D=a%40example.invalid'),
    t = Math.floor(Date.now() / 1000),
    secret = 'mc-signing-test',
    sig = crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
  assert.ok(verifyMailchimp(body, `t=${t},v1=${sig}`, secret));
  assert.ok(!verifyMailchimp(Buffer.from(body.toString().replace('unsubscribe', 'subscribe')), `t=${t},v1=${sig}`, secret));
  assert.ok(!verifyMailchimp(body, `t=${t},v1=${sig}`, secret, (t + 301) * 1000));
});
