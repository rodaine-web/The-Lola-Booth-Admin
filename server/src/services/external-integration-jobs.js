import { query } from '../db/pool.js';
import { withCredentials, connection, integrationFailure, queueExternal } from './external-connections-service.js';
import { accountOptions } from './external-provider-adapters.js';
import { refreshAnalytics, syncMailchimp, mailchimpReports } from './external-reporting-service.js';
import { processSocialEvent, processMailchimpEvent } from './external-webhooks-service.js';
import { AppError } from '../utils/errors.js';
export async function dispatchExternalJob(job) {
  return withCredentials(job.provider, async (row, tokens) => {
    if (job.payload.generation !== row.connection_generation) return {
      mode: 'EXTERNAL',
      result: 'DISABLED'
    };
    let summary = {};
    if (job.event_name === 'TOKEN_REFRESH') summary = {
      records_processed: 1
    };else if (job.event_name === 'REPORT_REFRESH') summary = await refreshAnalytics(row, tokens, job.payload);else if (job.event_name === 'CONTACT_SYNC') summary = await syncMailchimp(row, tokens, job);else if (job.event_name === 'CAMPAIGN_REPORTS') summary = await mailchimpReports(row, tokens);else if (job.event_name === 'ACCOUNT_REFRESH') {
      const accounts = await accountOptions(job.provider, tokens),
        selected = accounts.find(x => x.id === row.provider_account_id);
      if (!selected) throw new AppError('The selected account is no longer authorized.', 422, 'PROVIDER_PERMISSION_DENIED');
      await query('UPDATE integration_connections SET connected_account=$1 WHERE id=$2', [selected.name, row.id]);
      summary = {
        records_processed: 1
      };
    } else if (job.event_name === 'WEBHOOK_PROCESS') {
      const event = (await query('SELECT * FROM webhook_events WHERE id=$1 AND provider=$2 FOR UPDATE', [job.payload.webhook_id, job.provider])).rows[0];
      if (!event) throw new AppError('Webhook not found.', 404, 'NOT_FOUND');
      if (['PROCESSED', 'IGNORED', 'RESOLVED'].includes(event.status)) return {
        mode: 'EXTERNAL',
        result: 'IDEMPOTENT_REPLAY'
      };
      await query("UPDATE webhook_events SET status='PROCESSING',attempt_count=attempt_count+1 WHERE id=$1", [event.id]);
      summary = job.provider === 'MAILCHIMP' ? await processMailchimpEvent(row, tokens, event) : await processSocialEvent(job.provider, row, tokens, event).then(result => ({
        records_processed: 1,
        records_created: result.action === 'CREATED_LEAD' ? 1 : 0,
        records_updated: result.action === 'CREATED_LEAD' ? 0 : 1
      }));
      await query("UPDATE webhook_events SET status='PROCESSED',processed_at=now(),last_error=NULL WHERE id=$1", [event.id]);
    } else throw new AppError('Unsupported external operation.', 422, 'INTEGRATION_UNSUPPORTED');
    if (summary.records_failed > 0) {
      await integrationFailure(row, new AppError('Some audience members failed validation.', 422, 'CONTACT_SYNC_PARTIAL'));
      return {
        mode: 'EXTERNAL',
        result: 'PARTIAL',
        ...summary
      };
    }
    await query("UPDATE integration_connections SET status='CONNECTED',last_successful_sync_at=now(),last_error=NULL,last_error_code=NULL,consecutive_failures=0,updated_at=now() WHERE id=$1", [row.id]);
    return {
      mode: 'EXTERNAL',
      result: 'SUCCEEDED',
      ...summary
    };
  });
}
export async function externalJobFailed(job, error) {
  const row = await connection(job.provider);
  if (row.connection_generation !== job.payload.generation || row.status === 'DISABLED') return;
  await integrationFailure(row, error);
  if (job.payload.webhook_id) await query("UPDATE webhook_events SET status=$2,attempt_count=$3,last_error=$4 WHERE id=$1", [job.payload.webhook_id, job.attempts >= 3 ? 'FAILED_NEEDS_REVIEW' : 'FAILED', job.attempts, error.code || 'PROVIDER_OPERATION_FAILED']);
}
export async function queueDueExternalMaintenance() {
  const rows = (await query("SELECT provider,access_token_expires_at FROM integration_connections WHERE provider='GA4' AND status IN ('CONNECTED','DEGRADED','EXPIRED') AND encrypted_credentials IS NOT NULL AND access_token_expires_at<now()+interval '1 minute' AND COALESCE((metadata->>'needs_selection')::boolean,false)=false")).rows;
  for (const row of rows) await queueExternal(row.provider, 'TOKEN_REFRESH', {}, null, `GA4:refresh:${new Date(row.access_token_expires_at).toISOString()}`);
}
