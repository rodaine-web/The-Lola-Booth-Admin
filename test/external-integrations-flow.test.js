import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../server/src/db/pool.js';
import { env } from '../server/src/config/env.js';
import { digest } from '../server/src/services/external-provider-security.js';
import { encryptSecretJson } from '../server/src/services/integration-secrets.js';
import { startOAuth, finishOAuth, connectionView, queueExternal, selectAccount, disconnect, withCredentials } from '../server/src/services/external-connections-service.js';
import { receiveExternalWebhook } from '../server/src/services/external-webhooks-service.js';
import { dispatchExternalJob } from '../server/src/services/external-integration-jobs.js';
import { processIntegrationJobs } from '../server/src/services/integration-jobs-service.js';
const actor = crypto.randomUUID(),
  id = crypto.randomUUID(),
  generation = crypto.randomUUID(),
  req = {
    user: {
      id: actor
    },
    headers: {},
    ip: '127.0.0.1'
  };
function row(provider = 'GA4') {
  return {
    id,
    provider,
    status: 'CONNECTED',
    encrypted_credentials: encryptSecretJson({
      access_token: 'test-secret-token',
      refresh_token: 'test-refresh'
    }),
    connection_generation: generation,
    metadata: {
      property_id: '123',
      property_name: 'LOLA QA',
      primary_inquiry_event: 'generate_lead',
      needs_selection: false
    },
    scopes: [],
    provider_account_id: '123'
  };
}
function db(t, handle) {
  const calls = [];
  const run = async (sql, args = []) => {
    calls.push({
      sql,
      args
    });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return {
      rows: [],
      rowCount: 0
    };
    const rows = (await handle(sql, args)) || [];
    return {
      rows,
      rowCount: rows.length
    };
  };
  t.mock.method(pool, 'query', run);
  t.mock.method(pool, 'connect', async () => ({
    query: run,
    release() {}
  }));
  return calls;
}
function googleConfig() {
  Object.assign(process.env, {
    INTEGRATION_SECRET_KEY: 'test-only-encryption-secret-at-least32',
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_ANALYTICS_REDIRECT_URI: 'https://example.invalid/api/integrations/google-analytics/callback'
  });
}
test('OAuth stores hashes/browser binding; expired, reused or wrong-browser callbacks cannot exchange tokens', async t => {
  googleConfig();
  let stored;
  db(t, async (sql, args) => {
    if (sql.startsWith('SELECT * FROM integration_connections')) return [row()];
    if (sql.startsWith('INSERT INTO integration_oauth_states')) stored = {
      state_hash: args[0],
      provider: args[1],
      actor_id: args[2],
      browser_hash: args[3],
      verifier_encrypted: args[4],
      redirect_uri: args[5],
      generation: args[6]
    };
    if (sql.startsWith('SELECT * FROM integration_oauth_states')) return stored ? [stored] : [];
    return [];
  });
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls++;
    throw Error('Must not exchange');
  });
  const started = await startOAuth('GA4', req);
  assert.equal(stored.state_hash, digest(started.state));
  assert.ok(!JSON.stringify(stored).includes(started.browser));
  assert.ok(!JSON.stringify(stored.verifier_encrypted).includes('verifier'));
  await assert.rejects(() => finishOAuth('GA4', {
    state: started.state,
    browser: 'wrong-browser',
    code: 'test-code'
  }, req), e => e.code === 'OAUTH_STATE_INVALID');
  stored = null;
  await assert.rejects(() => finishOAuth('GA4', {
    state: started.state,
    browser: started.browser,
    code: 'test-code'
  }, req), e => e.code === 'OAUTH_STATE_INVALID');
  assert.equal(fetchCalls, 0);
});
test('successful OAuth persists encrypted credentials, consumes state and exposes selection-required status', async t => {
  googleConfig();
  let stored,
    saved,
    consumed = false;
  db(t, async (sql, args) => {
    if (sql.startsWith('SELECT * FROM integration_connections')) return [row()];
    if (sql.startsWith('INSERT INTO integration_oauth_states')) stored = {
      state_hash: args[0],
      provider: 'GA4',
      actor_id: actor,
      browser_hash: args[3],
      verifier_encrypted: args[4],
      redirect_uri: args[5],
      generation
    };
    if (sql.startsWith('SELECT * FROM integration_oauth_states')) return consumed ? [] : [stored];
    if (sql.startsWith('SELECT u.id')) return [{
      id: actor
    }];
    if (sql.startsWith('UPDATE integration_oauth_states')) consumed = true;
    if (sql.includes('SET encrypted_credentials=$1,provider_account_id')) {
      saved = args[0];
      return [{
        ...row(),
        status: 'DEGRADED',
        metadata: {
          needs_selection: true
        },
        encrypted_credentials: saved
      }];
    }
    return [];
  });
  const started = await startOAuth('GA4', req);
  const fetcher = async url => new Response(JSON.stringify(url.includes('oauth2') ? {
    access_token: 'test-secret-token',
    refresh_token: 'test-refresh',
    expires_in: 3600
  } : {
    accountSummaries: [{
      account: 'accounts/1',
      propertySummaries: [{
        property: 'properties/123',
        displayName: 'LOLA'
      }]
    }]
  }), {
    status: 200
  });
  const result = await finishOAuth('GA4', {
    state: started.state,
    browser: started.browser,
    code: 'test-code'
  }, req, {
    fetcher
  });
  assert.equal(result.status, 'DEGRADED');
  assert.ok(!JSON.stringify(result).includes('test-secret-token'));
  assert.ok(!JSON.stringify(saved).includes('test-secret-token'));
  await assert.rejects(() => finishOAuth('GA4', {
    state: started.state,
    browser: started.browser,
    code: 'test-code'
  }, req, {
    fetcher
  }), e => e.code === 'OAUTH_STATE_INVALID');
});
test('account selection cannot select a property outside the OAuth account', async t => {
  db(t, async sql => sql.startsWith('SELECT * FROM integration_connections') ? [row()] : []);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    accountSummaries: [{
      account: 'accounts/1',
      propertySummaries: [{
        property: 'properties/123',
        displayName: 'LOLA'
      }]
    }]
  }), {
    status: 200
  }));
  await assert.rejects(() => selectAccount('GA4', 'unauthorized', req), e => e.code === 'PROVIDER_ACCOUNT_DENIED');
});
test('near-expiry Google credentials refresh with stored refresh token and remain encrypted', async t => {
  let refreshed;
  db(t, async (sql, args) => {
    if (sql.startsWith('SELECT * FROM integration_connections')) return [{
      ...row(),
      access_token_expires_at: new Date(Date.now() - 1000)
    }];
    if (sql.includes('SET encrypted_credentials=$1,access_token_expires_at')) refreshed = args[0];
    return [];
  });
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(opts.body.get('refresh_token'), 'test-refresh');
    return new Response(JSON.stringify({
      access_token: 'new-test-token',
      expires_in: 3600
    }), {
      status: 200
    });
  });
  await withCredentials('GA4', async (_r, tokens) => assert.equal(tokens.access_token, 'new-test-token'));
  assert.ok(!JSON.stringify(refreshed).includes('new-test-token'));
});
test('signed Meta delivery persists and queues idempotently; invalid delivery never hits database', async t => {
  process.env.META_CLIENT_SECRET = 'test-meta-secret';
  const meta = {
    ...row('META'),
    metadata: {
      page_id: 'page-1'
    },
    provider_account_id: 'page-1'
  };
  let queued = 0;
  const calls = db(t, async sql => {
    if (sql.startsWith('SELECT * FROM integration_connections')) return [meta];
    if (sql.startsWith('INSERT INTO webhook_events')) return [{
      id: 'webhook-test',
      status: 'RECEIVED'
    }];
    if (sql.startsWith('INSERT INTO integration_jobs')) {
      queued++;
      return [{
        id: 'job-test',
        status: 'QUEUED'
      }];
    }
    return [];
  });
  const body = Buffer.from(JSON.stringify({
      entry: [{
        id: 'page-1',
        changes: [{
          field: 'leadgen',
          value: {
            leadgen_id: 'lead-1',
            form_id: 'form-1'
          }
        }]
      }]
    })),
    signature = 'sha256=' + crypto.createHmac('sha256', 'test-meta-secret').update(body).digest('hex');
  await assert.rejects(() => receiveExternalWebhook('META', body, {}), e => e.code === 'WEBHOOK_SIGNATURE_INVALID');
  assert.equal(calls.length, 0);
  const r = await receiveExternalWebhook('META', body, {
    'x-hub-signature-256': signature
  });
  assert.equal(r.events, 1);
  assert.equal(queued, 1);
  assert.ok(calls.find(c => c.sql.startsWith('INSERT INTO integration_jobs')).sql.includes('ON CONFLICT(idempotency_key)'));
  assert.equal(calls.find(c => c.sql.startsWith('INSERT INTO webhook_events')).args[2], 'lead-1');
});
test('disconnect deletes local credentials, invalidates callbacks/caches and cancels queued work', async t => {
  const calls = db(t, async sql => sql.startsWith('SELECT * FROM integration_connections') ? [row()] : []);
  await disconnect('GA4', req);
  assert.ok(calls.some(c => c.sql.includes('encrypted_credentials=NULL') && c.sql.includes('connection_generation=gen_random_uuid()')));
  assert.ok(calls.some(c => c.sql.includes("mode='EXTERNAL' AND status='QUEUED'")));
  assert.ok(calls.some(c => c.sql.includes('UPDATE integration_oauth_states SET consumed_at')));
  assert.ok(!JSON.stringify(connectionView(row())).includes('test-secret-token'));
});
test('old-account jobs are cancelled before any provider operation', async t => {
  db(t, async sql => sql.startsWith('SELECT * FROM integration_connections') ? [row()] : []);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw Error('Forbidden');
  });
  const result = await dispatchExternalJob({
    provider: 'GA4',
    event_name: 'REPORT_REFRESH',
    payload: {
      generation: 'old-generation'
    }
  });
  assert.equal(result.result, 'DISABLED');
  assert.equal(calls, 0);
});
test('worker retries transient provider failure using exponential backoff and records sanitized attempt', async t => {
  const job = {
    id,
    provider: 'GA4',
    event_name: 'REPORT_REFRESH',
    mode: 'EXTERNAL',
    entity_type: 'integration_connection',
    payload: {
      generation
    },
    status: 'PROCESSING',
    attempts: 2
  };
  const calls = db(t, async sql => {
    if (sql.startsWith('SELECT * FROM integration_jobs WHERE status')) return [job];
    if (sql.includes("SET status='PROCESSING'")) return [job];
    if (sql.startsWith('SELECT * FROM integration_jobs WHERE id')) return [job];
    if (sql.startsWith('SELECT * FROM integration_connections')) return [row()];
    return [];
  });
  const old = env.nodeEnv;
  env.nodeEnv = 'test';
  try {
    await processIntegrationJobs({
      limit: 1,
      dispatch: async () => {
        const e = Error('never log test token');
        e.retryable = true;
        e.code = 'PROVIDER_RATE_LIMIT';
        throw e;
      }
    });
  } finally {
    env.nodeEnv = old;
  }
  const retry = calls.find(c => c.sql.includes('available_at=now()+($4'));
  assert.equal(retry.args[1], 'QUEUED');
  assert.equal(retry.args[3], 120);
  assert.ok(!JSON.stringify(calls).includes('never log test token'));
});
import { syncMailchimp, refreshAnalytics, reportKey } from '../server/src/services/external-reporting-service.js';
import { processMailchimpEvent, processSocialEvent } from '../server/src/services/external-webhooks-service.js';
import { ingestProviderLead } from '../server/src/services/social-lead-service.js';
test('Mailchimp worker skips provider opt-outs and uses stable member upserts for eligible CRM contacts', async t => {
  const contacts = [{
    email: 'new@example.invalid',
    first_name: 'New',
    lifecycle: 'NEW'
  }, {
    email: 'optout@example.invalid',
    first_name: 'Stop',
    lifecycle: 'CLIENT'
  }];
  const writes = [];
  db(t, async sql => sql.startsWith('WITH contacts AS') ? contacts : []);
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (url.includes('/tags')) return new Response('{}', {
      status: 200
    });
    if (opts.method === 'PUT') {
      writes.push(JSON.parse(opts.body));
      return new Response('{}', {
        status: 200
      });
    }
    if (url.includes(crypto.createHash('md5').update('optout@example.invalid').digest('hex'))) return new Response('{"status":"unsubscribed"}', {
      status: 200
    });
    return new Response('{}', {
      status: 404
    });
  });
  const r = await syncMailchimp({
    ...row('MAILCHIMP'),
    metadata: {
      audience_id: 'list1'
    }
  }, {
    access_token: 'test',
    dc: 'us21'
  }, {
    id,
    payload: {}
  });
  assert.equal(r.records_created, 1);
  assert.equal(r.records_skipped, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].email_address, 'new@example.invalid');
  assert.equal(writes[0].status_if_new, 'subscribed');
});
test('Mailchimp unsubscribe updates marketing only, suppresses native campaigns and never disables transactional mail', async t => {
  const calls = db(t, async () => []);
  await processMailchimpEvent({
    ...row('MAILCHIMP'),
    metadata: {
      audience_id: 'list1'
    }
  }, {}, {
    payload: {
      type: 'unsubscribe',
      data: {
        list_id: 'list1',
        email: 'PERSON@example.invalid'
      }
    }
  });
  assert.equal(calls.filter(c => c.sql.includes('SET marketing_email_opt_in=false')).length, 2);
  assert.ok(calls.some(c => c.sql.includes('INSERT INTO campaign_suppressions')));
  assert.ok(!calls.some(c => /transactional|email_opt_out|email_opted_out/.test(c.sql)));
});
test('Mailchimp subscribe evidence cannot silently undo an existing opt-out', async t => {
  const calls = db(t, async () => []);
  t.mock.method(globalThis, 'fetch', async () => new Response('{"status":"subscribed"}', {
    status: 200
  }));
  await processMailchimpEvent({
    ...row('MAILCHIMP'),
    metadata: {
      audience_id: 'list1'
    }
  }, {
    access_token: 'test',
    dc: 'us21'
  }, {
    payload: {
      type: 'subscribe',
      data: {
        list_id: 'list1',
        email: 'person@example.invalid'
      }
    }
  });
  assert.ok(!calls.some(c => c.sql.includes('marketing_email_opt_in=true') || c.sql.includes('DELETE FROM campaign_suppressions')));
});
test('GA refresh combines actual provider metrics with aggregate CRM attribution and saves a dated cache', async t => {
  let cache;
  db(t, async (sql, args) => {
    if (sql.startsWith('SELECT COALESCE(utm_campaign')) return [{
      campaign: 'wedding',
      source: 'mailchimp',
      medium: 'email',
      inquiries: 2
    }];
    if (sql.startsWith('INSERT INTO integration_report_cache')) cache = args[2];
    return [];
  });
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.match(url, /analyticsdata.googleapis.com/);
    const body = JSON.parse(opts.body),
      dimensions = body.dimensions.map(x => x.name),
      metrics = body.metrics.map(x => x.name);
    const values = {
        activeUsers: '10',
        sessions: '20',
        engagedSessions: '15',
        engagementRate: '.75',
        keyEvents: '3',
        sessionKeyEventRate: '.15',
        eventCount: '4',
        screenPageViews: '30'
      },
      dim = {
        sessionCampaignName: 'wedding',
        sessionSource: 'mailchimp',
        sessionMedium: 'email',
        sessionDefaultChannelGroup: 'Email',
        date: '20261001',
        landingPagePlusQueryString: '/weddings',
        pagePath: '/weddings',
        sessionManualAdContent: 'partner'
      };
    return new Response(JSON.stringify({
      dimensionHeaders: dimensions.map(name => ({
        name
      })),
      metricHeaders: metrics.map(name => ({
        name
      })),
      rows: [{
        dimensionValues: dimensions.map(name => ({
          value: dim[name]
        })),
        metricValues: metrics.map(name => ({
          value: values[name]
        }))
      }]
    }), {
      status: 200
    });
  });
  const dates = {
    startDate: '2026-10-01',
    endDate: '2026-10-06',
    timeZone: 'America/Chicago'
  };
  await refreshAnalytics(row(), {
    access_token: 'test'
  }, {
    dates,
    event: 'generate_lead',
    cache_key: reportKey(dates, 'generate_lead')
  });
  assert.equal(cache.summary.sessions, 20);
  assert.equal(cache.campaigns[0].crmInquiries, 2);
  assert.equal(cache.campaigns[0].crmConversionRate, .1);
  assert.equal(cache.campaigns[0].inquiryEvents, 4);
  assert.match(cache.attributionNote, /not by person/);
});
test('new social form for an existing email records activity without creating a second lead/task or rerun welcome automation', async t => {
  const calls = db(t, async sql => {
    if (sql.includes('SELECT ifm.field_map')) return [];
    if (sql.startsWith('SELECT id FROM leads WHERE provider=')) return [];
    if (sql.includes('SELECT id FROM leads') && sql.includes('normalized_email')) return [{
      id
    }];
    return [];
  });
  const r = await ingestProviderLead({
    provider: 'META',
    payload: {
      email: 'same@example.invalid',
      first_name: 'Same',
      external_lead_id: 'new-provider-id'
    },
    sourceSubtype: 'INSTAGRAM'
  });
  assert.equal(r.action, 'ATTACHED_TO_EXISTING');
  assert.equal(r.lead.id, id);
  assert.ok(!calls.some(c => c.sql.startsWith('INSERT INTO leads') || c.sql.startsWith('INSERT INTO tasks') || c.sql.startsWith('INSERT INTO automation_events')));
  assert.ok(calls.some(c => c.sql.includes('pg_advisory_xact_lock')));
});
test('Mailchimp batch continues past invalid member data and reports a partial failure', async t => {
  db(t, async sql => sql.startsWith('WITH contacts AS') ? [{
    email: 'invalid@example.invalid',
    first_name: 'Invalid',
    lifecycle: 'NEW'
  }, {
    email: 'valid@example.invalid',
    first_name: 'Valid',
    lifecycle: 'NEW'
  }] : []);
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      writes.push(body.email_address);
      return new Response('{}', {
        status: body.email_address.startsWith('invalid') ? 400 : 200
      });
    }
    if (url.includes('/tags')) return new Response('{}', {
      status: 200
    });
    return new Response('{}', {
      status: 404
    });
  });
  const r = await syncMailchimp({
    ...row('MAILCHIMP'),
    metadata: {
      audience_id: 'list1'
    }
  }, {
    access_token: 'test',
    dc: 'us21'
  }, {
    id,
    payload: {}
  });
  assert.equal(r.records_failed, 1);
  assert.equal(r.records_created, 1);
  assert.equal(r.records_processed, 2);
  assert.deepEqual(writes, ['invalid@example.invalid', 'valid@example.invalid']);
});
