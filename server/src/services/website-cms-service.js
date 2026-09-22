import path from "node:path";
import { projectWebsitePackage } from "./website-pricing.js";
import { query, transaction } from "../db/pool.js";
import { getStorageProvider } from "./storage-service.js";
import { AppError, notFound } from "../utils/errors.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedDocumentTypes = new Set(["application/pdf"]);
const galleryCategories = [
  "ALL",
  "WEDDINGS",
  "BIRTHDAYS",
  "CORPORATE",
  "SHOWERS",
  "GRADUATIONS",
  "GLAM",
  "360",
  "VOGUE",
  "BRAND ACTIVATIONS",
  "PRIVATE EVENTS"
];

export const cmsTables = {
  hero: {
    table: "website_hero_slides",
    entity: "website_hero_slide",
    search: ["headline", "subheadline", "caption", "alt_text"],
    sortable: ["display_order", "created_at", "updated_at", "published_at"],
    allowed: ["desktop_image_file_id", "image_media_id", "tablet_image_file_id", "mobile_image_media_id", "alt_text", "caption", "headline", "subheadline", "cta_label", "cta_url", "display_order", "is_active", "publish_start", "publish_end", "focal_x", "focal_y", "status"]
  },
  gallery: {
    table: "website_gallery_items",
    entity: "website_gallery_item",
    search: ["title", "caption", "alt_text", "category"],
    sortable: ["display_order", "created_at", "updated_at", "published_at"],
    allowed: ["media_id", "event_id", "client_id", "title", "caption", "alt_text", "category", "tags", "display_order", "is_featured", "status"]
  },
  content: {
    table: "website_content",
    entity: "website_content",
    search: ["content_key", "title", "seo_title", "seo_description"],
    sortable: ["content_key", "updated_at", "published_at"],
    allowed: ["content_key", "title", "body", "seo_title", "seo_description", "status"]
  },
  testimonials: {
    table: "testimonials",
    entity: "testimonial",
    search: ["client_name", "client_display_name", "event_type", "quote"],
    sortable: ["display_order", "created_at", "updated_at", "published_at"],
    allowed: ["client_name", "client_display_name", "event_type", "quote", "rating", "display_order", "status", "client_photo_media_id", "is_featured"]
  },
  faqs: {
    table: "faqs",
    entity: "faq",
    search: ["question", "answer", "category"],
    sortable: ["display_order", "created_at", "updated_at", "published_at"],
    allowed: ["question", "answer", "category", "display_order", "status"]
  },
  eventTypes: {
    table: "website_event_types",
    entity: "website_event_type",
    search: ["name", "slug", "short_description", "long_description"],
    sortable: ["display_order", "created_at", "updated_at", "published_at"],
    allowed: ["name", "slug", "short_description", "long_description", "image_media_id", "display_order", "show_on_website", "seo_title", "meta_description", "status"]
  }
};

export function websiteContentDefaults() {
  return {
    logo: {
      primaryLight: "/brand/LOLA_Primary_Light_Transparent.png",
      primaryDark: "/brand/LOLA_Primary_Dark_Transparent.png",
      fallbackMonogram: "/brand/LOLA_LB_Monogram_Gold.png",
      rule: "Public website headers use the approved vertical/stacked LOLA logo by default."
    },
    homepage: {
      hero: {
        headline: "Your event.\nTheir favorite memory.",
        primaryCtaLabel: "Book Now",
        primaryCtaUrl: "/book-now"
      },
      banner: ["GRADUATIONS", "WEDDINGS", "BIRTHDAYS", "BRAND ACTIVATIONS", "CORPORATE PARTIES", "SHOWERS", "PRIVATE EVENTS"]
    },
    galleryCategories
  };
}

