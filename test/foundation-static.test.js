import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { decryptSecretJson, encryptSecretJson } from "../server/src/services/integration-secrets.js";

const migration = fs.readFileSync(new URL("../server/migrations/003_phase_1_foundation.sql", import.meta.url), "utf8");
const seed = fs.readFileSync(new URL("../server/seeds/seed.js", import.meta.url), "utf8");

test("migration creates required Phase 1 foundation tables", () => {
  for (const table of [
    "proposal_versions",
    "proposal_deliveries",
    "payment_attempts",
    "refunds",
    "payment_gateway_events",
    "email_messages",
    "media_library",
    "website_hero_slides",
    "website_gallery_items",
    "website_content",
    "testimonials",
    "faqs",
    "integration_connections",
    "integration_field_maps",
    "webhook_events",
    "document_templates"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test("media and website content default to private or draft states", () => {
  assert.match(migration, /visibility TEXT NOT NULL DEFAULT 'PRIVATE'/);
  assert.match(migration, /permission_state TEXT NOT NULL DEFAULT 'UNKNOWN'/);
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'DRAFT'/);
});

test("seed defines package popularity and canonical event manager role", () => {
  assert.match(seed, /most_popular = \(name = 'THE SIGNATURE'\)/);
  assert.match(seed, /EVENT_MANAGER/);
  assert.doesNotMatch(seed, /"EVENT MANAGER"/);
});

test("integration secrets encrypt and decrypt without exposing plaintext", () => {
  const payload = { accessToken: "secret-token", refreshToken: "refresh-token" };
  const encrypted = encryptSecretJson(payload);
  assert.notEqual(JSON.stringify(encrypted), JSON.stringify(payload));
  assert.doesNotMatch(JSON.stringify(encrypted), /secret-token/);
  assert.deepEqual(decryptSecretJson(encrypted), payload);
});
