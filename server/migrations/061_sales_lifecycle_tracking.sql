-- Additive lifecycle correction. Preserve billing records and accepted history.
ALTER TABLE clients ADD COLUMN sales_qualified boolean NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN sales_closed_at timestamptz;
ALTER TABLE bookings ADD COLUMN sales_closed_at timestamptz;
ALTER TABLE tasks ADD COLUMN proposal_id uuid REFERENCES proposals(id);
ALTER TABLE tasks ADD COLUMN closure_reason text;
ALTER TABLE tasks ADD COLUMN closed_at timestamptz;
CREATE INDEX tasks_proposal_open ON tasks(proposal_id) WHERE deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS');

-- Only known pre-sale records are reclassified; manual and returning clients remain.
UPDATE clients c SET sales_qualified=false WHERE c.referral_source IN ('Website request','Campaign') AND
 EXISTS(SELECT 1 FROM leads l WHERE l.converted_client_id=c.id AND l.deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM leads l WHERE l.converted_client_id=c.id AND l.status='WON')
 AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.client_id=c.id AND i.amount_paid>0)
 AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.client_id=c.id AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))
 AND NOT EXISTS(SELECT 1 FROM contracts k JOIN proposals p ON p.id=k.proposal_id WHERE p.client_id=c.id AND k.status='SIGNED');

CREATE OR REPLACE FUNCTION link_crm_contact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity text;contact uuid;person text;first text;last text;kind text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.email IS DISTINCT FROM OLD.email AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN NEW.contact_id:=NULL;END IF;
 identity:=lower(btrim(NEW.email));IF identity IS NULL OR identity='' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-contact:'||identity,600060));
 IF TG_TABLE_NAME='clients' THEN person:=NEW.name;first:=split_part(NEW.name,' ',1);last:=substr(NEW.name,length(first)+2);kind:=CASE WHEN NEW.sales_qualified THEN 'CLIENT' ELSE 'PROSPECT' END;
 ELSE first:=NEW.first_name;last:=NEW.last_name;person:=btrim(first||' '||last);kind:='PROSPECT';END IF;
 IF NEW.contact_id IS NOT NULL THEN
 IF kind='CLIENT' THEN UPDATE crm_contacts SET contact_type='CLIENT',updated_at=now() WHERE id=NEW.contact_id AND contact_type='PROSPECT';END IF;
 RETURN NEW;END IF;
 SELECT id INTO contact FROM crm_contacts WHERE deleted_at IS NULL AND (email_normalized=identity OR lower(btrim(secondary_email))=identity) LIMIT 1;
 IF contact IS NULL THEN
  INSERT INTO crm_contacts(first_name,last_name,display_name,email,phone,company,contact_type,source)
  VALUES(COALESCE(first,''),COALESCE(last,''),COALESCE(NULLIF(person,''),NEW.email),NEW.email,COALESCE(NEW.phone,''),COALESCE(NEW.company,''),kind,'EXISTING_CRM') RETURNING id INTO contact;
 ELSIF kind='CLIENT' THEN UPDATE crm_contacts SET contact_type='CLIENT',updated_at=now() WHERE id=contact AND contact_type='PROSPECT';END IF;
 IF TG_TABLE_NAME='leads' THEN UPDATE crm_contacts SET owner_id=COALESCE(owner_id,NEW.assigned_user_id) WHERE id=contact;END IF;
 NEW.contact_id:=contact;RETURN NEW;
END $$;
DROP TRIGGER clients_contact_identity ON clients;
CREATE TRIGGER clients_contact_identity BEFORE INSERT OR UPDATE OF email,sales_qualified ON clients FOR EACH ROW EXECUTE FUNCTION link_crm_contact();
UPDATE crm_contacts c SET contact_type='PROSPECT',updated_at=now() WHERE c.contact_type='CLIENT'
 AND EXISTS(SELECT 1 FROM clients cl WHERE cl.contact_id=c.id AND NOT cl.sales_qualified)
 AND NOT EXISTS(SELECT 1 FROM clients cl WHERE cl.contact_id=c.id AND cl.sales_qualified AND cl.deleted_at IS NULL);