export async function uploadMedia(req) {
  const { filename, mimeType, data, altText, caption, tags = [], visibility = "PRIVATE", permissionState = "UNKNOWN", mediaType = "IMAGE", width, height } = req.body;
  if (!filename || !mimeType || !data) throw new AppError("Upload requires filename, MIME type, and base64 data.", 400, "UPLOAD_REQUIRED_FIELDS");
  const cleanMime = String(mimeType).toLowerCase();
  if (!allowedImageTypes.has(cleanMime) && !allowedDocumentTypes.has(cleanMime)) throw new AppError("Unsupported file type.", 400, "BAD_MIME");
  const buffer = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) throw new AppError("File is empty or larger than 10 MB.", 400, "BAD_FILE_SIZE");
  assertMagicBytes(buffer, cleanMime);
  const dimensions = allowedImageTypes.has(cleanMime) ? readImageDimensions(buffer, cleanMime) : {};
  const storage = getStorageProvider();
  const stored = await storage.put({ buffer, filename: path.basename(filename) });
  const media = await query(
    `INSERT INTO media_library (
      filename, original_filename, alt_text, caption, tags, mime_type, size_bytes, file_size,
      width, height, storage_provider, storage_key, thumbnail_key, visibility,
      permission_state, media_type, uploaded_by, updated_by
    ) VALUES ($1,$1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$14)
    RETURNING *`,
    [
      path.basename(filename),
      altText || null,
      caption || null,
      normalizeTags(tags),
      cleanMime,
      buffer.length,
      Number(width || dimensions.width || 0) || null,
      Number(height || dimensions.height || 0) || null,
      stored.storageProvider,
      stored.storageKey,
      visibility,
      permissionState,
      mediaType,
      req.user.id
    ]
  );
  return withUsage(media.rows[0]);
}

export async function listMedia({ search = "", visibility, mediaType } = {}) {
  const params = [];
  const where = ["deleted_at IS NULL"];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(filename ILIKE $${params.length} OR alt_text ILIKE $${params.length} OR caption ILIKE $${params.length} OR $${params.length} = ANY(tags))`);
  }
  if (visibility) {
    params.push(visibility);
    where.push(`visibility=$${params.length}`);
  }
  if (mediaType) {
    params.push(mediaType);
    where.push(`media_type=$${params.length}`);
  }
  const rows = await query(`SELECT * FROM media_library WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 100`, params);
  return Promise.all(rows.rows.map(withUsage));
}

export async function updateMedia(req, id) {
  const allowed = ["filename", "alt_text", "caption", "tags", "visibility", "permission_state", "media_type"];
  const fields = Object.keys(req.body).filter((field) => allowed.includes(field));
  if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
  const before = await getById("media_library", id);
  const values = fields.map((field) => field === "tags" ? normalizeTags(req.body[field]) : req.body[field]);
  values.push(req.user.id, id);
  const updated = await query(
    `UPDATE media_library SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_by=$${values.length - 1}, updated_at=now()
     WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *`,
    values
  );
  return { before, after: await withUsage(updated.rows[0]) };
}

export async function archiveMedia(id) {
  const media = await withUsage(await getById("media_library", id));
  if (media.usage_count > 0) throw new AppError("Resolve active website references before archiving this media item.", 409, "MEDIA_IN_USE", { usage: media.usage });
  const updated = await query("UPDATE media_library SET visibility='ARCHIVED', archived_at=now(), deleted_at=now(), updated_at=now() WHERE id=$1 RETURNING *", [id]);
  return { before: media, after: updated.rows[0] };
}

export async function listCmsRecords(type, filters = {}) {
  const config = cmsTables[type];
  if (!config) throw notFound("CMS type");
  const params = [];
  const where = ["deleted_at IS NULL"];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(${config.search.map((field) => `${field}::text ILIKE $${params.length}`).join(" OR ")})`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`status=$${params.length}`);
  }
  const sort = config.sortable.includes(filters.sort || filters.sort_by) ? (filters.sort || filters.sort_by) : config.sortable[0];
  const direction = String(filters.sort_direction || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const rows = await query(`SELECT * FROM ${config.table} WHERE ${where.join(" AND ")} ORDER BY ${sort} ${direction}, created_at DESC LIMIT 100`, params);
  return rows.rows;
}

export async function createCmsRecord(req, type) {
  const config = cmsTables[type];
  if (!config) throw notFound("CMS type");
  const body = normalizeCmsBody(type, req.body, config.allowed);
  await assertPublishable(type, body);
  const fields = Object.keys(body).concat(["created_by", "updated_by"]);
  const values = Object.values(body).concat([req.user.id, req.user.id]);
  const inserted = await query(`INSERT INTO ${config.table} (${fields.join(",")}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(",")}) RETURNING *`, values);
  return inserted.rows[0];
}

