import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pkg = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../server/migrations/014_phase_11_production_readiness.sql", import.meta.url), "utf8");
const fieldOps = fs.readFileSync(new URL("../server/src/services/field-operations-service.js", import.meta.url), "utf8");
const healthService = fs.readFileSync(new URL("../server/src/services/system-health-service.js", import.meta.url), "utf8");
const envCheck = fs.readFileSync(new URL("../server/src/config/env-check.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../server/src/worker.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../src/pages/Settings.jsx", import.meta.url), "utf8");
const scan = fs.readFileSync(new URL("../src/pages/Scan.jsx", import.meta.url), "utf8");
const offlineQueue = fs.readFileSync(new URL("../src/utils/offlineQueue.js", import.meta.url), "utf8");
const audit = fs.readFileSync(new URL("../docs/LOLA_PHASE_11_PRODUCT_AUDIT.md", import.meta.url), "utf8");
const dr = fs.readFileSync(new URL("../docs/LOLA_DISASTER_RECOVERY.md", import.meta.url), "utf8");
const goLive = fs.readFileSync(new URL("../docs/LOLA_GO_LIVE_CHECKLIST.md", import.meta.url), "utf8");
const deployment = fs.readFileSync(new URL("../docs/LOLA_PRODUCTION_DEPLOYMENT.md", import.meta.url), "utf8");
const handoff11b = fs.readFileSync(new URL("../docs/LOLA_PHASE_11B_HANDOFF.md", import.meta.url), "utf8");
const ownerRunbook = fs.readFileSync(new URL("../docs/LOLA_OWNER_RUNBOOK.md", import.meta.url), "utf8");

test("phase 11 uses a maintained QR encoder for label PDFs", () => {
  assert.match(pkg, /"qrcode"/);
  assert.match(fieldOps, /import QRCode from "qrcode"/);
  assert.match(fieldOps, /QRCode\.toDataURL/);
  assert.doesNotMatch(fieldOps, /drawQrLikeMatrix/);
});

test("phase 11 adds worker runtime and system health persistence", () => {
  assert.match(pkg, /"worker": "node server\/src\/worker\.js"/);
  assert.match(pkg, /"env:check": "node server\/src\/config\/env-check\.js"/);
  assert.match(worker, /processDueJobs/);
  assert.match(worker, /recordWorkerHeartbeat/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS worker_heartbeats/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS system_health_snapshots/);
  assert.match(healthService, /HEALTHY/);
  assert.match(healthService, /DOWN/);
  assert.match(healthService, /MISCONFIGURED/);
  assert.match(healthService, /website_integration/);
  assert.match(healthService, /storage/);
  assert.match(healthService, /sms/);
  assert.match(envCheck, /productionReadinessIssues/);
  assert.match(envCheck, /INVALID FORMAT/);
  assert.match(envCheck, /requiredInvalid/);
});

test("admin exposes health and job operations", () => {
  assert.match(adminRoutes, /\/system\/health/);
  assert.match(adminRoutes, /\/system\/jobs/);
  assert.match(adminRoutes, /retrySystemJob/);
  assert.match(adminRoutes, /cancelSystemJob/);
  assert.match(adminRoutes, /retrySelectedSystemJobs/);
});

test("frontend adds live operations, system health, notifications preferences, scanner states, and code splitting", () => {
  assert.match(app, /lazy\(/);
  assert.match(app, /operations\/live/);
  assert.match(app, /system\/health/);
  assert.match(settings, /Notification preferences saved/);
  assert.match(settings, /Critical alerts mandatory/);
  assert.match(settings, /SMS notifications/);
  assert.match(fs.readFileSync(new URL("../src/pages/SystemHealth.jsx", import.meta.url), "utf8"), /Retry Selected/);
  for (const state of ["CAMERA READY", "SCANNING", "FOUND", "NOT FOUND", "WRONG EVENT", "ALREADY PROCESSED", "CAMERA DENIED", "CAMERA UNSUPPORTED"]) {
    assert.match(scan, new RegExp(state));
  }
});

test("offline upload retry has IndexedDB Blob limits and cleanup", () => {
  assert.match(offlineQueue, /offline_files/);
  assert.match(offlineQueue, /MAX_OFFLINE_FILE_BYTES/);
  assert.match(offlineQueue, /MAX_OFFLINE_CACHE_BYTES/);
  assert.match(offlineQueue, /ALLOWED_OFFLINE_FILE_TYPES/);
  assert.match(offlineQueue, /MAX_OFFLINE_FILE_ATTEMPTS/);
  assert.match(offlineQueue, /cleanupStaleOfflineFiles/);
  assert.match(offlineQueue, /PERMANENT_FAILURE/);
  assert.match(offlineQueue, /queueOfflineFile/);
  assert.match(offlineQueue, /removeOfflineFile/);
});

test("phase 11 documents production audit, launch blockers, and disaster recovery", () => {
  for (const moduleName of ["Authentication", "Users/RBAC", "Payments", "Automations", "QR Equipment", "Settings"]) {
    assert.match(audit, new RegExp(moduleName.replace("/", "\\/")));
  }
  assert.match(audit, /P0 Launch Checklist/);
  assert.match(dr, /Restore Drill/);
  assert.match(dr, /Rotate `JWT_SECRET`/);
  assert.match(goLive, /NOT READY FOR PRODUCTION/);
  assert.match(goLive, /P0 row/);
  assert.match(deployment, /Environment Matrix/);
  assert.match(deployment, /Migration Failure Plan/);
  assert.match(handoff11b, /Remaining P0 Blockers/);
  assert.match(ownerRunbook, /Daily Workflow/);
});
