-- Additive ledger; never rewrites the original payment or creates a refund.
ALTER TABLE payments ADD COLUMN disputed_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (disputed_amount>=0 AND disputed_amount<=amount);
-- SELECT * views retain their original columns until explicitly refreshed.
CREATE OR REPLACE VIEW reporting_payments AS SELECT * FROM payments
 WHERE deleted_at IS NULL AND data_classification IN ('BUSINESS','UNREVIEWED');
CREATE TABLE payment_disputes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payment_id UUID NOT NULL REFERENCES payments(id),
 provider_dispute_id TEXT NOT NULL UNIQUE, provider_charge_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented')),
 amount NUMERIC(12,2) NOT NULL CHECK(amount>0), currency TEXT NOT NULL,
 funds_withheld NUMERIC(12,2) NOT NULL CHECK(funds_withheld>=0),
 response_due_at TIMESTAMPTZ, provider_snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_disputes_payment_idx ON payment_disputes(payment_id);
CREATE FUNCTION payment_net_received(p payments) RETURNS NUMERIC AS $$
 SELECT greatest(0,p.amount-p.refunded_amount-p.disputed_amount);
$$ LANGUAGE SQL IMMUTABLE;
CREATE FUNCTION invoice_payment_review(target UUID) RETURNS BOOLEAN AS $$
 SELECT EXISTS(SELECT 1 FROM payments p JOIN payment_disputes d ON d.payment_id=p.id
 WHERE p.invoice_id=target AND p.deleted_at IS NULL AND
 (d.status IN ('warning_needs_response','warning_under_review','needs_response','under_review','lost') OR d.funds_withheld>0));
$$ LANGUAGE SQL STABLE;
CREATE FUNCTION event_payment_review(target UUID) RETURNS BOOLEAN AS $$
 SELECT EXISTS(SELECT 1 FROM invoices i WHERE i.event_id=target AND i.deleted_at IS NULL AND invoice_payment_review(i.id));
$$ LANGUAGE SQL STABLE;

-- Retain commercial prerequisites and existing reservation conflict guards.
CREATE OR REPLACE FUNCTION booking_confirmation_missing(target UUID) RETURNS TEXT[] AS $$
DECLARE commercial RECORD; missing TEXT[]:=ARRAY[]::TEXT[]; required NUMERIC; paid NUMERIC;
 days_until INTEGER; exception_row booking_payment_exceptions%ROWTYPE;
BEGIN
 IF event_payment_review(target) THEN RETURN ARRAY['A payment dispute requires Admin review before confirming or continuing planning.']; END IF;
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
  SELECT i.total,COALESCE((SELECT sum(payment_net_received(pay)) FROM payments pay WHERE pay.invoice_id=i.id
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
 RETURN missing;
END; $$ LANGUAGE plpgsql;