export async function updateCmsRecord(req, type, id) {
  const config = cmsTables[type];
  if (!config) throw notFound("CMS type");
  const before = await getById(config.table, id);
  const body = normalizeCmsBody(type, req.body, config.allowed);
  await assertPublishable(type, { ...before, ...body });
  const fields = Object.keys(body);
  if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
  const values = fields.map((field) => body[field]).concat([req.user.id, id]);
  const updated = await query(
    `UPDATE ${config.table} SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_by=$${values.length - 1}, updated_at=now()
     WHERE id=$${values.length} AND deleted_at IS NULL RETURNING *`,
    values
  );
  await recordVersion(req.user.id, config.entity, id, before, "updated");
  return { before, after: updated.rows[0] };
}

export async function publishCmsRecord(req, type, id) {
  const config = cmsTables[type];
  if (!config) throw notFound("CMS type");
  const before = await getById(config.table, id);
  await assertPublishable(type, before);
  const updated = await transaction(async (client) => {
    if (type === "hero") await assertHeroSafety(client, id, "publish");
    const result = await client.query(`UPDATE ${config.table} SET status='PUBLISHED', published_by=$1, published_at=now(), updated_by=$1, updated_at=now() WHERE id=$2 AND deleted_at IS NULL RETURNING *`, [req.user.id, id]);
    return result.rows[0];
  });
  await recordVersion(req.user.id, config.entity, id, before, "published");
  return { before, after: updated };
}

export async function unpublishCmsRecord(req, type, id) {
  const config = cmsTables[type];
  if (!config) throw notFound("CMS type");
  const before = await getById(config.table, id);
  const updated = await transaction(async (client) => {
    if (type === "hero") await assertHeroSafety(client, id, "unpublish");
    const result = await client.query(`UPDATE ${config.table} SET status='DRAFT', updated_by=$1, updated_at=now() WHERE id=$2 AND deleted_at IS NULL RETURNING *`, [req.user.id, id]);
    return result.rows[0];
  });
  await recordVersion(req.user.id, config.entity, id, before, "unpublished");
  return { before, after: updated };
}

export async function archiveCmsRecord(req, type, id) {
  const config = cmsTables[type];
  if (!config) throw notFound("CMS type");
  const before = await getById(config.table, id);
  const updated = await query(`UPDATE ${config.table} SET status='ARCHIVED', deleted_at=now(), updated_by=$1, updated_at=now() WHERE id=$2 RETURNING *`, [req.user.id, id]);
  await recordVersion(req.user.id, config.entity, id, before, "archived");
  return { before, after: updated.rows[0] };
}

export async function reorderCmsRecords(req, type, orderedIds) {
  const config = cmsTables[type];
  if (!config) throw notFound("CMS type");
  if (!Array.isArray(orderedIds)) throw new AppError("Order must be an array of ids.", 400, "BAD_ORDER");
  await transaction(async (client) => {
    for (const [index, id] of orderedIds.entries()) {
      await client.query(`UPDATE ${config.table} SET display_order=$1, updated_by=$2, updated_at=now() WHERE id=$3`, [index + 1, req.user.id, id]);
    }
  });
}

export async function updateSiteSettings(req) {
  const allowed = ["contact_email", "phone", "service_area", "instagram_url", "tiktok_url", "facebook_url", "pinterest_url", "copyright_text", "brand_line", "site_title", "default_meta_description", "default_og_image_media_id", "canonical_domain", "social_share_title", "social_share_description", "show_starting_price"];
  const fields = Object.keys(req.body).filter((field) => allowed.includes(field));
  if (!fields.length) throw new AppError("No supported fields to update.", 400, "NO_FIELDS");
  const before = (await query("SELECT * FROM business_settings LIMIT 1")).rows[0] || {};
  const values = fields.map((field) => req.body[field]);
  const updated = await query(`UPDATE business_settings SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=now() RETURNING *`, values);
  await recordVersion(req.user.id, "site_settings", null, before, "updated");
  return { before, after: updated.rows[0] };
}

