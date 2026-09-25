-- Staging website projections must not duplicate or mutate operational catalogs.
CREATE TABLE website_channel_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'STAGING' CHECK (channel IN ('STAGING','PUBLIC')),
  cms_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload)='object'),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  display_order INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel,cms_type,entity_key)
);
CREATE INDEX website_channel_publication ON website_channel_records(channel,status,cms_type,display_order);

CREATE FUNCTION protect_public_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.channel='PUBLIC' OR (TG_OP='UPDATE' AND NEW.channel IS DISTINCT FROM OLD.channel) THEN
    RAISE EXCEPTION 'Public channel is read-only; cross-channel moves are prohibited';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_public_channel BEFORE UPDATE OR DELETE ON website_channel_records
FOR EACH ROW EXECUTE FUNCTION protect_public_channel();
