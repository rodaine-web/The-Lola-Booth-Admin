import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/010_phase_7_operational_intelligence.sql", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../server/src/services/operational-intelligence-service.js", import.meta.url), "utf8");
const ranges = fs.readFileSync(new URL("../server/src/utils/date-ranges.js", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
const calendar = fs.readFileSync(new URL("../src/pages/Calendar.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../src/pages/Settings.jsx", import.meta.url), "utf8");

test("phase 7 migration adds operational dashboard and calendar settings", () => {
  for (const snippet of [
    "business_week_start",
    "default_equipment_turnaround_buffer_minutes",
    "default_staff_travel_buffer_minutes",
    "idx_events_event_date_status",
    "idx_tasks_due_status",
    "idx_proposals_status_dates",
    "idx_invoices_balance_due"
  ]) {
    assert.match(migration, new RegExp(snippet));
  }
});

test("dashboard and calendar routes use operational intelligence service", () => {
  assert.match(route, /getOperationalDashboard/);
  assert.match(route, /getOperationalCalendar/);
  assert.match(route, /req\.query\.range \|\| "today"/);
  assert.match(route, /filters: req\.query/);
});

test("dashboard service computes range groups, comparisons, funnel, alerts, and definitions", () => {
  for (const snippet of [
    "Today at LOLA",
    "This Week at LOLA",
    "LOLA Month to Date",
    "LOLA Year to Date",
    "previousDay",
    "equivalentPriorMonthPeriod",
    "sameYtdPeriodPreviousYear",
    "Sales",
    "Revenue",
    "Events",
    "Operations",
    "salesFunnel",
    "leadSourcePerformance",
    "Needs Attention",
    "Metric Definitions",
    "Booked revenue is the sum of booking totals"
  ]) {
    assert.match(service + dashboard, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("date ranges support configurable business week start", () => {
  assert.match(ranges, /weekStart = 1/);
  assert.match(ranges, /normalizedWeekStart/);
  assert.match(ranges, /weekOffset/);
  assert.match(settings, /business_week_start/);
});

test("calendar supports production controls, filters, legend, phases, and readiness", () => {
  for (const snippet of [
    "Today",
    "Clear Filters",
    "staffId",
    "equipmentId",
    "calendarLegend",
    "phases",
    "readiness_status",
    "Setup",
    "Live",
    "Breakdown",
    "ITEMS NEED ATTENTION"
  ]) {
    assert.match(service + calendar, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("role-aware calendar protects attendant views from financial details", () => {
  assert.match(service, /roles\?\.includes\("ATTENDANT"\)/);
  assert.match(service, /redactForRole/);
  assert.match(service, /const \{ balance_due, total, \.\.\.safe \} = event/);
});
