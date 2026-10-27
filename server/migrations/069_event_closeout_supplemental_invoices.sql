-- Additive; no historical enrollment, customer updates, or message backfill.
ALTER TABLE invoices ADD COLUMN parent_invoice_id uuid REFERENCES invoices(id);
ALTER TABLE invoices ADD CONSTRAINT invoice_parent_not_self CHECK(parent_invoice_id IS NULL OR parent_invoice_id<>id);
CREATE INDEX invoices_parent_reference ON invoices(parent_invoice_id) WHERE parent_invoice_id IS NOT NULL;
CREATE FUNCTION validate_supplemental_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent invoices%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.parent_invoice_id IS DISTINCT FROM OLD.parent_invoice_id THEN RAISE EXCEPTION 'Supplemental invoice reference is immutable';END IF;
 IF NEW.parent_invoice_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO parent FROM invoices WHERE id=NEW.parent_invoice_id AND deleted_at IS NULL;
 IF NOT FOUND OR parent.parent_invoice_id IS NOT NULL OR parent.status IN ('VOID','REFUNDED') OR NEW.proposal_id IS NOT NULL OR NEW.client_id IS DISTINCT FROM parent.client_id OR NEW.event_id IS DISTINCT FROM parent.event_id THEN RAISE EXCEPTION 'Supplemental invoice must reference the same client and event';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplemental_invoice_identity BEFORE INSERT OR UPDATE OF parent_invoice_id,client_id,event_id,proposal_id ON invoices FOR EACH ROW EXECUTE FUNCTION validate_supplemental_invoice();
CREATE TABLE event_closeouts (
 event_id uuid PRIMARY KEY REFERENCES events(id),
 completed_at timestamptz NOT NULL,
 due_at timestamptz NOT NULL,
 communication_id uuid REFERENCES communications(id),
 task_id uuid REFERENCES tasks(id),
 discount_code text,
 discount_percent numeric(5,2) CHECK(discount_percent>0 AND discount_percent<=100),
 discount_expires date,
 approved_by uuid REFERENCES users(id),
 approved_at timestamptz,
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(due_at>=completed_at)
);
CREATE FUNCTION enroll_event_closeout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status='COMPLETED' OR NEW.operational_status='COMPLETED') AND NOT (OLD.status='COMPLETED' OR COALESCE(OLD.operational_status='COMPLETED',false)) AND NEW.status<>'CANCELLED' AND NEW.deleted_at IS NULL AND NEW.sales_closed_at IS NULL THEN
 INSERT INTO event_closeouts(event_id,completed_at,due_at) VALUES(NEW.id,now(),now()+interval '24 hours') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enroll_future_event_closeout AFTER UPDATE OF status,operational_status ON events FOR EACH ROW EXECUTE FUNCTION enroll_event_closeout();
