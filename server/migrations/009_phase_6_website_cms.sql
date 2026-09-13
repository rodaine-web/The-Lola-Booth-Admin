ALTER TABLE media_library ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'IMAGE';
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE media_library SET original_filename = filename WHERE original_filename IS NULL;
UPDATE media_library SET file_size = size_bytes WHERE file_size IS NULL;

DO $$
BEGIN
  ALTER TABLE media_library DROP CONSTRAINT IF EXISTS media_library_visibility_check;
  ALTER TABLE media_library ADD CONSTRAINT media_library_visibility_check
  CHECK (visibility IN ('PRIVATE', 'INTERNAL', 'CLIENT_VISIBLE', 'PUBLIC', 'ARCHIVED'));
END $$;

DO $$
BEGIN
  ALTER TABLE media_library DROP CONSTRAINT IF EXISTS media_library_media_type_check;
  ALTER TABLE media_library ADD CONSTRAINT media_library_media_type_check
  CHECK (media_type IN ('IMAGE', 'DOCUMENT', 'VIDEO_REFERENCE', 'BRAND_ASSET'));
END $$;

ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS desktop_image_file_id UUID REFERENCES media_library(id);
ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS tablet_image_file_id UUID REFERENCES media_library(id);
ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS focal_x NUMERIC(5,2) NOT NULL DEFAULT 50;
ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS focal_y NUMERIC(5,2) NOT NULL DEFAULT 50;
ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);
ALTER TABLE website_hero_slides ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

UPDATE website_hero_slides SET desktop_image_file_id = image_media_id WHERE desktop_image_file_id IS NULL;

ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id);
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS alt_text TEXT;
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE website_gallery_items ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

ALTER TABLE website_content ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE website_content ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE website_content ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);
ALTER TABLE website_content ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS client_display_name TEXT;
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS client_photo_media_id UUID REFERENCES media_library(id);
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

UPDATE testimonials SET client_display_name = client_name WHERE client_display_name IS NULL;

ALTER TABLE faqs ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

ALTER TABLE packages ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_short_description TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_image_media_id UUID REFERENCES media_library(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_featured BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS website_name TEXT;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS website_short_description TEXT;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS website_long_description TEXT;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS website_featured BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS facebook_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS pinterest_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS copyright_text TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS site_title TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_meta_description TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_og_image_media_id UUID REFERENCES media_library(id);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS canonical_domain TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS social_share_title TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS social_share_description TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS show_starting_price BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS website_event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  short_description TEXT,
  long_description TEXT,
  image_media_id UUID REFERENCES media_library(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  show_on_website BOOLEAN NOT NULL DEFAULT true,
  seo_title TEXT,
  meta_description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  published_by UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS website_content_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  content_key TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}',
  action TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO website_event_types (name, slug, short_description, display_order, status)
VALUES
  ('Weddings', 'weddings', 'Elegant photo booth experiences for wedding weekends.', 1, 'DRAFT'),
  ('Birthdays', 'birthdays', 'Celebration-ready booth moments for milestone parties.', 2, 'DRAFT'),
  ('Corporate Events', 'corporate-events', 'Polished branded capture for teams and clients.', 3, 'DRAFT'),
  ('Showers', 'showers', 'Warm, stylish memories for showers and intimate gatherings.', 4, 'DRAFT'),
  ('Graduations', 'graduations', 'High-energy graduation and school celebration coverage.', 5, 'DRAFT'),
  ('Brand Activations', 'brand-activations', 'Interactive photo moments for campaigns and launches.', 6, 'DRAFT'),
  ('Private Events', 'private-events', 'A refined booth experience for private celebrations.', 7, 'DRAFT')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO website_content (content_key, title, body, status)
VALUES
  ('homepage.hero', 'Homepage Hero', '{"eyebrow":"Premium photo booths","headline":"Your event.\nTheir favorite memory.","subheadline":"Editorial photo booth experiences for celebrations, brands, and beautifully designed gatherings.","primaryCtaLabel":"Book Now","primaryCtaUrl":"/book-now","secondaryCtaLabel":"View Gallery","secondaryCtaUrl":"/gallery"}', 'DRAFT'),
  ('homepage.experiences', 'Experiences Intro', '{"eyebrow":"Experiences","heading":"A booth for the way your event feels.","supportingText":"Choose the photo experience that fits the room, the guest list, and the memory you want to make."}', 'DRAFT'),
  ('homepage.camera_roll', 'Camera Roll Section', '{"eyebrow":"Camera Roll","heading":"Guests keep coming back for one more.","supportingText":"Instant sharing, beautiful captures, and a gallery that feels like the party.","featureLabels":["Studio light","Instant sharing","Custom design","Event-ready galleries"]}', 'DRAFT'),
  ('homepage.events', 'Events Section', '{"eyebrow":"Events","heading":"Made for every kind of celebration.","supportingText":"From weddings and birthdays to corporate parties and brand activations."}', 'DRAFT'),
  ('homepage.packages', 'Packages Preview', '{"heading":"Packages with everything considered.","supportingText":"Start with the right collection, then customize the details."}', 'DRAFT'),
  ('homepage.testimonials', 'Testimonials', '{"heading":"Good people. Better photos."}', 'DRAFT'),
  ('homepage.final_cta', 'Final CTA', '{"heading":"Ready to make it official?","body":"Tell us about your event and we will help shape the photo experience.","ctaLabel":"Book Now","ctaUrl":"/book-now","scriptAccentText":"favorite memory"}', 'DRAFT'),
  ('homepage.banner', 'Homepage Scrolling Banner', '{"items":["GRADUATIONS","WEDDINGS","BIRTHDAYS","BRAND ACTIVATIONS","CORPORATE PARTIES","SHOWERS","PRIVATE EVENTS"]}', 'DRAFT'),
  ('seo.pages', 'Page SEO Settings', '{"home":{},"experiences":{},"packages":{},"gallery":{},"events":{},"about":{},"contact":{},"faq":{}}', 'DRAFT')
ON CONFLICT (content_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_media_type_visibility ON media_library(media_type, visibility, permission_state);
CREATE INDEX IF NOT EXISTS idx_website_event_types_publish ON website_event_types(status, show_on_website, display_order);
CREATE INDEX IF NOT EXISTS idx_website_content_versions_entity ON website_content_versions(entity_type, entity_id, created_at);
