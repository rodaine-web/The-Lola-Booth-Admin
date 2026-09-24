import fs from "node:fs/promises";
import {constants} from "node:fs";
import { env, productionReadinessIssues } from "../config/env.js";
import { query } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { getEmailProviderReadiness } from "./email-service.js";
import { smsProviderStatus } from "./automation-service.js";
import { providerStatus } from "./payment-service.js";
import { publicSitePayload } from "./website-cms-service.js";

const statuses = ["DOWN", "ERROR", "MISCONFIGURED", "DISCONNECTED", "DEGRADED", "STALE", "UNKNOWN", "HEALTHY"];

function check(name, status, summary, details = {}) {
  return { name, status, summary, details };
}

function overallStatus(checks) {
  return statuses.find((status) => checks.some((item) => item.status === status)) || "UNKNOWN";
}

export async function recordWorkerHeartbeat(workerName = "automation-worker", metadata = {}) {
  const result = await query(
    `INSERT INTO worker_heartbeats (worker_name, status, last_heartbeat_at, metadata)
     VALUES ($1,'HEALTHY',now(),$2)
     ON CONFLICT (worker_name) DO UPDATE SET status='HEALTHY', last_heartbeat_at=now(), metadata=$2, updated_at=now()
     RETURNING *`,
    [workerName, metadata]
  );
  return result.rows[0];
}

export async function recordWorkerProcessingResult(workerName = "automation-worker", { success = true, error = null, processed = 0 } = {}) {
  const result = await query(
    `INSERT INTO worker_heartbeats (
       worker_name, status, last_heartbeat_at, metadata,
       last_successful_communication_processing_at, last_failed_communication_processing_at, last_processing_error
     ) VALUES ($1,$2,now(),$3,CASE WHEN $4 THEN now() ELSE NULL END,CASE WHEN $4 THEN NULL ELSE now() END,$5)
     ON CONFLICT (worker_name) DO UPDATE SET
       status=$2,
       last_heartbeat_at=now(),
       metadata=worker_heartbeats.metadata || $3,
       last_successful_communication_processing_at=CASE WHEN $4 THEN now() ELSE worker_heartbeats.last_successful_communication_processing_at END,
       last_failed_communication_processing_at=CASE WHEN $4 THEN worker_heartbeats.last_failed_communication_processing_at ELSE now() END,
       last_processing_error=CASE WHEN $4 THEN NULL ELSE $5 END,
       updated_at=now()
     RETURNING *`,
    [workerName, success ? "HEALTHY" : "ERROR", { processed }, success, error]
  );
  return result.rows[0];
}

export async function getSystemHealth() {
  const checks = [];
  try {
    await query("SELECT 1");
    checks.push(check("api", "HEALTHY", "API process is responding."));
    checks.push(check("database", "HEALTHY", "PostgreSQL connection is available."));
  } catch (error) {
    checks.push(check("api", "DOWN", "API process cannot complete database-backed health checks.", { error: error.message }));
    checks.push(check("database", "DOWN", "PostgreSQL connection failed.", { error: error.message }));
  }

  checks.push(...environmentChecks());
  checks.push(...paymentChecks());
  checks.push(await emailCheck());
  checks.push(smsCheck());
  checks.push(await communicationReadinessCheck());
  checks.push(await fallbackCheck());
  checks.push(await storageCheck());
  checks.push(await websiteIntegrationCheck());
  checks.push(await workerCheck());
  checks.push(await jobBacklogCheck());
  checks.push(await integrationCheck());
  checks.push(await retentionCheck());

  const status = overallStatus(checks);
  await query("INSERT INTO system_health_snapshots (status, checks) VALUES ($1,$2)", [status, checks]).catch(() => null);
  return { status, generatedAt: new Date().toISOString(), checks };
}

function smsCheck() {
  const sms = smsProviderStatus();
  if (sms.state === "NOT_CONFIGURED") return check("sms", "DISABLED", "SMS is intentionally not configured.", sms);
  if (sms.state === "READY") return check("sms", "HEALTHY", `${sms.provider} SMS adapter is ready.`, sms);
  return check("sms", "MISCONFIGURED", `${sms.provider} SMS adapter is not ready.`, sms);
}

