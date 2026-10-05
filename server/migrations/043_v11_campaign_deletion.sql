ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
