-- Additive Phase 1 migration. Feature/worker activation is a separate controlled step.
CREATE TABLE client_workspace_grants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 proposal_id UUID NOT NULL UNIQUE REFERENCES proposals(id),
 client_id UUID NOT NULL REFERENCES clients(id),
 signed_contract_id UUID NOT NULL REFERENCES contracts(id),
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE client_workspace_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 grant_id UUID NOT NULL REFERENCES client_workspace_grants(id),
 token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
 token_ciphertext JSONB NOT NULL,
 recipient_email TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '15 minutes',
 used_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 communication_id UUID REFERENCES communications(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_workspace_invitations_grant ON client_workspace_invitations(grant_id,created_at DESC);
CREATE TABLE client_workspace_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 invitation_id UUID NOT NULL REFERENCES client_workspace_invitations(id),
 client_id UUID NOT NULL REFERENCES clients(id),
 email TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_workspace_sessions_client ON client_workspace_sessions(client_id) WHERE revoked_at IS NULL;
ALTER TABLE contracts ADD COLUMN signing_due_at TIMESTAMPTZ;
ALTER TABLE contracts ADD COLUMN signing_grace_until TIMESTAMPTZ;
ALTER TABLE contracts ADD COLUMN signature_method TEXT CHECK(signature_method IN ('TYPED','DRAWN'));
ALTER TABLE contracts ADD COLUMN signature_strokes JSONB;
ALTER TABLE contracts ADD COLUMN signature_hash TEXT;
ALTER TABLE business_settings ADD COLUMN booking_lifecycle_enforced BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN lifecycle_key TEXT;
CREATE UNIQUE INDEX tasks_lifecycle_key ON tasks(lifecycle_key) WHERE lifecycle_key IS NOT NULL;
CREATE TABLE booking_payment_exceptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id UUID NOT NULL REFERENCES events(id),
 minimum_before_agreement NUMERIC(12,2) NOT NULL CHECK(minimum_before_agreement>=0),
 minimum_before_confirmation NUMERIC(12,2) NOT NULL CHECK(minimum_before_confirmation>=minimum_before_agreement),
 balance_due_date DATE NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason)>=20),
 approved_by UUID NOT NULL REFERENCES users(id),
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX booking_payment_exceptions_current ON booking_payment_exceptions(event_id) WHERE revoked_at IS NULL;

-- Enforce new managed bookings even when dispatch flags are subsequently paused.
-- The organization-wide switch is separately qualified before activation; no
-- historical event is rewritten by this migration.
CREATE FUNCTION booking_journey_managed(target UUID) RETURNS BOOLEAN AS $$
 SELECT COALESCE((SELECT booking_lifecycle_enforced FROM business_settings LIMIT 1),false)
  OR EXISTS(SELECT 1 FROM invoices WHERE event_id=target AND campaign_interest_id IS NOT NULL AND deleted_at IS NULL)
  OR EXISTS(SELECT 1 FROM proposals p WHERE p.event_id=target AND
    (EXISTS(SELECT 1 FROM automation_jobs j WHERE j.related_entity_id=p.id AND j.job_type='BOOKING_SEND_ACCEPTED_INVOICE')
     OR EXISTS(SELECT 1 FROM client_workspace_grants g WHERE g.proposal_id=p.id)));
$$ LANGUAGE sql STABLE;
CREATE FUNCTION booking_confirmation_missing(target UUID) RETURNS TEXT[] AS $$
DECLARE commercial RECORD; missing TEXT[]:=ARRAY[]::TEXT[]; required NUMERIC; paid NUMERIC;
 days_until INTEGER; exception_row booking_payment_exceptions%ROWTYPE;
BEGIN
 SELECT event_date-(now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date
  INTO days_until FROM events WHERE id=target AND deleted_at IS NULL;
 SELECT * INTO exception_row FROM booking_payment_exceptions WHERE event_id=target AND revoked_at IS NULL;
 IF NOT EXISTS(SELECT 1 FROM proposals WHERE event_id=target AND deleted_at IS NULL AND status IN ('ACCEPTED','CONVERTED') AND accepted_version_id IS NOT NULL) THEN
  RETURN ARRAY['Accept and link the commercial proposal before confirming this booking.'];
 END IF;
 FOR commercial IN SELECT p.id,p.accepted_version_id FROM proposals p
   WHERE p.event_id=target AND p.deleted_at IS NULL AND p.status IN ('ACCEPTED','CONVERTED')
 LOOP
  IF NOT EXISTS(SELECT 1 FROM contracts k WHERE k.proposal_id=commercial.id AND k.status='SIGNED'
    AND k.snapshot->>'accepted_version_id'=commercial.accepted_version_id::text
    AND NOT EXISTS(SELECT 1 FROM contracts newer WHERE newer.proposal_id=k.proposal_id AND newer.revision>k.revision AND newer.status IN ('DRAFT','ISSUED','SIGNED')))
   THEN missing:=array_append(missing,'Sign the current agreement before confirming this booking.'); END IF;
  SELECT i.total,COALESCE((SELECT sum(pay.amount-pay.refunded_amount) FROM payments pay WHERE pay.invoice_id=i.id
    AND pay.deleted_at IS NULL AND pay.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')),0)
   INTO required,paid FROM invoices i WHERE i.proposal_id=commercial.id AND i.event_id=target
    AND i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','VOID','REFUNDED')
    AND i.pricing_snapshot->>'accepted_version_id'=commercial.accepted_version_id::text ORDER BY i.created_at DESC LIMIT 1;
  IF required IS NULL OR required<=0 THEN missing:=array_append(missing,'Issue the linked booking invoice before confirmation.');
  ELSE
   required:=CASE WHEN exception_row.id IS NOT NULL THEN exception_row.minimum_before_confirmation
    WHEN days_until<14 THEN required ELSE ceil(required*100*0.3)/100 END;
   IF round(paid*100)<round(required*100) THEN missing:=array_append(missing,'Verify the required booking payment before confirmation.'); END IF;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM equipment_assignments WHERE event_id=target AND released_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM booking_hold_resources r JOIN booking_holds h ON h.id=r.hold_id
     WHERE h.event_id=target AND h.status='ACTIVE' AND h.expires_at>clock_timestamp() AND r.equipment_id IS NOT NULL)
  THEN missing:=array_append(missing,'Reserve available equipment before confirmation.'); END IF;
 RETURN missing;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION guard_booking_confirmation() RETURNS TRIGGER AS $$
DECLARE missing TEXT[];
BEGIN
 IF NEW.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS') AND
   (TG_OP='INSERT' OR OLD.status NOT IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS')) AND booking_journey_managed(NEW.id) THEN
  missing:=booking_confirmation_missing(NEW.id);
  IF cardinality(missing)>0 THEN RAISE EXCEPTION '%',array_to_string(missing,' ') USING ERRCODE='23514'; END IF;
  PERFORM assert_event_reservations(NEW.id);
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- AFTER permits the guard to inspect the inserted event; failure rolls back its write.
CREATE TRIGGER booking_confirmation_prerequisites AFTER INSERT OR UPDATE OF status ON events
 FOR EACH ROW EXECUTE FUNCTION guard_booking_confirmation();

ALTER TABLE event_planning ADD COLUMN review_notes TEXT;
ALTER TABLE event_planning ADD COLUMN reviewed_at TIMESTAMPTZ;
ALTER TABLE event_planning ADD COLUMN reviewed_by UUID REFERENCES users(id);

ALTER TABLE event_planning ADD COLUMN details_review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(details_review_status IN ('NEEDS_REVIEW','APPROVED','CHANGES_REQUESTED'));