export async function publicSitePayload({ preview = false } = {}) {
  const statusFilter = preview ? "status <> 'ARCHIVED'" : "status='PUBLISHED'";
  const [settings, content, hero, packages, experiences, eventTypes, gallery, testimonials, faqs] = await Promise.all([
    query("SELECT business_name, business_email, contact_email, phone, website, service_area, instagram_url, tiktok_url, facebook_url, pinterest_url, copyright_text, brand_line, site_title, default_meta_description, canonical_domain, social_share_title, social_share_description, show_starting_price FROM business_settings LIMIT 1"),
    query(`SELECT content_key, title, body, seo_title, seo_description, status, updated_at, published_at FROM website_content WHERE deleted_at IS NULL AND ${statusFilter} ORDER BY content_key`),
    query(`SELECT h.id, h.alt_text, h.caption, h.headline, h.subheadline, h.cta_label, h.cta_url, h.display_order, h.focal_x, h.focal_y, h.publish_start, h.publish_end,
      desktop_image_file_id, mobile_image_media_id, m.id AS media_id, m.width, m.height, m.thumbnail_key
      FROM website_hero_slides h
      LEFT JOIN media_library m ON m.id=COALESCE(h.desktop_image_file_id, h.image_media_id)
      WHERE h.deleted_at IS NULL AND h.is_active=true AND ${statusFilter}
        AND (h.publish_start IS NULL OR h.publish_start <= now())
        AND (h.publish_end IS NULL OR h.publish_end >= now())
      ORDER BY h.display_order, h.created_at`),
    query(`SELECT p.id, p.name, p.short_description, p.website_short_description, p.website_description, p.starting_price, p.currency, p.most_popular, p.website_featured, p.website_display_order, p.website_key, p.experience_id, p.pricing_mode, p.website_features, p.website_custom_heading, p.website_home_description, p.updated_at, e.slug AS experience_slug FROM packages p LEFT JOIN experiences e ON e.id=p.experience_id WHERE p.deleted_at IS NULL AND p.active=true AND p.show_on_website=true AND ${preview ? "p.website_status <> 'ARCHIVED'" : "p.website_status='PUBLISHED'"} ORDER BY e.display_order, p.website_display_order, p.display_order, p.id`),
    query("SELECT id, slug, name, website_name, description, website_short_description, website_long_description, features, base_price, default_duration, website_featured, display_order, cover_image_media_id FROM experiences WHERE deleted_at IS NULL AND active=true AND show_on_website=true ORDER BY display_order, name"),
    query(`SELECT id, name, slug, short_description, long_description, image_media_id, display_order, seo_title, meta_description FROM website_event_types WHERE deleted_at IS NULL AND show_on_website=true AND ${statusFilter} ORDER BY display_order, name`),
    query(`SELECT g.id, g.title, g.caption, COALESCE(g.alt_text, m.alt_text) AS alt_text, g.category, g.tags, g.display_order, g.is_featured, m.id AS media_id, m.width, m.height, m.thumbnail_key
      FROM website_gallery_items g
      JOIN media_library m ON m.id=g.media_id
      WHERE g.deleted_at IS NULL AND ${preview ? "g.status <> 'ARCHIVED'" : "g.status='PUBLISHED'"} AND m.deleted_at IS NULL AND m.visibility='PUBLIC' AND m.permission_state='APPROVED'
      ORDER BY g.is_featured DESC, g.display_order, g.published_at DESC`),
    query(`SELECT id, COALESCE(client_display_name, client_name) AS client_display_name, event_type, quote, rating, is_featured, display_order, client_photo_media_id
      FROM testimonials WHERE deleted_at IS NULL AND ${statusFilter} ORDER BY is_featured DESC, display_order, created_at DESC`),
    query(`SELECT id, question, answer, category, display_order FROM faqs WHERE deleted_at IS NULL AND ${statusFilter} ORDER BY display_order, question`)
  ]);
  return {
    defaults: websiteContentDefaults(),
    settings: settings.rows[0] || {},
    content: Object.fromEntries(content.rows.map((row) => [row.content_key, row])),
    heroSlides: hero.rows.length ? hero.rows.map(projectHero) : [fallbackHeroSlide()],
    packages: packages.rows.map((row) => projectWebsitePackage(row, { showStartingPrice: settings.rows[0]?.show_starting_price !== false })),
    experiences: experiences.rows.map(projectExperience),
    eventTypes: eventTypes.rows.map(withMediaUrl),
    gallery: gallery.rows.map(projectGalleryItem),
    testimonials: testimonials.rows.map(withPhotoUrl),
    faqs: faqs.rows
  };
}

