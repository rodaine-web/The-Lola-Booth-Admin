import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const report = fs.readFileSync(new URL("../docs/LOLA_PHASE_14_PRODUCTION_UAT.md", import.meta.url), "utf8");

test("phase 14 production UAT report includes all required delivery sections", () => {
  for (const section of [
    "A. Executive Summary",
    "B. Environment Status",
    "C. End-to-End UAT Results",
    "D. Worker Certification",
    "E. Website Inquiry Results",
    "F. Proposal Results",
    "G. Invoice Results",
    "H. Payment Results",
    "I. Creative Approval Results",
    "J. Event Ops Results",
    "K. Gallery Results",
    "L. Communication Results",
    "M. Automation Results",
    "N. RBAC Results",
    "O. Failure Test Results",
    "P. System Health",
    "Q. Document Review",
    "R. Manual Verifications",
    "S. Open Risks",
    "T. Release Decision"
  ]) {
    assert.match(report, new RegExp(section.replace(/[.]/g, "\\.")));
  }
});

test("phase 14 report separates local certification from production-only verification", () => {
  assert.match(report, /npm test`: PASS, 127\/127 tests/);
  assert.match(report, /npm run build`: PASS/);
  assert.match(report, /Production worker certification: \*\*MANUAL VERIFICATION REQUIRED\*\*/);
  assert.match(report, /Production release remains conditional/);
  assert.match(report, /Do not expose secrets|without exposing secrets/);
});

test("phase 14 release decision covers requested product areas and keeps SMS no-go", () => {
  for (const area of [
    "Core LOLA Admin",
    "Email Communications",
    "Scheduled Automations",
    "Payments",
    "Public Proposal/Invoice",
    "Creative Approvals",
    "Event Operations",
    "Gallery",
    "SMS"
  ]) {
    assert.match(report, new RegExp(area));
  }
  assert.match(report, /Overall decision: \*\*GO WITH CONDITIONS\*\*/);
  assert.match(report, /SMS \\| NO-GO/);
  assert.match(report, /SMS remains intentionally disabled/);
});

test("phase 14 checklist uses required certification statuses", () => {
  for (const status of ["PASS", "FAIL", "MANUAL VERIFICATION REQUIRED", "NOT APPLICABLE", "NO-GO", "GO WITH CONDITIONS"]) {
    assert.match(report, new RegExp(status));
  }
  assert.match(report, /Production Checklist/);
  assert.match(report, /Worker \\| MANUAL VERIFICATION REQUIRED/);
  assert.match(report, /Payments \\| MANUAL VERIFICATION REQUIRED/);
});
