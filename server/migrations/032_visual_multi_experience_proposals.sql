ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS proposal_type text NOT NULL DEFAULT 'PRIVATE_EVENT',
  ADD COLUMN IF NOT EXISTS selected_experiences jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS proposal_visuals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS proposal_snapshot jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='proposals_proposal_type_check') THEN
    ALTER TABLE proposals ADD CONSTRAINT proposals_proposal_type_check
      CHECK (proposal_type IN ('WEDDING','PRIVATE_EVENT','CORPORATE','BRAND_ACTIVATION','CUSTOM'));
  END IF;
END $$;
