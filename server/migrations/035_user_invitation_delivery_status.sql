ALTER TABLE users
  ADD COLUMN IF NOT EXISTS invitation_delivery_status TEXT NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN IF NOT EXISTS invitation_delivery_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_delivery_error_code TEXT,
  ADD COLUMN IF NOT EXISTS invitation_delivery_provider TEXT,
  ADD COLUMN IF NOT EXISTS invitation_delivery_message_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_invitation_delivery_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_invitation_delivery_status_check
      CHECK (invitation_delivery_status IN ('NOT_SENT','SENT_TO_PROVIDER','FAILED'));
  END IF;
END $$;
