import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const leadDetail = fs.readFileSync(new URL("../src/pages/LeadDetail.jsx", import.meta.url), "utf8");
const clientDetail = fs.readFileSync(new URL("../src/pages/ClientDetail.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

test("phase 12 adds lead and client duplicate review APIs", () => {
  for (const route of [
    "/leads/:id/duplicates",
    "/leads/:id/merge",
    "/clients/:id/duplicates",
    "/clients/:id/merge"
  ]) {
    assert.match(adminRoutes, new RegExp(route.replace(/[/:]/g, (match) => match === "/" ? "\\/" : ".")));
  }
  assert.match(adminRoutes, /linkedCounts/);
  assert.match(adminRoutes, /lead_merged/);
  assert.match(adminRoutes, /client_merged/);
  assert.match(adminRoutes, /duplicate_of_lead_id/);
  assert.match(adminRoutes, /gallery_deliveries/);
});

test("phase 12 exposes duplicate merge controls on lead and client profiles", () => {
  for (const source of [leadDetail, clientDetail]) {
    assert.match(source, /Possible Duplicates/);
    assert.match(source, /loadDuplicates/);
    assert.match(source, /mergeDuplicate/);
    assert.match(source, /DuplicateList/);
    assert.match(source, /linkedCountLabel/);
  }
  assert.match(styles, /compact-record/);
  assert.match(styles, /stack-list/);
});
