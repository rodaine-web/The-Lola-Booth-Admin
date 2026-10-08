import crypto from 'node:crypto';
import { query, transaction } from '../db/pool.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit-service.js';
import { createNotification } from './notification-service.js';
import { encryptSecretJson, decryptSecretJson } from './integration-secrets.js';
import { digest, sameSecret, redactProvider } from './external-provider-security.js';
import { EXTERNAL_PROVIDERS, providerSlugs, providerConfig, oauthUrl, exchangeCode, identity, accountOptions, providerApi, refreshGoogle } from './external-provider-adapters.js';
export async function connection(provider) {
  const r = await query("SELECT * FROM integration_connections WHERE category='MARKETING' AND provider=$1 AND deleted_at IS NULL", [provider]);
  if (!r.rows[0]) throw new AppError('Integration not found.', 404, 'NOT_FOUND');
  return r.rows[0];
}
export function connectionView(row) {
  const c = providerConfig(row.provider),
    expired = row.access_token_expires_at && new Date(row.access_token_expires_at) < new Date();
  return {
    id: row.id,
    provider: row.provider,
    slug: providerSlugs[row.provider],
    status: row.status === 'DISCONNECTED' ? 'NOT_CONNECTED' : row.status === 'AWAITING_APPROVAL' ? 'PENDING_APPROVAL' : expired && row.status === 'CONNECTED' ? 'EXPIRED' : row.status,
    account_id: row.provider_account_id,
    account_name: row.connected_account,
    scopes: row.scopes || [],
    metadata: redactProvider(row.metadata || {}),
    token_expires_at: row.access_token_expires_at,
    last_sync_at: row.last_successful_sync_at,
    last_webhook_at: row.last_webhook_at,
    last_error: row.last_error,
    last_error_code: row.last_error_code,
    configured: c.ready,
    approval_pending: !c.approved
  };
}
export async function externalConnections() {
  return (await query("SELECT * FROM integration_connections WHERE category='MARKETING' AND provider=ANY($1::text[]) AND deleted_at IS NULL ORDER BY provider", [EXTERNAL_PROVIDERS])).rows.map(connectionView);
}
async function audit(req, action, row, after = {}) {
  await writeAudit({
    req,
    action,
    entity: 'integration_connection',
    entityId: row.id,
    after: redactProvider({
      provider: row.provider,
      ...after
    })
  });
}
export async function startOAuth(provider, req) {
  const row = await connection(provider),
    state = crypto.randomBytes(32).toString('hex'),
    browser = crypto.randomBytes(32).toString('hex'),
    verifier = crypto.randomBytes(32).toString('base64url');
  const url = oauthUrl(provider, state, {
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url')
  });
  await transaction(async () => {
    await query('DELETE FROM integration_oauth_states WHERE expires_at<now()');
    await query('INSERT INTO integration_oauth_states(state_hash,provider,actor_id,browser_hash,verifier_encrypted,redirect_uri,generation,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'10 minutes\')', [digest(state), provider, req.user.id, digest(browser), encryptSecretJson({
      verifier
    }), providerConfig(provider).redirect, row.connection_generation]);
    // A reconnect leaves the current valid connection usable until the new auth succeeds.
    await query("UPDATE integration_connections SET status=CASE WHEN encrypted_credentials IS NULL THEN 'CONNECTING' ELSE status END,updated_at=now() WHERE id=$1", [row.id]);
  });
  return {
    url,
    browser,
    state
  };
}
export async function finishOAuth(provider, {
  state,
  code,
  browser,
  error
}, req, {
  fetcher
} = {}) {
  if (!/^[a-f0-9]{64}$/.test(state || '') || !browser) throw new AppError('Authorization expired. Start the connection again.', 400, 'OAUTH_STATE_INVALID');
  const s = await transaction(async () => {
    const r = (await query('SELECT * FROM integration_oauth_states WHERE state_hash=$1 AND provider=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE', [digest(state), provider])).rows[0];
    if (!r || !sameSecret(r.browser_hash, digest(browser))) throw new AppError('Authorization expired. Start the connection again.', 400, 'OAUTH_STATE_INVALID');
    const allowed = await query("SELECT u.id FROM users u WHERE u.id=$1 AND u.active=true AND u.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id AND p.key IN ('*','write:integrations')) OR EXISTS(SELECT 1 FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=u.id AND p.key IN ('*','write:integrations')))", [r.actor_id]);
    if (!allowed.rows[0]) throw new AppError('Integration permission is required.', 403, 'FORBIDDEN');
    await query('UPDATE integration_oauth_states SET consumed_at=now() WHERE state_hash=$1', [r.state_hash]);
    return r;
  });
  req = {
    ...req,
    user: {
      id: s.actor_id
    }
  };
  const row = await connection(provider);
  if (s.generation !== row.connection_generation || s.redirect_uri !== providerConfig(provider).redirect) throw new AppError('This connection was changed. Start again.', 409, 'OAUTH_STATE_INVALID');
  if (error || !code) {
    await query("UPDATE integration_connections SET status=CASE WHEN encrypted_credentials IS NULL THEN 'NOT_CONNECTED' ELSE status END,updated_at=now() WHERE id=$1", [row.id]);
    throw new AppError('Provider authorization was not granted.', 400, 'OAUTH_DENIED');
  }
  try {
    const tokens = await exchangeCode(provider, String(code), decryptSecretJson(s.verifier_encrypted).verifier, fetcher);
    if (!tokens?.access_token) throw new AppError('Provider did not return authorization.', 502, 'PROVIDER_AUTH_EXPIRED');
    const account = await identity(provider, tokens, fetcher);
    const scopes = account.scopes || String(tokens.scope || '').split(/[ ,]+/).filter(Boolean);
    const saved = await query("UPDATE integration_connections SET encrypted_credentials=$1,provider_account_id=$2,connected_account=$3,scopes=$4,access_token_expires_at=$5,metadata=$6,status='DEGRADED',verified_at=now(),created_by=$7,connection_generation=gen_random_uuid(),last_error=NULL,last_error_code=NULL,consecutive_failures=0,updated_at=now() WHERE id=$8 AND connection_generation=$9 RETURNING *", [encryptSecretJson(tokens), account.id, account.name, scopes, tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null, JSON.stringify({
      dc: account.dc,
      needs_selection: true,
      primary_inquiry_event: 'generate_lead'
    }), s.actor_id, row.id, s.generation]);
    if (!saved.rowCount) throw new AppError('Connection changed during authorization. Start again.', 409, 'OAUTH_STATE_INVALID');
    await audit(req, row.encrypted_credentials ? 'integration_reconnected' : 'integration_connected', row, {
      account_name: account.name
    });
    return connectionView(saved.rows[0]);
  } catch (e) {
    await integrationFailure(row, e);
    throw e;
  }
}
export async function withCredentials(provider, operation) {
  // Serialize refresh and provider operations with disconnect and reauthorization.
  return transaction(async () => {
    const row = (await query("SELECT * FROM integration_connections WHERE provider=$1 AND category='MARKETING' AND deleted_at IS NULL FOR UPDATE", [provider])).rows[0];
    if (!row?.encrypted_credentials || ['DISABLED', 'NOT_CONNECTED', 'DISCONNECTED', 'CONNECTING'].includes(row.status)) throw new AppError('Connect this provider first.', 422, 'PROVIDER_NOT_CONNECTED');
    let tokens = decryptSecretJson(row.encrypted_credentials);
    if (row.access_token_expires_at && new Date(row.access_token_expires_at).getTime() < Date.now() + 60000) {
      if (provider !== 'GA4') throw new AppError('Reconnect the expired provider account.', 422, 'PROVIDER_AUTH_EXPIRED');
      tokens = {
        ...tokens,
        ...(await refreshGoogle(tokens))
      };
      await query('UPDATE integration_connections SET encrypted_credentials=$1,access_token_expires_at=$2 WHERE id=$3', [encryptSecretJson(tokens), new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000), row.id]);
    }
    return operation(row, tokens);
  });
}
export async function choices(provider) {
  return withCredentials(provider, async (_row, tokens) => (await accountOptions(provider, tokens)).map(({
    page_token,
    ...safe
  }) => safe));
}
export async function selectAccount(provider, id, req) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) throw new AppError('Select an authorized account.', 422, 'INVALID_SELECTION');
  return withCredentials(provider, async (row, tokens) => {
    const selected = (await accountOptions(provider, tokens)).find(x => x.id === id);
    if (!selected) throw new AppError('This account is not authorized.', 403, 'PROVIDER_ACCOUNT_DENIED');
    let metadata = {
      ...row.metadata,
      needs_selection: false
    };
    if (provider === 'GA4') {
      const property = await providerApi(provider, tokens, `/v1beta/properties/${id}`);
      metadata = {
        ...metadata,
        property_id: id,
        property_name: property.displayName,
        account_id: selected.account_id,
        account_name: selected.account_name,
        time_zone: property.timeZone,
        currency: property.currencyCode
      };
      await providerApi(provider, tokens, `/v1beta/properties/${id}:runReport`, {
        method: 'POST',
        body: {
          dateRanges: [{
            startDate: 'today',
            endDate: 'today'
          }],
          metrics: [{
            name: 'sessions'
          }]
        }
      });
    } else if (provider === 'MAILCHIMP') {
      const fields = await providerApi(provider, tokens, `/lists/${id}/merge-fields?count=100`);
      metadata = {
        ...metadata,
        audience_id: id,
        audience_name: selected.name,
        members: selected.members,
        merge_fields: (fields.merge_fields || []).map(f => f.tag)
      };
    } else if (provider === 'META') {
      if (!selected.page_token || !row.scopes.includes('leads_retrieval') || !row.scopes.includes('pages_manage_metadata')) throw new AppError('Grant lead retrieval and page subscription permissions before enabling leads.', 422, 'PROVIDER_PERMISSION_DENIED');
      tokens = {
        ...tokens,
        page_id: id,
        page_token: selected.page_token
      };
      metadata = {
        ...metadata,
        page_id: id,
        instagram_account_id: selected.instagram_account_id,
        instagram_username: selected.instagram_username
      };
      await providerApi(provider, {
        access_token: tokens.page_token
      }, `/${id}/subscribed_apps`, {
        method: 'POST',
        body: {
          subscribed_fields: ['leadgen']
        }
      });
    } else metadata = {
      ...metadata,
      advertiser_id: id
    };
    const result = await query("UPDATE integration_connections SET provider_account_id=$1,connected_account=$2,metadata=$3,encrypted_credentials=$4,status='CONNECTED',last_successful_sync_at=now(),last_error=NULL,last_error_code=NULL,consecutive_failures=0,updated_at=now() WHERE id=$5 RETURNING *", [id, selected.name, metadata, encryptSecretJson(tokens), row.id]);
    await query('DELETE FROM integration_report_cache WHERE connection_id=$1', [row.id]);
    await audit(req, provider === 'GA4' ? 'integration_property_changed' : provider === 'MAILCHIMP' ? 'integration_audience_changed' : 'integration_account_changed', row, {
      selected_id: id,
      account_name: selected.name
    });
    return connectionView(result.rows[0]);
  });
}
export async function testConnection(provider, req) {
  try {
    return await withCredentials(provider, async (row, tokens) => {
      if (row.metadata.needs_selection) throw new AppError('Select an account, property or audience first.', 422, 'PROVIDER_SELECTION_REQUIRED');
      if (provider === 'GA4') await providerApi(provider, tokens, `/v1beta/properties/${row.metadata.property_id}:runReport`, {
        method: 'POST',
        body: {
          dateRanges: [{
            startDate: 'today',
            endDate: 'today'
          }],
          metrics: [{
            name: 'sessions'
          }]
        }
      });else if (provider === 'MAILCHIMP') await providerApi(provider, tokens, `/lists/${row.metadata.audience_id}`);else if (provider === 'META') await providerApi(provider, {
        access_token: tokens.page_token
      }, `/${row.metadata.page_id}?fields=id,name`);else await accountOptions(provider, tokens);
      const saved = (await query("UPDATE integration_connections SET status='CONNECTED',verified_at=now(),last_successful_sync_at=now(),last_error=NULL,last_error_code=NULL,consecutive_failures=0,updated_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
      await audit(req, 'integration_tested', row);
      return connectionView(saved);
    });
  } catch (e) {
    await integrationFailure(await connection(provider), e);
    throw e;
  }
}
export async function disconnect(provider, req) {
  return transaction(async () => {
    const row = (await query("SELECT * FROM integration_connections WHERE category='MARKETING' AND provider=$1 FOR UPDATE", [provider])).rows[0];
    // Local credential revocation is immediate. Provider dashboard revocation is documented.
    await query("UPDATE integration_connections SET status='DISABLED',encrypted_credentials=NULL,access_token_expires_at=NULL,connection_generation=gen_random_uuid(),verified_at=NULL,last_error=NULL,last_error_code=NULL,updated_at=now() WHERE id=$1", [row.id]);
    await query("UPDATE integration_jobs SET status='CANCELLED',completed_at=now() WHERE provider=$1 AND mode='EXTERNAL' AND status='QUEUED'", [provider]);
    await query('UPDATE integration_oauth_states SET consumed_at=now() WHERE provider=$1 AND consumed_at IS NULL', [provider]);
    await query('DELETE FROM integration_report_cache WHERE connection_id=$1', [row.id]);
    await audit(req, 'integration_disconnected', row);
    await notifyManagers(row, 'Integration disconnected', 'The provider has been disconnected from LOLA Admin.');
    return {
      status: 'DISABLED'
    };
  });
}
async function notifyManagers(row, title, body) {
  const users = await query("SELECT DISTINCT u.id FROM users u WHERE active=true AND deleted_at IS NULL AND (EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id AND p.key IN ('*','write:integrations')) OR EXISTS(SELECT 1 FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=u.id AND p.key IN ('*','write:integrations')))");
  await createNotification({
    target: {
      userIds: users.rows.map(x => x.id)
    },
    category: 'SYSTEM',
    severity: 'WARNING',
    title: `${row.provider}: ${title}`,
    body,
    entityType: 'integration_connection',
    entityId: row.id,
    actionUrl: '/system/integrations',
    metadata: {
      provider: row.provider
    },
    email: {
      enabled: true
    }
  });
}
export async function integrationFailure(row, error) {
  const code = /^[A-Z_]{3,80}$/.test(error.code || '') ? error.code : 'PROVIDER_OPERATION_FAILED';
  const expired = ['PROVIDER_AUTH_EXPIRED'].includes(code);
  const result = await query("UPDATE integration_connections SET status=$1,last_error_code=$2,last_error=$3,consecutive_failures=consecutive_failures+1,updated_at=now() WHERE id=$4 AND connection_generation=$5 AND status NOT IN ('DISABLED','DISCONNECTED','NOT_CONNECTED') RETURNING *", [expired ? 'EXPIRED' : row.encrypted_credentials ? 'DEGRADED' : 'ERROR', code, expired ? 'Authorization expired. Reconnect this account.' : 'The last provider operation failed. Review logs and permissions.', row.id, row.connection_generation]);
  const next = result.rows[0];
  if (next && (expired || next.consecutive_failures >= 3) && (!next.last_notified_at || Date.now() - new Date(next.last_notified_at).getTime() > 86400000)) {
    const claim = await query("UPDATE integration_connections SET last_notified_at=now() WHERE id=$1 AND (last_notified_at IS NULL OR last_notified_at<now()-interval '1 day') RETURNING id", [row.id]);
    if (claim.rowCount) await notifyManagers(row, expired ? 'Authorization expired' : 'Repeated operation failures', next.last_error);
  }
}
export async function queueExternal(provider, operation, payload = {}, req = null, key = null) {
  const row = await connection(provider);
  if (!row.encrypted_credentials || row.metadata.needs_selection || ['DISABLED', 'NOT_CONNECTED', 'DISCONNECTED'].includes(row.status)) throw new AppError('Connect and select an account before syncing.', 422, 'PROVIDER_NOT_CONNECTED');
  const idempotency = key || `${provider}:${operation}:${row.connection_generation}:${digest(JSON.stringify(payload))}:${Math.floor(Date.now() / 60000)}`;
  const job = (await query("INSERT INTO integration_jobs(provider,event_name,entity_type,entity_id,payload,idempotency_key,mode) VALUES($1,$2,'integration_connection',$3,$4,$5,'EXTERNAL') ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id,status", [provider, operation, row.id, {
    ...payload,
    generation: row.connection_generation
  }, idempotency])).rows[0];
  if (req) await audit(req, 'integration_manual_sync', row, {
    operation,
    job_id: job.id
  });
  return job;
}
export async function integrationLogs(filters = {}) {
  const provider = filters.provider || null,
    status = filters.status || null,
    operation = filters.operation || null;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(filters.from || '') ? filters.from : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(filters.to || '') ? filters.to : null;
  const jobs = await query("SELECT id,provider,event_name AS operation,status,attempts,created_at,started_at,completed_at,last_error FROM integration_jobs WHERE mode='EXTERNAL' AND ($1::text IS NULL OR provider=$1) AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR event_name=$3) AND ($4::date IS NULL OR created_at>=$4::date) AND ($5::date IS NULL OR created_at<$5::date+interval '1 day') ORDER BY created_at DESC LIMIT 100", [provider, status, operation, start, end]);
  const events = await query("SELECT id,provider,event_type,external_event_id,received_at,processed_at,status,attempt_count,last_error FROM webhook_events WHERE provider=ANY($1::text[]) AND ($2::text IS NULL OR provider=$2) AND ($3::text IS NULL OR status=$3) AND ($4::date IS NULL OR received_at>=$4::date) AND ($5::date IS NULL OR received_at<$5::date+interval '1 day') AND ($6::text IS NULL OR event_type=$6) ORDER BY received_at DESC LIMIT 100", [['META', 'TIKTOK', 'MAILCHIMP'], provider, status, start, end, filters.event_type || null]);
  const attempts = await query("SELECT a.id,a.job_id,a.provider,a.event_name AS operation,a.attempt,a.result,a.response_summary,a.created_at FROM integration_attempts a JOIN integration_jobs j ON j.id=a.job_id WHERE j.mode='EXTERNAL' AND ($1::text IS NULL OR a.provider=$1) ORDER BY a.created_at DESC LIMIT 100", [provider]);
  return {
    jobs: jobs.rows,
    webhooks: events.rows,
    attempts: attempts.rows.map(x => ({
      ...x,
      response_summary: redactProvider(x.response_summary)
    }))
  };
}
export async function retryExternalJob(id, req) {
  const job = (await query("SELECT * FROM integration_jobs WHERE id=$1 AND mode='EXTERNAL' AND status='FAILED'", [id])).rows[0];
  if (!job) throw new AppError('Failed job not found.', 404, 'NOT_FOUND');
  const row = await connection(job.provider);
  if (!row.encrypted_credentials || row.connection_generation !== job.payload.generation) throw new AppError('This job belongs to a disconnected account. Review it before restarting.', 409, 'PROVIDER_ACCOUNT_CHANGED');
  await query("UPDATE integration_jobs SET status='QUEUED',attempts=0,available_at=now(),last_error=NULL WHERE id=$1 AND status='FAILED'", [job.id]);
  await audit(req, 'integration_job_retried', row, {
    job_id: job.id
  });
  return {
    queued: true
  };
}
export async function retryExternalInbound(eventId, req) {
  const job = (await query("SELECT id,status FROM integration_jobs WHERE mode='EXTERNAL' AND payload->>'webhook_id'=$1 ORDER BY created_at DESC LIMIT 1", [eventId])).rows[0];
  if (!job) return null;
  if (job.status === 'FAILED') return retryExternalJob(job.id, req);
  if (['QUEUED', 'PROCESSING', 'SUCCEEDED'].includes(job.status)) return {
    status: job.status
  };
  throw new AppError('This delivery belongs to a disconnected account and requires review.', 409, 'PROVIDER_ACCOUNT_CHANGED');
}
