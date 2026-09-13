import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  classifyAutomationJobType,
  futureAutomationJobTypes,
  implementedAutomationJobTypes
} from "../server/src/services/automation-service.js";

const automationSource = fs.readFileSync(new URL("../server/src/services/automation-service.js", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../server/src/worker.js", import.meta.url), "utf8");
const railwayRunbook = fs.readFileSync(new URL("../docs/LOLA_RAILWAY_DEPLOYMENT.md", import.meta.url), "utf8");

test("worker classifies automation job types without false success", () => {
  assert.deepEqual(implementedAutomationJobTypes, ["SEND_EMAIL_TEMPLATE", "SEND_EMAIL"]);
  assert.deepEqual(futureAutomationJobTypes, ["CREATE_TASK", "ASSIGN_LEAD", "CHANGE_LEAD_STATUS", "ADD_INTERNAL_NOTE"]);
  assert.equal(classifyAutomationJobType("SEND_EMAIL_TEMPLATE"), "IMPLEMENTED");
  assert.equal(classifyAutomationJobType("SEND_EMAIL"), "IMPLEMENTED");
  assert.equal(classifyAutomationJobType("CREATE_TASK"), "NOT_IMPLEMENTED");
  assert.equal(classifyAutomationJobType("ASSIGN_LEAD"), "NOT_IMPLEMENTED");
  assert.equal(classifyAutomationJobType("CHANGE_LEAD_STATUS"), "NOT_IMPLEMENTED");
  assert.equal(classifyAutomationJobType("ADD_INTERNAL_NOTE"), "NOT_IMPLEMENTED");
  assert.equal(classifyAutomationJobType("UNKNOWN_ACTION"), "UNSAFE");
});

test("unimplemented automation actions fail non-retryably instead of completing", () => {
  assert.match(automationSource, /AUTOMATION_ACTION_NOT_IMPLEMENTED/);
  assert.match(automationSource, /retryable:\s*false/);
  assert.match(automationSource, /classification !== "IMPLEMENTED"/);
});

test("SEND_EMAIL jobs send plain email from payload and do not require templates", () => {
  assert.match(automationSource, /async function sendPlainEmailJob/);
  assert.match(automationSource, /job\.payload\?\.subject/);
  assert.match(automationSource, /job\.payload\?\.body/);
  assert.match(automationSource, /EMAIL_CONTENT_REQUIRED/);
});

test("worker recovers stale processing jobs after restart", () => {
  assert.match(automationSource, /recoverStaleProcessingJobs/);
  assert.match(automationSource, /WHERE status='PROCESSING'/);
  assert.match(automationSource, /started_at < now\(\) - \(\$1::int \* interval '1 minute'\)/);
  assert.match(automationSource, /status=CASE WHEN attempt_count >= max_attempts THEN 'FAILED' ELSE 'PENDING' END/);
});

test("current worker path is storage independent", () => {
  assert.doesNotMatch(workerSource, /storage-service|LOCAL_STORAGE_ROOT|getStorageProvider/);
  assert.match(automationSource, /sendEmail\(\{ to, subject, body \}\)/);
  assert.doesNotMatch(automationSource, /attachments:\s*\[/);
  assert.match(railwayRunbook, /Do not mount a Railway volume or set worker `LOCAL_STORAGE_ROOT`/);
});