export async function publicGallery({ category, featured } = {}) {
  const payload = await publicSitePayload();
  return payload.gallery.filter((item) => (!category || category.toUpperCase() === "ALL" || item.category === category.toUpperCase()) && (featured === undefined || item.is_featured === featured));
}

export async function publicMedia(id) {
  const media = await query("SELECT * FROM media_library WHERE id=$1 AND deleted_at IS NULL AND visibility='PUBLIC' AND permission_state='APPROVED'", [id]);
  if (!media.rows[0]) throw notFound("Media");
  return media.rows[0];
}

export async function adminMedia(id) {
  return getById("media_library", id);
}

function normalizeCmsBody(type, source, allowed) {
  const body = {};
  for (const field of allowed) {
    if (source[field] !== undefined) body[field] = normalizeCmsValue(field, source[field]);
  }
  if (type === "hero" && body.desktop_image_file_id && !body.image_media_id) body.image_media_id = body.desktop_image_file_id;
  if (type === "eventTypes" && body.name && !body.slug) body.slug = slugify(body.name);
  return body;
}

function normalizeCmsValue(field, value) {
  if (value === "") return null;
  if (field === "body" && typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value)); } catch { throw new AppError("Body must be valid JSON.", 400, "BAD_JSON"); }
  }
  if (field === "body" && value && typeof value === "object") return JSON.stringify(value);
  if (field === "tags") return normalizeTags(value);
  return value;
}

async function assertPublishable(type, row) {
  if (row.status !== "PUBLISHED") return;
  if (type === "hero") {
    const mediaId = row.desktop_image_file_id || row.image_media_id;
    if (!mediaId) throw new AppError("Hero slides need an image before publishing.", 400, "HERO_IMAGE_REQUIRED");
    if (!row.alt_text) throw new AppError("Hero slides need meaningful alt text before publishing.", 400, "ALT_TEXT_REQUIRED");
    await assertMediaPublishable(mediaId, { requirePublic: false });
  }
  if (type === "gallery") {
    if (!row.media_id) throw new AppError("Gallery items need media before publishing.", 400, "GALLERY_MEDIA_REQUIRED");
    if (!row.alt_text) throw new AppError("Gallery items need alt text before publishing.", 400, "ALT_TEXT_REQUIRED");
    await assertMediaPublishable(row.media_id, { requirePublic: true });
  }
}

async function assertMediaPublishable(id, { requirePublic }) {
  const media = await getById("media_library", id);
  if (media.permission_state === "DO_NOT_PUBLISH") throw new AppError("This media is marked do not publish.", 403, "DO_NOT_PUBLISH");
  if (media.permission_state === "RESTRICTED") throw new AppError("This media is restricted and needs an authorized override before publishing.", 403, "RESTRICTED_MEDIA");
  if (requirePublic && media.visibility !== "PUBLIC") throw new AppError("Public gallery media must be marked PUBLIC before publishing.", 400, "MEDIA_NOT_PUBLIC");
}

async function assertHeroSafety(client, id, action) {
  if (action === "publish") return;
  const count = await client.query("SELECT count(*)::int AS count FROM website_hero_slides WHERE deleted_at IS NULL AND is_active=true AND status='PUBLISHED' AND id<>$1", [id]);
  if (count.rows[0].count < 1) throw new AppError("Keep at least one active published hero slide or configure a fallback before unpublishing.", 409, "LAST_HERO_SLIDE");
}

async function getById(table, id) {
  const result = await query(`SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL`, [id]);
  if (!result.rows[0]) throw notFound(table);
  return result.rows[0];
}

async function withUsage(media) {
  if (!media) return media;
  const usage = await mediaUsage(media.id);
  return { ...media, usage_count: usage.reduce((sum, item) => sum + item.count, 0), usage };
}

