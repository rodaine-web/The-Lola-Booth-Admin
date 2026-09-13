import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/012_phase_9_event_execution.sql", import.meta.url), "utf8");
const operationsService = fs.readFileSync(new URL("../server/src/services/event-operations-service.js", import.meta.url), "utf8");
const intelligenceService = fs.readFileSync(new URL("../server/src/services/operational-intelligence-service.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const eventDetail = fs.readFileSync(new URL("../src/pages/EventDetail.jsx", import.meta.url), "utf8");
const myEvents = fs.readFileSync(new URL("../src/pages/MyEvents.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

test("phase 9 migration separates commercial status from operational execution state", () => {
  for (const token of [
    "operational_status",
    "operational_status_changed_at",
    "en_route_at",
    "setup_started_at",
    "breakdown_completed_at",
    "gallery_status",
    "event_completed_at"
  ]) {
    assert.match(migration, new RegExp(token));
  }
  assert.match(migration, /CHECK \(operational_status IN \('PREPARING','READY','EN_ROUTE','ON_SITE','SETTING_UP','LIVE','BREAKDOWN','COMPLETED','ISSUE_REPORTED'\)\)/);
});

test("phase 9 schema adds checklist templates, staff acknowledgements, equipment lifecycle, and incident records", () => {
  for (const token of [
    "CREATE TABLE IF NOT EXISTS checklist_templates",
    "CREATE TABLE IF NOT EXISTS checklist_template_items",
    "CREATE TABLE IF NOT EXISTS event_incidents",
    "CREATE TABLE IF NOT EXISTS event_creative_requirements",
    "CREATE TABLE IF NOT EXISTS event_notes",
    "CREATE TABLE IF NOT EXISTS equipment_kits",
    "acknowledgement_status",
    "lifecycle_status",
    "asset_uid",
    "qr_token",
    "read:attendant"
  ]) {
    assert.match(migration, new RegExp(token));
  }
});

test("event operations service centralizes readiness, attendant access, lifecycle actions, and branded run sheets", () => {
  for (const fn of [
    "getEventOperations",
    "instantiateChecklist",
    "updateChecklistItem",
    "transitionOperationalStatus",
    "acknowledgeAssignment",
    "updateEquipmentLifecycle",
    "createIncident",
    "upsertCreative",
    "completeEvent",
    "attendantHome",
    "generateRunSheetPdf",
    "operationsAnalytics"
  ]) {
    assert.match(operationsService, new RegExp(`export async function ${fn}`));
  }
  assert.match(operationsService, /userCanAccessEvent/);
  assert.match(operationsService, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(operationsService, /EVENT RUN SHEET/);
  assert.match(operationsService, /triggerAutomations/);
});

test("admin API exposes event operations and attendant-only event workflows", () => {
  for (const route of [
    "/events/:id/operations",
    "/events/:id/operations/status",
    "/events/:id/operations/complete",
    "/events/:id/operations/reschedule",
    "/events/:id/checklists/instantiate",
    "/events/:id/checklist-items/:itemId",
    "/events/:id/incidents",
    "/events/:id/gallery",
    "/events/:id/run-sheet.pdf",
    "/my-events",
    "/my-events/:id"
  ]) {
    assert.match(adminRoutes, new RegExp(route.replace(/[/:.]/g, (match) => match === "/" ? "\\/" : ".")));
  }
  assert.match(adminRoutes, /requirePermission\("read:attendant"\)/);
  assert.match(adminRoutes, /operationsAnalytics/);
});

test("frontend adds operations tab and attendant mobile experience without exposing finance", () => {
  assert.match(app, /\/my-events/);
  assert.match(app, /roles\?\.includes\("ATTENDANT"\)/);
  assert.match(app, /!\w+\.roles\?\.some\(\(role\) => \["OWNER", "ADMIN", "EVENT_MANAGER"\]\.includes\(role\)\)/);
  assert.match(eventDetail, /const tabs = \["Overview", "Operations"/);
  assert.match(eventDetail, /Apply Checklist Template/);
  assert.match(eventDetail, /Download Run Sheet/);
  assert.match(myEvents, /function MyEventsShell/);
  assert.match(myEvents, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(myEvents, /api\.download/);
  assert.doesNotMatch(myEvents, /finance\/invoices|finance\/payments|balance_due|booked_total/);
});

test("dashboard intelligence includes event-day operational alerts and incident escalation", () => {
  assert.match(intelligenceService, /operational_status/);
  assert.match(intelligenceService, /EVENT_DAY_STATUS/);
  assert.match(intelligenceService, /CRITICAL_INCIDENT/);
});

test("phase 9 styles support touch-friendly attendant controls and readiness panels", () => {
  for (const token of [
    ".attendant-shell",
    ".attendant-header",
    ".attendant-hero",
    ".attendant-card",
    ".thumb-action",
    ".checklist-touch",
    ".readiness-score",
    ".checklist-admin-item"
  ]) {
    assert.match(styles, new RegExp(token.replace(".", "\\.")));
  }
});
