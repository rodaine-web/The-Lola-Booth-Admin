-- Additive only. No existing prices or commercial records are rewritten.
ALTER TABLE packages ADD COLUMN catalog_key text;
ALTER TABLE packages ADD COLUMN tier_key text;
ALTER TABLE packages ADD COLUMN pricing_profile jsonb;
ALTER TABLE addons ADD COLUMN pricing_policy jsonb;
ALTER TABLE packages ADD CONSTRAINT package_catalog_key_check CHECK (catalog_key IS NULL OR catalog_key IN ('STANDARD','PROFESSIONAL','ACTIVATION','CUSTOM'));
CREATE TABLE pricing_catalog_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version_number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RETIRED')),
 rules jsonb NOT NULL,
 snapshot jsonb,
 effective_at timestamptz,
 created_by uuid REFERENCES users(id),
 published_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 CHECK(status='DRAFT' OR (snapshot IS NOT NULL AND published_at IS NOT NULL AND effective_at IS NOT NULL))
);
CREATE FUNCTION protect_pricing_catalog_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'Published pricing versions cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.status<>'DRAFT' AND (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW.effective_at IS DISTINCT FROM OLD.effective_at OR NEW.status='DRAFT') THEN
  RAISE EXCEPTION 'Published pricing rules and snapshots are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pricing_version_immutable BEFORE UPDATE OR DELETE ON pricing_catalog_versions FOR EACH ROW EXECUTE FUNCTION protect_pricing_catalog_version();
CREATE TABLE pricing_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 catalog_version_id uuid NOT NULL REFERENCES pricing_catalog_versions(id),
 snapshot jsonb NOT NULL,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
CREATE FUNCTION protect_pricing_quote() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Pricing quote snapshots are immutable'; END $$;
CREATE TRIGGER pricing_quote_immutable BEFORE UPDATE OR DELETE ON pricing_quotes FOR EACH ROW EXECUTE FUNCTION protect_pricing_quote();
ALTER TABLE proposals ADD COLUMN pricing_quote_id uuid REFERENCES pricing_quotes(id);
CREATE FUNCTION link_proposal_pricing_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.pricing_quote_id := NULLIF(NEW.pricing_snapshot->>'pricing_quote_id','')::uuid;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_pricing_quote_link BEFORE INSERT OR UPDATE OF pricing_snapshot ON proposals FOR EACH ROW EXECUTE FUNCTION link_proposal_pricing_quote();
