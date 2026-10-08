import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { externalProvider, providerSlugs } from '../services/external-provider-adapters.js';
import { externalConnections, startOAuth, finishOAuth, choices, selectAccount, testConnection, disconnect, queueExternal, integrationLogs, connection, retryExternalJob } from '../services/external-connections-service.js';
import { websiteReport, analyticsDates, reportKey } from '../services/external-reporting-service.js';
import { writeAudit } from '../services/audit-service.js';
export const externalIntegrationsRouter = Router(),
  externalOAuthRouter = Router();
externalIntegrationsRouter.get('/connections', requirePermission('read:integrations'), asyncHandler(async (req, res) => res.json({
  data: await externalConnections()
})));
externalIntegrationsRouter.get('/logs', requirePermission('read:integrations'), asyncHandler(async (req, res) => res.json(await integrationLogs(req.query))));
externalIntegrationsRouter.get('/website-analytics', requirePermission('read:integrations'), asyncHandler(async (req, res) => res.json(await websiteReport(req.query))));
externalIntegrationsRouter.get('/mailchimp/reports', requirePermission('read:integrations'), asyncHandler(async (req, res) => {
  const row = await connection('MAILCHIMP');
  const cache = (await query("SELECT report,refreshed_at FROM integration_report_cache WHERE connection_id=$1 AND cache_key='mailchimp_campaigns'", [row.id])).rows[0];
  res.json(cache || {
    report: {
      reports: []
    }
  });
}));
externalIntegrationsRouter.get('/:provider/connect', requirePermission('write:integrations'), asyncHandler(async (req, res) => {
  const p = externalProvider(req.params.provider),
    result = await startOAuth(p, req);
  // HttpOnly callback binding; auth codes/states never go into localStorage.
  res.cookie(`lola_oauth_${providerSlugs[p]}`, result.browser, {
    httpOnly: true,
    secure: !result.url.includes('localhost') && new URL(process.env[p === 'GA4' ? 'GOOGLE_ANALYTICS_REDIRECT_URI' : `${p}_REDIRECT_URI`]).protocol === 'https:',
    sameSite: 'lax',
    path: `/api/integrations/${providerSlugs[p]}/callback`,
    maxAge: 600000
  });
  res.json({
    url: result.url
  });
}));
externalOAuthRouter.get('/:provider/callback', rateLimit({
  windowMs: 600000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}), asyncHandler(async (req, res) => {
  const p = externalProvider(req.params.provider),
    name = `lola_oauth_${providerSlugs[p]}`;
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(x => {
    const i = x.indexOf('=');
    return [x.slice(0, i).trim(), x.slice(i + 1).trim()];
  }));
  res.clearCookie(name, {
    path: `/api/integrations/${providerSlugs[p]}/callback`
  });
  try {
    await finishOAuth(p, {
      state: req.query.state,
      code: req.query.auth_code || req.query.code,
      error: req.query.error,
      browser: cookies[name]
    }, req);
    res.redirect(`${env.clientOrigin}/system/integrations?connection=authorized`);
  } catch (error) {
    if (['OAUTH_STATE_INVALID', 'FORBIDDEN'].includes(error.code)) throw error;
    res.redirect(`${env.clientOrigin}/system/integrations?connection=failed`);
  }
}));
externalIntegrationsRouter.get('/:provider/accounts', requirePermission('write:integrations'), asyncHandler(async (req, res) => res.json({
  data: await choices(externalProvider(req.params.provider))
})));
externalIntegrationsRouter.post('/:provider/account', requirePermission('write:integrations'), asyncHandler(async (req, res) => res.json(await selectAccount(externalProvider(req.params.provider), req.body.id, req))));
externalIntegrationsRouter.post('/:provider/test', requirePermission('write:integrations'), asyncHandler(async (req, res) => res.json(await testConnection(externalProvider(req.params.provider), req))));
externalIntegrationsRouter.post('/:provider/disconnect', requirePermission('write:integrations'), asyncHandler(async (req, res) => res.json(await disconnect(externalProvider(req.params.provider), req))));
externalIntegrationsRouter.patch('/google-analytics/settings', requirePermission('write:integrations'), asyncHandler(async (req, res) => {
  const name = req.body.primary_inquiry_event;
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name || '')) throw new AppError('Enter a valid GA event name.', 422, 'INVALID_EVENT_NAME');
  const row = await connection('GA4');
  await query("UPDATE integration_connections SET metadata=jsonb_set(metadata,'{primary_inquiry_event}',to_jsonb($1::text)),updated_at=now() WHERE id=$2", [name, row.id]);
  await query('DELETE FROM integration_report_cache WHERE connection_id=$1', [row.id]);
  await writeAudit({
    req,
    action: 'integration_settings_changed',
    entity: 'integration_connection',
    entityId: row.id,
    after: {
      primary_inquiry_event: name
    }
  });
  res.json({
    saved: true
  });
}));
externalIntegrationsRouter.post('/:provider/sync', requirePermission('write:integrations'), asyncHandler(async (req, res) => {
  const provider = externalProvider(req.params.provider);
  let operation,
    payload = {};
  if (provider === 'MAILCHIMP') operation = req.body.operation === 'reports' ? 'CAMPAIGN_REPORTS' : 'CONTACT_SYNC';else if (provider === 'GA4') {
    const row = await connection(provider);
    const dates = analyticsDates(req.body, row.metadata.time_zone),
      event = row.metadata.primary_inquiry_event || 'generate_lead';
    operation = 'REPORT_REFRESH';
    payload = {
      dates,
      event,
      cache_key: reportKey(dates, event)
    };
  } else operation = 'ACCOUNT_REFRESH';
  res.status(202).json(await queueExternal(provider, operation, payload, req));
}));
externalIntegrationsRouter.post('/jobs/:id/retry', requirePermission('write:integrations'), asyncHandler(async (req, res) => res.status(202).json(await retryExternalJob(req.params.id, req))));
