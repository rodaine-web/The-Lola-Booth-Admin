-- Split already-approved CMS page copy into independently managed records.
-- Values come from the current database, preserving edits made since import.
CREATE TABLE website_page_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 page_slug TEXT NOT NULL,
 slot_key TEXT NOT NULL UNIQUE,
 html TEXT NOT NULL DEFAULT '',
 href TEXT,
 display_order INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 created_by UUID REFERENCES users(id), updated_by UUID REFERENCES users(id),
 published_by UUID REFERENCES users(id), published_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
INSERT INTO website_page_items(page_slug,slot_key,html,href,display_order,status,published_at)
SELECT substring(c.content_key FROM 6), item.key, COALESCE(item.value->>'html',''),item.value->>'href',
       row_number() OVER(PARTITION BY c.id ORDER BY item.key),c.status,c.published_at
FROM website_content c CROSS JOIN LATERAL jsonb_each(COALESCE(c.body->'copy','{}'::jsonb)) item
WHERE c.content_key LIKE 'page.%' AND c.deleted_at IS NULL
ON CONFLICT(slot_key) DO NOTHING;
CREATE TABLE website_media_mappings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),asset_key TEXT NOT NULL UNIQUE,
 media_id UUID NOT NULL REFERENCES media_library(id),display_order INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 created_by UUID REFERENCES users(id),updated_by UUID REFERENCES users(id),published_by UUID REFERENCES users(id),published_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),deleted_at TIMESTAMPTZ
);
INSERT INTO website_media_mappings(asset_key,media_id,display_order,status,published_at)
SELECT item.key,m.id,row_number() OVER(ORDER BY item.key),c.status,c.published_at
FROM website_content c CROSS JOIN LATERAL jsonb_each_text(c.body) item
JOIN media_library m ON item.value='/api/public/media/'||m.id::text
WHERE c.content_key='website.media' AND c.deleted_at IS NULL
ON CONFLICT(asset_key) DO NOTHING;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS website_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(website_status IN ('DRAFT','PUBLISHED','ARCHIVED'));
UPDATE experiences SET website_status='PUBLISHED' WHERE active=true AND show_on_website=true AND deleted_at IS NULL;

-- Move per-experience and per-event presentation into their actual CMS records.
ALTER TABLE experiences ADD COLUMN website_heading TEXT;
ALTER TABLE experiences ADD COLUMN website_kicker TEXT;
ALTER TABLE experiences ADD COLUMN website_label TEXT;
UPDATE experiences e SET website_heading=item.value->>'heading',website_kicker=item.value->>'kicker',website_label=item.value->>'pageLabel'
FROM website_content c CROSS JOIN LATERAL jsonb_each(c.body) item
WHERE c.content_key='experience.details' AND c.deleted_at IS NULL AND lower(e.name) LIKE '%'||item.key||'%';
ALTER TABLE website_event_types ADD COLUMN home_display_order INTEGER;
ALTER TABLE website_event_types ADD COLUMN home_description TEXT;
UPDATE website_event_types e SET home_display_order=(item.value->>'order')::integer,home_description=item.value->>'description'
FROM website_content c CROSS JOIN LATERAL jsonb_array_elements(c.body) item
WHERE c.content_key='events.home_order' AND c.deleted_at IS NULL AND e.slug=item.value->>'slug';
