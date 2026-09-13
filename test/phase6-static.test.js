import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/009_phase_6_website_cms.sql", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");
const cmsService = fs.readFileSync(new URL("../server/src/services/website-cms-service.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");
const websiteCms = fs.readFileSync(new URL("../src/pages/WebsiteCms.jsx", import.meta.url), "utf8");
const serverIndex = fs.readFileSync(new URL("../server/src/index.js", import.meta.url), "utf8");

test("phase 6 migration extends CMS, media, SEO, and website event schema", () => {
  for (const snippet of [
    "ALTER TABLE media_library ADD COLUMN IF NOT EXISTS original_filename",
    "ALTER TABLE media_library ADD COLUMN IF NOT EXISTS width",
    "ALTER TABLE media_library ADD COLUMN IF NOT EXISTS thumbnail_key",
    "ALTER TABLE media_library ADD COLUMN IF NOT EXISTS usage_count",
    "ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS focal_x",
    "ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS desktop_image_file_id",
    "ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS category",
    "ALTER TABLE website_content ADD COLUMN IF NOT EXISTS published_by",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS show_on_website",
    "ALTER TABLE experiences ADD COLUMN IF NOT EXISTS website_long_description",
    "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_meta_description",
    "CREATE TABLE IF NOT EXISTS website_event_types",
    "CREATE TABLE IF NOT EXISTS website_content_versions"
  ]) {
    assert.match(migration, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("admin exposes authenticated website CMS, media, preview, and publish routes", () => {
  for (const snippet of [
    '"/website/defaults"',
    '"/website/preview"',
    '"/website/site-settings"',
    '"/website/media"',
    '"/website/media/:id/file"',
    '"/website/:type/:id/publish"',
    '"/website/:type/:id/unpublish"',
    '"/website/:type/:id/archive"',
    '"/website/:type/reorder"'
  ]) {
    assert.match(adminRoutes, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(adminRoutes, /requirePermission\("publish:website"\)/);
  assert.match(adminRoutes, /website_media_uploaded/);
});

test("public website API returns CMS-safe read-only content", () => {
  for (const route of [
    '"/site"',
    '"/homepage"',
    '"/hero-slides"',
    '"/packages"',
    '"/experiences"',
    '"/events"',
    '"/gallery"',
    '"/testimonials"',
    '"/faqs"',
    '"/media/:id"'
  ]) {
    assert.match(publicRoutes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(publicRoutes, /Cache-Control/);
  assert.match(cmsService, /visibility='PUBLIC' AND permission_state='APPROVED'/);
  assert.match(cmsService, /status='PUBLISHED'/);
  assert.match(cmsService, /fallbackHeroSlide/);
  assert.match(cmsService, /LOLA_Primary_Dark_Transparent\.png/);
});

test("media upload validation and usage safety are implemented", () => {
  assert.match(serverIndex, /express\.json\(\{ limit: "14mb" \}\)/);
  assert.match(cmsService, /MAX_UPLOAD_BYTES = 10 \* 1024 \* 1024/);
  assert.match(cmsService, /allowedImageTypes/);
  assert.match(cmsService, /assertMagicBytes/);
  assert.match(cmsService, /readImageDimensions/);
  assert.match(cmsService, /MEDIA_IN_USE/);
  assert.match(cmsService, /DO_NOT_PUBLISH/);
  assert.match(cmsService, /ALT_TEXT_REQUIRED/);
  assert.match(cmsService, /LAST_HERO_SLIDE/);
});

test("frontend adds Website CMS navigation and screens", () => {
  for (const label of ["Homepage", "Hero Slides", "Gallery", "Packages", "Experiences", "Events", "Testimonials", "FAQ", "Media Library", "SEO / Site Settings"]) {
    assert.match(layout, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const route of ["website/homepage", "website/hero-slides", "website/gallery", "website/packages", "website/experiences", "website/events", "website/testimonials", "website/faq", "website/media-library", "website/site-settings"]) {
    assert.match(app, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(websiteCms, /Save Draft/);
  assert.match(websiteCms, /Publish/);
  assert.match(websiteCms, /Upload media/);
  assert.match(websiteCms, /Draft preview payload loaded/);
});

test("website logo rule remains stacked-first for public website controls", () => {
  assert.match(websiteCms, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(websiteCms, /LOLA_Primary_Light_Transparent\.png/);
  assert.match(cmsService, /Public website headers use the approved vertical\/stacked LOLA logo by default/);
});