CREATE FUNCTION sales_lead_protected(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM invoices i LEFT JOIN proposals p ON p.id=i.proposal_id
  WHERE (i.lead_id=target OR p.lead_id=target) AND i.amount_paid>0)
 OR EXISTS(SELECT 1 FROM contracts k JOIN proposals p ON p.id=k.proposal_id WHERE p.lead_id=target AND k.status='SIGNED')
 OR EXISTS(SELECT 1 FROM proposals p JOIN events e ON e.id=p.event_id WHERE p.lead_id=target AND e.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS','COMPLETED'))
 OR EXISTS(SELECT 1 FROM bookings b JOIN leads l ON l.id=target WHERE (b.lead_id=target OR b.event_id=l.converted_event_id) AND b.amount_paid>0)
 OR EXISTS(SELECT 1 FROM events e JOIN leads l ON l.converted_event_id=e.id WHERE l.id=target AND e.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS','COMPLETED'))
 OR EXISTS(SELECT 1 FROM payments pay LEFT JOIN invoices i ON i.id=pay.invoice_id LEFT JOIN proposals p ON p.id=i.proposal_id
  WHERE (p.lead_id=target OR i.lead_id=target) AND pay.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'));
$$;

CREATE FUNCTION close_lost_sales_lead(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE event_target uuid;
BEGIN
 IF sales_lead_protected(target) THEN RAISE EXCEPTION 'Paid, signed or confirmed bookings require the cancellation workflow before marking the lead Lost.' USING ERRCODE='P0001';END IF;
 -- Lock linked proposals to serialize against acceptance and payment handoffs.
 PERFORM id FROM proposals WHERE lead_id=target ORDER BY id FOR UPDATE;
 IF sales_lead_protected(target) THEN RAISE EXCEPTION 'Paid, signed or confirmed bookings require the cancellation workflow before marking the lead Lost.' USING ERRCODE='P0001';END IF;
 UPDATE tasks SET status='CANCELLED',closure_reason='Lead marked Lost',closed_at=now(),updated_at=now()
 WHERE deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS') AND
 (lead_id=target OR proposal_id IN(SELECT id FROM proposals WHERE lead_id=target));
 UPDATE proposals SET status='DECLINED',updated_at=now() WHERE lead_id=target AND deleted_at IS NULL
 AND status IN ('DRAFT','READY','SENT','VIEWED','ACCEPTED','EXPIRED');
 UPDATE invoices SET status='VOID',updated_at=now() WHERE amount_paid=0 AND status NOT IN ('PAID','REFUNDED','VOID')
 AND (lead_id=target OR proposal_id IN(SELECT id FROM proposals WHERE lead_id=target));
 UPDATE automation_jobs SET status='CANCELLED',last_error='Lead marked Lost',updated_at=now()
 WHERE status='PENDING' AND ((related_entity_type='lead' AND related_entity_id=target)
 OR (related_entity_type='proposal' AND related_entity_id IN(SELECT id FROM proposals WHERE lead_id=target)));
 UPDATE communications SET status='CANCELLED',failure_message='Lead marked Lost',updated_at=now()
 WHERE status IN ('DRAFT','SCHEDULED','PENDING_APPROVAL') AND
 (lead_id=target OR proposal_id IN(SELECT id FROM proposals WHERE lead_id=target));
 FOR event_target IN SELECT DISTINCT event_id FROM proposals WHERE lead_id=target AND event_id IS NOT NULL
 UNION SELECT converted_event_id FROM leads WHERE id=target AND converted_event_id IS NOT NULL LOOP
  IF NOT EXISTS(SELECT 1 FROM proposals WHERE event_id=event_target AND lead_id IS DISTINCT FROM target AND deleted_at IS NULL AND status NOT IN ('DECLINED','EXPIRED','ARCHIVED'))
  AND NOT EXISTS(SELECT 1 FROM invoices WHERE event_id=event_target AND amount_paid>0) THEN
   UPDATE events SET status='CANCELLED',sales_closed_at=COALESCE(sales_closed_at,now()),updated_at=now()
   WHERE id=event_target AND sales_closed_at IS NULL AND status IN ('DRAFT','INQUIRY','PENDING_CONTRACT','PENDING_DEPOSIT','CANCELLED');
   IF FOUND THEN
    UPDATE tasks SET status='CANCELLED',closure_reason='Lead marked Lost',closed_at=now(),updated_at=now() WHERE event_id=event_target AND deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS');
    UPDATE bookings SET sales_closed_at=COALESCE(sales_closed_at,now()),updated_at=now() WHERE event_id=event_target AND sales_closed_at IS NULL;
    UPDATE booking_holds SET status='RELEASED',updated_at=now() WHERE event_id=event_target AND status='ACTIVE';
    UPDATE equipment_assignments SET released_at=now() WHERE event_id=event_target AND released_at IS NULL;
    UPDATE staff_assignments SET released_at=now() WHERE event_id=event_target AND released_at IS NULL;
   END IF;
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION reconcile_lead_verdict() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='LOST' THEN PERFORM close_lost_sales_lead(NEW.id);END IF;
 IF NEW.status='WON' AND NEW.converted_client_id IS NOT NULL THEN UPDATE clients SET sales_qualified=true,updated_at=now() WHERE id=NEW.converted_client_id;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_verdict_consistency AFTER UPDATE OF status,converted_client_id ON leads FOR EACH ROW EXECUTE FUNCTION reconcile_lead_verdict();

CREATE FUNCTION prevent_lost_proposal_reopening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('DRAFT','READY','SENT','VIEWED','ACCEPTED','CONVERTED') AND EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND status='LOST') THEN
  RAISE EXCEPTION 'This lead is Lost. Reopen and review the opportunity before preparing or accepting another proposal.' USING ERRCODE='P0001';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER lost_proposal_stop BEFORE INSERT OR UPDATE OF status,lead_id ON proposals FOR EACH ROW EXECUTE FUNCTION prevent_lost_proposal_reopening();

CREATE FUNCTION reconcile_proposal_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('ACCEPTED','CONVERTED','DECLINED','EXPIRED','ARCHIVED') THEN
  UPDATE tasks SET status=CASE WHEN NEW.status IN ('ACCEPTED','CONVERTED') THEN 'DONE' ELSE 'CANCELLED' END,
  closure_reason='Proposal '||lower(NEW.status),closed_at=now(),updated_at=now()
  WHERE proposal_id=NEW.id AND deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS');
  UPDATE automation_jobs SET status='CANCELLED',last_error='Proposal '||lower(NEW.status),updated_at=now()
  WHERE related_entity_type='proposal' AND related_entity_id=NEW.id AND status='PENDING'
  AND job_type NOT IN ('BOOKING_SEND_ACCEPTED_INVOICE','BOOKING_SEND_PAID_AGREEMENT','BOOKING_SEND_SIGNED_WORKSPACE','CLIENT_WORKSPACE_SIGN_IN');
  UPDATE communications SET status='CANCELLED',failure_message='Proposal '||lower(NEW.status),updated_at=now()
  WHERE proposal_id=NEW.id AND status IN ('SCHEDULED','PENDING_APPROVAL') AND trigger_key IN ('PROPOSAL_REMINDER','PROPOSAL_EXPIRING','PROPOSAL_SENT');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_task_consistency AFTER UPDATE OF status ON proposals FOR EACH ROW EXECUTE FUNCTION reconcile_proposal_tasks();

CREATE FUNCTION prevent_obsolete_sales_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('OPEN','IN_PROGRESS') THEN
  IF EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND sales_closed_at IS NOT NULL) OR EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND status='LOST') OR EXISTS(SELECT 1 FROM proposals p JOIN leads l ON l.id=p.lead_id WHERE p.id=NEW.proposal_id AND l.status='LOST') THEN
   NEW.status:='CANCELLED';NEW.closure_reason:='Lead marked Lost';NEW.closed_at:=now();
  ELSIF EXISTS(SELECT 1 FROM proposals WHERE id=NEW.proposal_id AND (status IN ('DECLINED','EXPIRED','ARCHIVED') OR (status IN ('DRAFT','READY','SENT','VIEWED') AND valid_through<(now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date))) THEN
   NEW.status:='CANCELLED';NEW.closure_reason:='Proposal no longer awaiting acceptance';NEW.closed_at:=now();
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER sales_task_stop BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION prevent_obsolete_sales_task();

CREATE FUNCTION reconcile_sales_lifecycle() RETURNS void LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('reconcile-sales-lifecycle'));
 UPDATE proposals SET status='EXPIRED',updated_at=now() WHERE deleted_at IS NULL AND status IN ('READY','SENT','VIEWED')
 AND valid_through<(now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date;
 FOR target IN SELECT id FROM leads WHERE status='LOST' AND deleted_at IS NULL AND NOT sales_lead_protected(id) LOOP
  PERFORM close_lost_sales_lead(target);
 END LOOP;
END $$;
SELECT reconcile_sales_lifecycle();

CREATE TABLE campaign_tracking_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL REFERENCES campaigns(id),
 recipient_id uuid NOT NULL REFERENCES campaign_recipients(id),link_hash text NOT NULL REFERENCES campaign_tracking_links(token_hash),
 kind text NOT NULL CHECK(kind IN ('OPEN','CLICK')),classification text NOT NULL CHECK(classification IN ('AUTOMATION','ESTIMATED_OPEN','LIKELY_HUMAN','UNVERIFIED')),
 method text NOT NULL,user_agent text NOT NULL,purpose text NOT NULL,fetch_mode text NOT NULL,fetch_user text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_observations_reporting ON campaign_tracking_observations(campaign_id,recipient_id,classification);

CREATE OR REPLACE VIEW reporting_clients AS SELECT * FROM clients WHERE deleted_at IS NULL AND sales_qualified AND data_classification IN ('BUSINESS','UNREVIEWED');
CREATE OR REPLACE VIEW reporting_events AS SELECT * FROM events WHERE deleted_at IS NULL AND sales_closed_at IS NULL AND data_classification IN ('BUSINESS','UNREVIEWED');
CREATE OR REPLACE VIEW reporting_bookings AS SELECT * FROM bookings WHERE deleted_at IS NULL AND sales_closed_at IS NULL AND data_classification IN ('BUSINESS','UNREVIEWED');
