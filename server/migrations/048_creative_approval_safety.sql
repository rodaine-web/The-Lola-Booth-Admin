-- Existing grants get a bounded grace period; revoked/cancelled grants stay blocked.
UPDATE creative_approvals SET expires_at=now()+interval '30 days' WHERE expires_at IS NULL;
CREATE OR REPLACE FUNCTION protect_approved_creative_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='APPROVED' AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Approved creative revisions are immutable; create a new version';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_approved_creative_revision BEFORE UPDATE OR DELETE ON creative_approval_revisions
FOR EACH ROW EXECUTE FUNCTION protect_approved_creative_revision();
