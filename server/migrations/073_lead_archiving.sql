ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leads_active ON leads(created_at DESC) WHERE deleted_at IS NULL AND archived_at IS NULL;