async function mediaUsage(id) {
  const checks = await Promise.all([
    query("SELECT count(*)::int AS count FROM website_hero_slides WHERE deleted_at IS NULL AND (image_media_id=$1 OR desktop_image_file_id=$1 OR tablet_image_file_id=$1 OR mobile_image_media_id=$1)", [id]),
    query("SELECT count(*)::int AS count FROM website_gallery_items WHERE deleted_at IS NULL AND media_id=$1", [id]),
    query("SELECT count(*)::int AS count FROM packages WHERE deleted_at IS NULL AND website_image_media_id=$1", [id]),
    query("SELECT count(*)::int AS count FROM experiences WHERE deleted_at IS NULL AND cover_image_media_id=$1", [id]),
    query("SELECT count(*)::int AS count FROM testimonials WHERE deleted_at IS NULL AND client_photo_media_id=$1", [id])
  ]);
  return [
    ["Hero Slide", checks[0].rows[0].count],
    ["Public Gallery", checks[1].rows[0].count],
    ["Package", checks[2].rows[0].count],
    ["Experience", checks[3].rows[0].count],
    ["Testimonial", checks[4].rows[0].count]
  ].filter(([, count]) => count > 0).map(([label, count]) => ({ label, count }));
}

async function recordVersion(userId, entityType, entityId, snapshot, action) {
  await query(
    "INSERT INTO website_content_versions (entity_type, entity_id, content_key, snapshot, action, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [entityType, entityId || null, snapshot?.content_key || null, JSON.stringify(snapshot || {}), action, userId]
  );
}

function projectHero(row) {
  const fallback = websiteContentDefaults();
  return {
    id: row.id,
    headline: row.headline || fallback.homepage.hero.headline,
    subheadline: row.subheadline || null,
    caption: row.caption || null,
    cta_label: row.cta_label || null,
    cta_url: row.cta_url || null,
    alt_text: row.alt_text,
    display_order: row.display_order,
    focal_point: { x: Number(row.focal_x || 50), y: Number(row.focal_y || 50) },
    image: mediaUrl(row.media_id),
    mobile_image: mediaUrl(row.mobile_image_media_id || row.media_id),
    thumbnail: mediaUrl(row.media_id),
    width: row.width,
    height: row.height
  };
}

function fallbackHeroSlide() {
  const defaults = websiteContentDefaults();
  return {
    id: "fallback-hero",
    headline: defaults.homepage.hero.headline,
    subheadline: "Editorial photo booth experiences for celebrations, brands, and beautifully designed gatherings.",
    caption: null,
    cta_label: defaults.homepage.hero.primaryCtaLabel,
    cta_url: defaults.homepage.hero.primaryCtaUrl,
    alt_text: "The LOLA Booth stacked logo",
    display_order: 0,
    focal_point: { x: 50, y: 50 },
    image: defaults.logo.primaryDark,
    mobile_image: defaults.logo.primaryDark,
    thumbnail: defaults.logo.fallbackMonogram,
    width: null,
    height: null,
    fallback: true
  };
}

function projectGalleryItem(row) {
  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    alt_text: row.alt_text,
    category: row.category,
    tags: row.tags || [],
    display_order: row.display_order,
    is_featured: row.is_featured,
    image: mediaUrl(row.media_id),
    thumbnail: mediaUrl(row.media_id),
    width: row.width,
    height: row.height
  };
}

function projectExperience(row) {
  return {
    ...row,
    website_name: row.website_name || row.name,
    public_description: row.website_long_description || row.website_short_description || row.description,
    image: mediaUrl(row.cover_image_media_id)
  };
}

function withMediaUrl(row) {
  return { ...row, image: mediaUrl(row.image_media_id) };
}

function withPhotoUrl(row) {
  return { ...row, client_photo: mediaUrl(row.client_photo_media_id) };
}

function mediaUrl(id) {
  return id ? `/api/public/media/${id}` : null;
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function assertMagicBytes(buffer, mimeType) {
  const ok =
    (mimeType === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8) ||
    (mimeType === "image/png" && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (mimeType === "image/webp" && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") ||
    (mimeType === "application/pdf" && buffer.slice(0, 4).toString("ascii") === "%PDF");
  if (!ok) throw new AppError("File content does not match the declared MIME type.", 400, "MIME_MISMATCH");
}

function readImageDimensions(buffer, mimeType) {
  if (mimeType === "image/png") return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (mimeType === "image/webp") return readWebpDimensions(buffer);
  if (mimeType === "image/jpeg") return readJpegDimensions(buffer);
  return {};
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + size;
  }
  return {};
}

function readWebpDimensions(buffer) {
  const type = buffer.slice(12, 16).toString("ascii");
  if (type === "VP8X") return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  if (type === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (type === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return {};
}

export function getGalleryCategories() {
  return galleryCategories;
}
