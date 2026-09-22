-- Website-only additions. Existing records remain visible under their current flags.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_key TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS experience_id UUID REFERENCES experiences(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'STARTING' CHECK (pricing_mode IN ('STARTING','CUSTOM'));
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_features JSONB NOT NULL DEFAULT '[]';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_custom_heading TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_home_description TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (website_status IN ('DRAFT','PUBLISHED','ARCHIVED'));
ALTER TABLE packages ALTER COLUMN starting_price DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_website_key ON packages(website_key) WHERE website_key IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE media_library ADD COLUMN IF NOT EXISTS source_url TEXT;
CREATE INDEX IF NOT EXISTS idx_media_sha256 ON media_library(sha256) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS website_import_state (
  import_key TEXT PRIMARY KEY,
  entity_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Tier names repeat across experiences; retain uniqueness within each experience.
DROP INDEX IF EXISTS idx_packages_name_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_experience_name_active ON packages (COALESCE(experience_id, '00000000-0000-0000-0000-000000000000'::uuid), name) WHERE deleted_at IS NULL;
DROP INDEX IF EXISTS idx_packages_one_most_popular;
CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_experience_most_popular ON packages (COALESCE(experience_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE most_popular=true AND deleted_at IS NULL;
