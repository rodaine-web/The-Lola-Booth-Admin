import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const login = fs.readFileSync(new URL("../src/pages/Login.jsx", import.meta.url), "utf8");
const seed = fs.readFileSync(new URL("../server/seeds/seed.js", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const goLive = fs.readFileSync(new URL("../docs/LOLA_GO_LIVE_CHECKLIST.md", import.meta.url), "utf8");

test("final certification removes default owner credentials from active login and seed paths", () => {
  for (const source of [login, seed, readme, goLive]) {
    assert.doesNotMatch(source, /LolaAdmin!2026/);
  }
  assert.match(login, /useState\(""\)/);
  assert.match(seed, /SEED_OWNER_EMAIL/);
  assert.match(seed, /SEED_OWNER_PASSWORD/);
  assert.match(seed, /required before running seeds/);
  assert.match(seed, /at least 14 characters/);
});

test("final certification active docs describe explicit credential bootstrap", () => {
  assert.match(readme, /SEED_OWNER_EMAIL/);
  assert.match(readme, /SEED_OWNER_PASSWORD/);
  assert.match(readme, /refuses to create an owner account without explicit credentials/);
  assert.match(goLive, /Default seed credential removed from active source/);
  assert.match(goLive, /Active login UI ships empty fields/);
});
