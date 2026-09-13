import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/005_phase_2_operational_core.sql", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const leadDetail = fs.readFileSync(new URL("../src/pages/LeadDetail.jsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");

test("phase 2 migration adds operational event, lead, client, and content fields", () => {
  for (const snippet of [
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS company",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_contact_method",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS event_number",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS parking_loading_instructions",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS short_description",
    "ALTER TABLE experiences ADD COLUMN IF NOT EXISTS setup_duration",
    "ALTER TABLE addons ADD COLUMN IF NOT EXISTS taxable",
    "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_balance_due_days"
  ]) {
    assert.match(migration, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("package most popular is protected by a partial unique index and service logic", () => {
  assert.match(migration, /idx_packages_one_most_popular/);
  assert.match(routes, /UPDATE packages SET most_popular=false/);
});

test("phase 2 operational routes are present", () => {
  for (const route of [
    '"/events/:id"',
    '"/events/:id/staff"',
    '"/events/:id/equipment"',
    '"/events/:id/communications"',
    '"/clients/:id"',
    '"/tasks/:id"',
    '"/settings"'
  ]) {
    assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("lead conversion uses in-app review instead of browser confirm", () => {
  assert.doesNotMatch(leadDetail, /window\.confirm/);
  assert.match(leadDetail, /Review Conversion/);
});

test("sidebar filters navigation items by permissions", () => {
  assert.match(layout, /visibleItems = section\.items\.filter/);
  assert.match(layout, /can\(item\.permission\)/);
});