export async function storageCheck(config=env) {
  if (config.storageProvider === "local") {
    try {
      const stat=await fs.stat(config.localStorageRoot);
      if(!stat.isDirectory())throw new Error('Not a directory');
      await fs.access(config.localStorageRoot,constants.R_OK|constants.W_OK);
      return check("storage",config.nodeEnv==='production'?"DEGRADED":"HEALTHY","Storage path exists and is readable/writable. Persistent volume durability and backup restore require infrastructure verification.",{provider:"local",pathAccessible:true,durabilityVerified:false});
    } catch {return check("storage","ERROR","Configured storage directory is missing or is not readable/writable.",{provider:"local",pathAccessible:false});}
  }
  if(config.storageProvider==='s3')return check("storage","MISCONFIGURED","S3-compatible adapter is not active yet.",{provider:'s3'});
  return check("storage","UNKNOWN","Storage provider is not recognized.");
}

async function websiteIntegrationCheck() {
  try {
    const payload = await publicSitePayload();
    return check("website_integration", "HEALTHY", "Public website CMS payload is available.", { sections: Object.keys(payload || {}) });
  } catch (error) {
    return check("website_integration", "ERROR", "Public website CMS payload failed.", { error: error.message });
  }
}

function environmentChecks() {
  if (!productionReadinessIssues.length) return [check("environment", "HEALTHY", "Required production environment values are present.")];
  return [check("environment", env.nodeEnv === "production" ? "MISCONFIGURED" : "DEGRADED", "Production environment values still need attention.", { issues: productionReadinessIssues })];
}

function paymentChecks() {
  const providers = providerStatus();
  return Object.values(providers).map((provider) => {
    if (!provider.configured) return check(`payments.${provider.provider.toLowerCase()}`, "DISCONNECTED", `${provider.provider} credentials are not configured.`, provider);
    if (!provider.webhookConfigured) return check(`payments.${provider.provider.toLowerCase()}`, "MISCONFIGURED", `${provider.provider} credentials exist but webhook verification is not configured.`, provider);
    return check(`payments.${provider.provider.toLowerCase()}`, "HEALTHY", `${provider.provider} is configured for ${provider.mode}.`, provider);
  });
}

async function emailCheck() {
  if (env.emailProvider === "development") return check("email", env.nodeEnv === "production" ? "MISCONFIGURED" : "DEGRADED", "Email is using the development adapter and does not deliver externally.", { provider: env.emailProvider, from: env.emailFrom });
  try {
    const readiness = getEmailProviderReadiness();
    return check("email", "HEALTHY", `${env.emailProvider} adapter is configured and active.`, readiness);
  } catch (error) {
    return check("email", "MISCONFIGURED", `${env.emailProvider} adapter is configured but not active.`, { error: error.message });
  }
}

async function communicationReadinessCheck() {
  const result = await query(
    `SELECT
       count(*) FILTER (WHERE status='SCHEDULED')::int AS scheduled,
       count(*) FILTER (WHERE status='DRAFT')::int AS drafts,
       count(*) FILTER (WHERE status='FAILED')::int AS failed,
       count(*) FILTER (WHERE status='SCHEDULED' AND scheduled_at < now() - interval '15 minutes')::int AS stale_scheduled
     FROM communications
     WHERE deleted_at IS NULL`
  );
  const row = result.rows[0] || {};
  if (Number(row.failed) > 0) return check("communications", "ERROR", "One or more communications have failed.", row);
  if (Number(row.stale_scheduled) > 0) return check("communications", "DEGRADED", "Scheduled communications are overdue.", row);
  return check("communications", "HEALTHY", "Communication queue is within expected bounds.", row);
}

async function fallbackCheck() {
  const result = await query(
    `SELECT count(*)::int AS fallback_count, max(created_at) AS last_fallback_at
     FROM communication_fallback_events
     WHERE created_at > now() - interval '24 hours'`
  ).catch(() => ({ rows: [{ fallback_count: 0 }] }));
  const row = result.rows[0] || {};
  if (env.nodeEnv === "production" && Number(row.fallback_count) > 0) return check("legacy_fallback", "DEGRADED", "Communication templates fell back to legacy copy in production.", row);
  return check("legacy_fallback", Number(row.fallback_count) > 0 ? "DEGRADED" : "HEALTHY", Number(row.fallback_count) > 0 ? "Recent communication fallback events exist." : "No recent communication fallback events.", row);
}

