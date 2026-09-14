import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const report = fs.readFileSync(new URL("../docs/LOLA_FINAL_PRODUCTION_CERTIFICATION.md", import.meta.url), "utf8");

test("final production certification records the required verdict and launch matrix", () => {
  assert.match(report, /Final verdict: \*\*GO WITH CONDITIONS\*\*/);
  assert.match(report, /Final Launch Matrix/);
  for (const area of [
    "Public website",
    "Admin",
    "API",
    "Postgres",
    "Migrations",
    "Worker",
    "Scheduled communication",
    "Email",
    "Public forms",
    "Authentication",
    "RBAC",
    "Proposal",
    "Invoice",
    "Stripe Checkout",
    "Stripe webhook",
    "Backups",
    "Restore drill",
    "System Health",
    "Security",
    "SMS"
  ]) {
    assert.match(report, new RegExp(area));
  }
});

test("final production certification distinguishes live evidence from blocked account checks", () => {
  assert.match(report, /GET https:\/\/api\.thelolabooth\.com\/api\/health/);
  assert.match(report, /CORS_REJECTED/);
  assert.match(report, /CREATED_LEAD/);
  assert.match(report, /POSSIBLE_DUPLICATE/);
  assert.match(report, /Latest repo migration.*019_phase_13c_production_communication_hardening\.sql/s);
  assert.match(report, /Latest applied Railway migration.*Unknown/s);
});

test("final production certification documents the credential fix and SMS status", () => {
  assert.match(report, /Default owner email\/password/);
  assert.match(report, /FIXED IN SOURCE/);
  assert.match(report, /SEED_OWNER_EMAIL/);
  assert.match(report, /SEED_OWNER_PASSWORD/);
  assert.match(report, /SMS remains \*\*NO-GO \/ DISABLED \/ PENDING TWILIO VERIFICATION\*\*/);
});
