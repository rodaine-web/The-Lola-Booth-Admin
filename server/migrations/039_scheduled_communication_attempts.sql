ALTER TABLE communications ADD COLUMN IF NOT EXISTS scheduled_attempt_count INTEGER NOT NULL DEFAULT 0;
