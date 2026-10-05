CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id),
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ISSUED','SIGNED','REVOKED')),
  title TEXT NOT NULL,
  terms TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  document_hash TEXT,
  token_hash TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signer_name TEXT,
  signer_email TEXT,
  consent_text TEXT,
  signer_ip TEXT,
  signer_user_agent TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(proposal_id, revision),
  CHECK(status <> 'SIGNED' OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND document_hash IS NOT NULL))
);
CREATE UNIQUE INDEX contracts_one_active ON contracts(proposal_id) WHERE status IN ('DRAFT','ISSUED');
CREATE FUNCTION protect_signed_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SIGNED' THEN
    RAISE EXCEPTION 'Signed contracts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER contracts_signed_immutable BEFORE UPDATE OR DELETE ON contracts
FOR EACH ROW EXECUTE FUNCTION protect_signed_contract();
