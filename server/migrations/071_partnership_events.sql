-- Separate partnerships from customer bookings. No historical enrollment or messages.
CREATE SEQUENCE partner_reference_seq;
CREATE TABLE partners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 partner_number text NOT NULL UNIQUE DEFAULT ('PTR-'||lpad(nextval('partner_reference_seq')::text,5,'0')),
 name text NOT NULL CHECK(length(btrim(name))>0), contact_name text, email text, phone text, website text, notes text,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 source_lead_id uuid UNIQUE REFERENCES leads(id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leads ADD COLUMN opportunity_type text NOT NULL DEFAULT 'BOOKING' CHECK(opportunity_type IN ('BOOKING','PARTNERSHIP'));
ALTER TABLE leads ADD COLUMN converted_partner_id uuid REFERENCES partners(id);
ALTER TABLE events ADD COLUMN event_kind text NOT NULL DEFAULT 'BOOKING' CHECK(event_kind IN ('BOOKING','PARTNERSHIP'));
ALTER TABLE events ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE events ADD CONSTRAINT partnership_no_client CHECK(event_kind<>'PARTNERSHIP' OR client_id IS NULL);
CREATE TABLE event_partners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id), partner_id uuid NOT NULL REFERENCES partners(id),
 role text NOT NULL CHECK(role IN ('ORGANIZER','SPONSOR','VENUE','COLLABORATOR')), notes text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(event_id,partner_id,role)
);
CREATE INDEX event_partners_partner ON event_partners(partner_id);
-- Reuse gallery token expiry, revocation and media isolation; access is never implied by a role.
CREATE TABLE partner_gallery_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_partner_id uuid NOT NULL REFERENCES event_partners(id),
 access_key_id uuid NOT NULL UNIQUE REFERENCES gallery_access_keys(id),
 scope text NOT NULL CHECK(scope IN ('FULL','SELECTED')), created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION partnership_lead_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE partner uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.opportunity_type IS DISTINCT FROM OLD.opportunity_type AND
   (OLD.converted_client_id IS NOT NULL OR OLD.converted_partner_id IS NOT NULL OR EXISTS(SELECT 1 FROM proposals WHERE lead_id=NEW.id) OR EXISTS(SELECT 1 FROM bookings WHERE lead_id=NEW.id)) THEN
  RAISE EXCEPTION 'An opportunity with linked commercial records cannot change type';
 END IF;
 IF NEW.opportunity_type='PARTNERSHIP' THEN
  IF NEW.converted_client_id IS NOT NULL THEN RAISE EXCEPTION 'Partnership opportunities convert to partners, not clients';END IF;
  IF NEW.status='WON' AND NEW.converted_partner_id IS NULL THEN
   INSERT INTO partners(name,contact_name,email,phone,source_lead_id)
    VALUES(COALESCE(NULLIF(btrim(NEW.company),''),btrim(NEW.first_name||' '||NEW.last_name)),btrim(NEW.first_name||' '||NEW.last_name),NEW.email,NEW.phone,NEW.id)
    ON CONFLICT(source_lead_id) DO UPDATE SET source_lead_id=EXCLUDED.source_lead_id RETURNING id INTO partner;
   NEW.converted_partner_id:=partner;
  END IF;
 ELSIF NEW.converted_partner_id IS NOT NULL THEN RAISE EXCEPTION 'Booking opportunities cannot link a converted partner';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER partnership_lead_identity BEFORE INSERT OR UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION partnership_lead_identity();
CREATE FUNCTION partnership_won_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.opportunity_type='PARTNERSHIP' AND NEW.status='WON' THEN
  UPDATE tasks SET status='DONE',closed_at=now(),closure_reason='Partnership opportunity won',updated_at=now() WHERE lead_id=NEW.id AND status IN ('OPEN','IN_PROGRESS') AND deleted_at IS NULL;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER partnership_won_tasks AFTER UPDATE OF status ON leads FOR EACH ROW EXECUTE FUNCTION partnership_won_tasks();
-- Customer proposal/payment conversion is intentionally unavailable until dedicated partner commercial documents ship.
CREATE FUNCTION guard_partner_booking_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND opportunity_type='PARTNERSHIP') OR EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND event_kind='PARTNERSHIP') THEN
  RAISE EXCEPTION 'Use the partnership workflow; customer booking proposals are not supported for partnerships';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER partner_booking_proposal_guard BEFORE INSERT OR UPDATE OF lead_id,event_id ON proposals FOR EACH ROW EXECUTE FUNCTION guard_partner_booking_proposal();
CREATE OR REPLACE FUNCTION enroll_event_closeout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.event_kind='PARTNERSHIP' THEN RETURN NEW;END IF;
 IF (NEW.status='COMPLETED' OR NEW.operational_status='COMPLETED') AND NOT (OLD.status='COMPLETED' OR COALESCE(OLD.operational_status='COMPLETED',false)) AND NEW.status<>'CANCELLED' AND NEW.deleted_at IS NULL AND NEW.sales_closed_at IS NULL THEN
 INSERT INTO event_closeouts(event_id,completed_at,due_at) VALUES(NEW.id,now(),now()+interval '24 hours') ON CONFLICT DO NOTHING;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION guard_partner_customer_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND event_kind='PARTNERSHIP') OR EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND opportunity_type='PARTNERSHIP') THEN
  RAISE EXCEPTION 'Customer invoices cannot be attached to partnership events; dedicated partner billing is not available yet';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER partner_customer_invoice_guard BEFORE INSERT OR UPDATE OF event_id,lead_id ON invoices FOR EACH ROW EXECUTE FUNCTION guard_partner_customer_invoice();