async function workerCheck() {
  const result = await query("SELECT * FROM worker_heartbeats WHERE worker_name='automation-worker' LIMIT 1");
  const heartbeat = result.rows[0];
  if (!heartbeat) return check("worker", "UNKNOWN", "Automation worker has not reported a heartbeat.");
  const ageSeconds = Math.round((Date.now() - new Date(heartbeat.last_heartbeat_at).getTime()) / 1000);
  if (ageSeconds > 300) return check("worker", "DOWN", "Automation worker heartbeat is down.", { lastHeartbeatAt: heartbeat.last_heartbeat_at, ageSeconds, lastSuccess: heartbeat.last_successful_communication_processing_at, lastFailure: heartbeat.last_failed_communication_processing_at, error: heartbeat.last_processing_error });
  if (ageSeconds > 180) return check("worker", "STALE", "Automation worker heartbeat is stale.", { lastHeartbeatAt: heartbeat.last_heartbeat_at, ageSeconds, lastSuccess: heartbeat.last_successful_communication_processing_at, lastFailure: heartbeat.last_failed_communication_processing_at, error: heartbeat.last_processing_error });
  return check("worker", "HEALTHY", "Automation worker heartbeat is current.", { lastHeartbeatAt: heartbeat.last_heartbeat_at, ageSeconds, lastSuccess: heartbeat.last_successful_communication_processing_at, lastFailure: heartbeat.last_failed_communication_processing_at, error: heartbeat.last_processing_error });
}

async function jobBacklogCheck() {
  const result = await query(
    `SELECT
      count(*) FILTER (WHERE status='PENDING')::int AS pending,
      count(*) FILTER (WHERE status='PROCESSING')::int AS processing,
      count(*) FILTER (WHERE status='FAILED')::int AS failed,
      min(scheduled_for) FILTER (WHERE status='PENDING') AS oldest_pending
     FROM automation_jobs`
  );
  const row = result.rows[0] || {};
  if (Number(row.failed) > 0) return check("automation_jobs", "ERROR", "One or more automation jobs have failed.", row);
  if (row.oldest_pending && new Date(row.oldest_pending).getTime() < Date.now() - 15 * 60000) return check("automation_jobs", "DEGRADED", "Pending automation jobs are older than expected.", row);
  return check("automation_jobs", "HEALTHY", "Automation job backlog is within expected bounds.", row);
}

async function integrationCheck() {
  const result = await query("SELECT provider, status, last_error, last_webhook_at FROM integration_connections ORDER BY category, provider");
  const disconnected = result.rows.filter((row) => ["ERROR", "NEEDS_REAUTHORIZATION"].includes(row.status));
  if (disconnected.length) return check("integrations", "ERROR", "One or more connected integrations need attention.", { connections: result.rows });
  const pending = result.rows.filter((row) => ["DISCONNECTED", "AWAITING_APPROVAL"].includes(row.status));
  return check("integrations", pending.length ? "DEGRADED" : "HEALTHY", pending.length ? "Optional integrations are disconnected or awaiting approval." : "Integrations do not report errors.", { connections: result.rows });
}

async function retentionCheck() {
  const result = await query("SELECT audit_log_retention_days, notification_retention_days, offline_receipt_retention_days FROM business_settings LIMIT 1");
  return check("retention", "HEALTHY", "Retention windows are configured.", result.rows[0] || {});
}

export async function listSystemJobs() {
  const result = await query(
    `SELECT j.*, a.name AS automation_name
     FROM automation_jobs j
     LEFT JOIN automations a ON a.id=j.automation_id
     ORDER BY j.scheduled_for DESC
     LIMIT 100`
  );
  return { data: result.rows };
}

export async function retrySystemJob(id) {
  const result = await query(
    `UPDATE automation_jobs
     SET status='PENDING', scheduled_for=now(), last_error=NULL, started_at=NULL, completed_at=NULL, updated_at=now()
     WHERE id=$1 AND status IN ('FAILED','CANCELLED')
     RETURNING *`,
    [id]
  );
  if (!result.rows[0]) throw notFound("Job");
  return result.rows[0];
}

export async function retrySelectedSystemJobs(ids = []) {
  if (!Array.isArray(ids) || !ids.length) throw new AppError("Select at least one failed or cancelled job.", 400, "NO_JOBS_SELECTED");
  const result = await query(
    `UPDATE automation_jobs
     SET status='PENDING', scheduled_for=now(), last_error=NULL, started_at=NULL, completed_at=NULL, updated_at=now()
     WHERE id=ANY($1::uuid[]) AND status IN ('FAILED','CANCELLED')
     RETURNING *`,
    [ids]
  );
  return { retried: result.rows.length, data: result.rows };
}

export async function cancelSystemJob(id) {
  const result = await query(
    `UPDATE automation_jobs
     SET status='CANCELLED', last_error='Cancelled by admin', updated_at=now()
     WHERE id=$1 AND status IN ('PENDING','PROCESSING')
     RETURNING *`,
    [id]
  );
  if (!result.rows[0]) throw new AppError("Only pending or processing jobs can be cancelled.", 409, "JOB_NOT_CANCELLABLE");
  return result.rows[0];
}
