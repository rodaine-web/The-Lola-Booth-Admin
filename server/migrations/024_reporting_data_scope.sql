-- Classification is explicit. Existing records are UNREVIEWED, never heuristically deleted.
DO $$
DECLARE entity text;
BEGIN
 FOREACH entity IN ARRAY ARRAY['leads','clients','events','bookings','proposals','invoices','payments','tasks'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS data_classification TEXT NOT NULL DEFAULT ''UNREVIEWED'' CHECK (data_classification IN (''UNREVIEWED'',''BUSINESS'',''QA'',''SEED'',''LEGACY_FIXTURE''))',entity);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN data_classification SET DEFAULT ''BUSINESS''',entity);
  EXECUTE format('CREATE OR REPLACE VIEW reporting_%I AS SELECT * FROM %I WHERE deleted_at IS NULL AND data_classification IN (''BUSINESS'',''UNREVIEWED'')',entity,entity);
 END LOOP;
END $$;
