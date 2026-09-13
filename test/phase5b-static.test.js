import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const assetDir = new URL("../public/brand/", import.meta.url);
const documentService = fs.readFileSync(new URL("../server/src/services/document-service.js", import.meta.url), "utf8");
const proposalService = fs.readFileSync(new URL("../server/src/services/proposal-service.js", import.meta.url), "utf8");
const invoiceService = fs.readFileSync(new URL("../server/src/services/invoice-service.js", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");
const login = fs.readFileSync(new URL("../src/pages/Login.jsx", import.meta.url), "utf8");
const publicProposal = fs.readFileSync(new URL("../src/pages/PublicProposal.jsx", import.meta.url), "utf8");
const publicInvoice = fs.readFileSync(new URL("../src/pages/PublicInvoice.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../src/pages/Settings.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("approved LOLA brand package assets are available and mapped", () => {
  for (const filename of [
    "LOLA_Primary_Dark_Transparent.png",
    "LOLA_Primary_Light_Transparent.png",
    "LOLA_Horizontal_Dark_Transparent.png",
    "LOLA_Horizontal_Light_Transparent.png",
    "LOLA_LB_Monogram_Gold.png",
    "LOLA_Favicon_512.png"
  ]) {
    assert.ok(fs.existsSync(new URL(filename, assetDir)), `${filename} should exist`);
  }
  assert.match(index, /LOLA_Favicon_512\.png/);
});

test("admin and public surfaces use approved logo variants", () => {
  assert.match(layout, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(layout, /brand-logo-admin-stacked/);
  assert.match(login, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(publicProposal, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(publicInvoice, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(publicProposal, /brand-logo-public-stacked/);
  assert.match(publicInvoice, /brand-logo-public-stacked/);
  assert.doesNotMatch(`${layout}\n${login}\n${publicProposal}\n${publicInvoice}`, /lola-booth-logo\.jpg/);
});

test("brand settings and CSS expose the Phase 5B visual system", () => {
  for (const token of ["#FAF7F1", "#D9C6A8", "#B89B6B", "#1A1A1A", "#E8DDD0", "Montserrat", "Playfair Display"]) {
    assert.match(css + settings, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(settings, /LOLA_LB_Monogram_Gold\.png/);
  assert.match(settings, /Proposal Logo|Invoice Logo|Email Logo|Default approved assets/s);
});

test("proposal, invoice, receipt, and email outputs use branded language", () => {
  for (const snippet of [
    "EVENT PROPOSAL",
    "Your event. Their favorite memory.",
    "Your LOLA Experience",
    "Your Package",
    "Your Investment",
    "What Happens Next",
    "Let's make it official.",
    "LOLA_Horizontal_Dark_Transparent.png",
    "LOLA_Primary_Dark_Transparent.png",
    "LOLA_LB_Monogram_Gold.png"
  ]) {
    assert.match(documentService, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(documentService, /RECEIPT/);
  assert.match(proposalService, /Review and accept your proposal/);
  assert.match(invoiceService, /View or pay securely/);
});

test("public customer payment and acceptance states are branded", () => {
  assert.match(publicInvoice, /payment\"\) === \"success\"/);
  assert.match(publicInvoice, /Payment received\./);
  assert.match(publicProposal, /Let's make it official\./);
  assert.match(publicInvoice, /metric-strong/);
});

test("website logo rule prioritizes stacked logo for public headers and documents", () => {
  assert.doesNotMatch(publicProposal, /LOLA_Horizontal_Dark_Transparent\.png/);
  assert.doesNotMatch(publicInvoice, /LOLA_Horizontal_Dark_Transparent\.png/);
  assert.match(css, /brand-logo-public-stacked/);
  assert.match(documentService, /asset: "primaryDark", label: "INVOICE"/);
  assert.match(documentService, /asset: "primaryDark", label: "RECEIPT"/);
});
