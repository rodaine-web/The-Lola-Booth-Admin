import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const admin = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../server/migrations/033_event_multi_service_selections.sql", import.meta.url), "utf8");

test("event create/update SQL keeps PostgreSQL parameter placeholders", () => {
  assert.ok(admin.includes('fields.map((_, i) => `$${i + 1}`)'));
  assert.ok(admin.includes('fields.map((field,index)=>`${field}=$${index+1}`)'));
  assert.ok(admin.includes('WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *'));
});

test("event dashboard filters keep PostgreSQL parameter placeholders", () => {
  assert.ok(admin.includes('where.push(`event_type = ${params.length}`);'));
  assert.ok(admin.includes('b.created_at >= ${params.length}::timestamptz'));
  assert.ok(admin.includes('b.created_at < ${params.length}::timestamptz'));
  assert.ok(admin.includes('where.push(`event_date < ${params.length}::date`);'));
  assert.ok(!admin.includes('where.push(`event_type = ${params.length}`);'));
  assert.ok(!admin.includes('b.created_at >= ${params.length}::timestamptz'));
  assert.ok(!admin.includes('b.created_at < ${params.length}::timestamptz'));
  assert.ok(!admin.includes('where.push(`event_date < ${params.length}::date`);'));
});

test("event multi-service selections persist in join tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_packages/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_experiences/);
  assert.match(admin, /INSERT INTO event_packages \(event_id, package_id, display_order\)/);
  assert.match(admin, /INSERT INTO event_experiences \(event_id, experience_id, display_order\)/);
});
