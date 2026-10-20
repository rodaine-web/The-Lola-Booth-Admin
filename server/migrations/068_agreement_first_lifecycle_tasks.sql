-- Additive records and event-driven rules. Never rewrite signed documents or posted money.
ALTER TABLE tasks ADD COLUMN assigned_at timestamptz;
UPDATE tasks SET assigned_at=created_at;
ALTER TABLE tasks ALTER COLUMN assigned_at SET DEFAULT now();
ALTER TABLE tasks ALTER COLUMN assigned_at SET NOT NULL;
ALTER TABLE tasks ADD COLUMN assignment_version integer NOT NULL DEFAULT 1;
CREATE TABLE task_notification_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES tasks(id),
 assigned_user_id uuid NOT NULL REFERENCES users(id),assignment_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ASSIGNED','REMINDER')),period text NOT NULL,
 communication_id uuid REFERENCES communications(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,assignment_version,kind,period)
);

CREATE FUNCTION workflow_task_owner(lead_target uuid,client_target uuid,event_target uuid,proposal_target uuid) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE person uuid;lead_target_id uuid;
BEGIN
 IF lead_target IS NULL AND proposal_target IS NULL THEN
  SELECT cc.owner_id INTO person FROM clients c JOIN crm_contacts cc ON cc.id=c.contact_id
   WHERE c.id=COALESCE(client_target,(SELECT client_id FROM events WHERE id=event_target)) AND c.deleted_at IS NULL AND cc.deleted_at IS NULL;
  IF person IS NOT NULL THEN RETURN person;END IF;
 END IF;
 SELECT l.id,l.assigned_user_id INTO lead_target_id,person FROM leads l WHERE l.deleted_at IS NULL AND
  (l.id=lead_target OR l.id=(SELECT lead_id FROM proposals WHERE id=proposal_target)
   OR l.converted_event_id=event_target OR (event_target IS NULL AND l.converted_client_id=client_target))
 ORDER BY (l.id=lead_target) DESC NULLS LAST,(l.converted_event_id=event_target) DESC NULLS LAST,l.created_at DESC,l.id LIMIT 1;
 IF person IS NOT NULL THEN RETURN person; END IF;
 SELECT COALESCE(actor_user_id,user_id) INTO person FROM audit_logs WHERE entity_id=lead_target_id AND
  COALESCE(actor_user_id,user_id) IS NOT NULL AND action='lead_created'
 ORDER BY created_at,id LIMIT 1;
 IF person IS NULL THEN SELECT actor_user_id INTO person FROM activities WHERE entity_id=lead_target_id AND action='lead_created' AND actor_user_id IS NOT NULL ORDER BY created_at,id LIMIT 1;END IF;
 IF person IS NULL THEN SELECT COALESCE(actor_user_id,user_id) INTO person FROM audit_logs WHERE entity_id=proposal_target AND COALESCE(actor_user_id,user_id) IS NOT NULL ORDER BY created_at,id LIMIT 1;END IF;
 RETURN person;
END $$;

CREATE FUNCTION workflow_task_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.assigned_user_id IS NULL THEN NEW.assigned_user_id:=workflow_task_owner(NEW.lead_id,NEW.client_id,NEW.event_id,NEW.proposal_id);END IF;
 IF TG_OP='UPDATE' AND NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
  NEW.assignment_version:=OLD.assignment_version+1;NEW.assigned_at:=now();
 END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('OPEN','IN_PROGRESS') AND OLD.status IN ('DONE','CANCELLED') THEN NEW.closure_reason:=NULL;NEW.closed_at:=NULL;END IF;
 IF NEW.status IN ('DONE','CANCELLED') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  IF NULLIF(btrim(NEW.closure_reason),'') IS NULL THEN
   NEW.closure_reason:=CASE
    WHEN EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND status='LOST') THEN 'Automatically cancelled because the lead was marked Lost.'
    WHEN NEW.proposal_id IS NOT NULL THEN 'Automatically closed because proposal state changed to '||COALESCE((SELECT lower(status) FROM proposals WHERE id=NEW.proposal_id),'unavailable')||'.'
    WHEN NEW.lifecycle_key LIKE 'agreement-%' THEN 'Automatically resolved because the agreement was signed.'
    WHEN NEW.lifecycle_key LIKE 'booking-balance:%' THEN 'Automatically resolved because the invoice was paid.'
    WHEN NEW.lifecycle_key LIKE 'booking-equipment:%' THEN 'Automatically resolved because equipment was assigned.'
    WHEN NEW.lifecycle_key LIKE 'booking-confirmation:%' THEN 'Automatically resolved because the booking was confirmed.'
    WHEN EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND status='CANCELLED') THEN 'Automatically cancelled because the event was cancelled.'
    ELSE 'Automatically closed by a system workflow event.' END;
  END IF;
  NEW.closed_at:=COALESCE(NEW.closed_at,now());
 END IF;
 RETURN NEW;
END $$;
-- Runs after the existing sales_task_stop trigger, so its automatic cancellation is captured too.
CREATE TRIGGER zz_workflow_task_state BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION workflow_task_state();

CREATE FUNCTION workflow_task_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
  INSERT INTO audit_logs(action,entity,entity_type,entity_id,before_json,after_json)
  VALUES('task_workflow_changed','task','task',NEW.id,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 END IF;
 IF NEW.status IN ('DONE','CANCELLED') OR NEW.deleted_at IS NOT NULL OR (TG_OP='UPDATE' AND NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id) THEN
  UPDATE communications SET status='CANCELLED',failure_message='Task closed, deleted or reassigned',updated_at=now()
  WHERE id IN (SELECT communication_id FROM task_notification_ledger WHERE task_id=NEW.id)
   AND status IN ('DRAFT','SCHEDULED','PENDING_APPROVAL','FAILED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_task_audit AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION workflow_task_audit();
CREATE FUNCTION workflow_reassign_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
  UPDATE tasks SET assigned_user_id=COALESCE(NEW.assigned_user_id,workflow_task_owner(NEW.id,NULL,NULL,NULL)),updated_at=now()
  WHERE deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS') AND lifecycle_key IS NOT NULL AND
  (lead_id=NEW.id OR proposal_id IN(SELECT id FROM proposals WHERE lead_id=NEW.id) OR event_id=NEW.converted_event_id);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER workflow_reassign_tasks AFTER UPDATE OF assigned_user_id ON leads FOR EACH ROW EXECUTE FUNCTION workflow_reassign_tasks();

CREATE FUNCTION workflow_accept_client() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lead_row leads%ROWTYPE;customer uuid;identity text;
BEGIN
 IF NEW.status NOT IN ('ACCEPTED','CONVERTED') OR NEW.accepted_version_id IS NULL THEN RETURN NEW;END IF;
 IF NEW.lead_id IS NULL THEN
  UPDATE clients SET sales_qualified=true,updated_at=now() WHERE id=NEW.client_id;
  RETURN NEW;
 END IF;
 SELECT * INTO lead_row FROM leads WHERE id=NEW.lead_id AND deleted_at IS NULL FOR UPDATE;
 IF lead_row.id IS NULL THEN RAISE EXCEPTION 'Accepted proposal lead is unavailable';END IF;
 identity:=lower(btrim(lead_row.email));
 PERFORM pg_advisory_xact_lock(hashtext(COALESCE(identity,lead_row.id::text)));
 customer:=COALESCE(lead_row.converted_client_id,NEW.client_id);
 IF customer IS NULL AND identity IS NOT NULL THEN SELECT id INTO customer FROM clients WHERE lower(btrim(email))=identity AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1;END IF;
 IF customer IS NULL THEN
  INSERT INTO clients(name,email,phone,company,referral_source,sales_qualified)
  VALUES(btrim(lead_row.first_name||' '||lead_row.last_name),lead_row.email,lead_row.phone,lead_row.company,lead_row.lead_source,true) RETURNING id INTO customer;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM clients WHERE id=customer AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Accepted proposal customer is unavailable';END IF;
 IF NEW.client_id IS NOT NULL AND NEW.client_id<>customer THEN RAISE EXCEPTION 'Accepted proposal customer linkage conflicts; review required';END IF;
 UPDATE clients SET sales_qualified=true,updated_at=now() WHERE id=customer;
 UPDATE leads SET status='WON',converted_client_id=customer,converted_event_id=COALESCE(NEW.event_id,converted_event_id),updated_at=now() WHERE id=lead_row.id;
 UPDATE proposals SET client_id=customer WHERE id=NEW.id AND client_id IS DISTINCT FROM customer;
 UPDATE events SET client_id=customer WHERE id=NEW.event_id AND client_id IS NULL;
 UPDATE tasks SET client_id=customer WHERE lead_id=lead_row.id AND client_id IS NULL;
 UPDATE invoices SET client_id=customer WHERE proposal_id=NEW.id AND client_id IS NULL;
 UPDATE communications SET client_id=customer WHERE lead_id=lead_row.id AND client_id IS NULL;
 INSERT INTO audit_logs(action,entity,entity_type,entity_id,after_json) VALUES('proposal_acceptance_client_conversion','lead','lead',lead_row.id,jsonb_build_object('client_id',customer,'proposal_id',NEW.id,'accepted_version_id',NEW.accepted_version_id));
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_accept_client AFTER UPDATE OF status ON proposals FOR EACH ROW
 WHEN(NEW.status IN ('ACCEPTED','CONVERTED') AND (OLD.status IS DISTINCT FROM NEW.status)) EXECUTE FUNCTION workflow_accept_client();

-- Promote only already-linked, verifiably accepted commercial records. Preserve ambiguous historical links for review.
UPDATE clients c SET sales_qualified=true,updated_at=now() WHERE NOT sales_qualified AND EXISTS(
 SELECT 1 FROM proposals p WHERE p.client_id=c.id AND p.deleted_at IS NULL AND p.status IN ('ACCEPTED','CONVERTED') AND p.accepted_version_id IS NOT NULL);
UPDATE leads l SET status='WON',updated_at=now() WHERE l.deleted_at IS NULL AND l.status NOT IN ('WON','LOST')
 AND l.converted_client_id IS NOT NULL AND EXISTS(SELECT 1 FROM proposals p WHERE p.lead_id=l.id AND p.client_id=l.converted_client_id
  AND p.deleted_at IS NULL AND p.status IN ('ACCEPTED','CONVERTED') AND p.accepted_version_id IS NOT NULL);

CREATE FUNCTION workflow_invoice_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status NOT IN ('DRAFT','VOID','REFUNDED') AND NEW.proposal_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM contracts k WHERE k.proposal_id=NEW.proposal_id AND k.status IN ('ISSUED','SIGNED')) THEN
   INSERT INTO tasks(title,description,lead_id,client_id,event_id,proposal_id,lifecycle_key)
   SELECT 'Prepare client agreement','Invoice issued. Prepare and send the current agreement before first payment.',p.lead_id,NEW.client_id,NEW.event_id,p.id,'invoice-agreement:'||NEW.id FROM proposals p WHERE p.id=NEW.proposal_id
   ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING;
  END IF;
  IF NEW.amount_paid>=ceil(NEW.total*100*.3)/100 THEN
   UPDATE tasks SET status='DONE',closure_reason='Automatically resolved because the required booking payment was received.',closed_at=now(),updated_at=now()
    WHERE lifecycle_key='booking-payment:'||NEW.id AND status IN ('OPEN','IN_PROGRESS');
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER workflow_invoice_task AFTER INSERT OR UPDATE OF status,amount_paid ON invoices FOR EACH ROW EXECUTE FUNCTION workflow_invoice_task();
CREATE FUNCTION workflow_contract_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('ISSUED','SIGNED') THEN
  UPDATE tasks SET status='DONE',closure_reason='Automatically resolved because the agreement was issued.',closed_at=now(),updated_at=now()
   WHERE lifecycle_key IN(SELECT 'invoice-agreement:'||id FROM invoices WHERE proposal_id=NEW.proposal_id) AND status IN ('OPEN','IN_PROGRESS');
 END IF;
 IF NEW.status='SIGNED' THEN
  INSERT INTO tasks(title,description,lead_id,client_id,event_id,proposal_id,lifecycle_key)
  SELECT 'Booking fee payment required','Agreement signed. Follow up on the first payment; no booking confirmation before required payment.',p.lead_id,i.client_id,i.event_id,p.id,'booking-payment:'||i.id
   FROM proposals p JOIN invoices i ON i.proposal_id=p.id WHERE p.id=NEW.proposal_id AND i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','VOID','REFUNDED') AND i.amount_paid<ceil(i.total*100*.3)/100
  ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER workflow_contract_task AFTER UPDATE OF status ON contracts FOR EACH ROW EXECUTE FUNCTION workflow_contract_task();
CREATE INDEX tasks_notification_candidates ON tasks(assigned_at,id) WHERE deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS') AND assigned_user_id IS NOT NULL;

CREATE FUNCTION workflow_reassign_client_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
  UPDATE tasks SET assigned_user_id=NEW.owner_id,updated_at=now() WHERE deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS') AND lifecycle_key IS NOT NULL
   AND lead_id IS NULL AND proposal_id IS NULL AND client_id IN(SELECT id FROM clients WHERE contact_id=NEW.id AND deleted_at IS NULL);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER workflow_reassign_client_tasks AFTER UPDATE OF owner_id ON crm_contacts FOR EACH ROW EXECUTE FUNCTION workflow_reassign_client_tasks();

-- Repair open generated-task ownership from verified current records/history only.
-- Assignment triggers audit this change. Notification activation uses a later fresh cutoff.
UPDATE tasks t SET assigned_user_id=workflow_task_owner(t.lead_id,t.client_id,t.event_id,t.proposal_id),updated_at=now()
 WHERE t.deleted_at IS NULL AND t.status IN ('OPEN','IN_PROGRESS') AND t.lifecycle_key IS NOT NULL
  AND workflow_task_owner(t.lead_id,t.client_id,t.event_id,t.proposal_id) IS NOT NULL
  AND t.assigned_user_id IS DISTINCT FROM workflow_task_owner(t.lead_id,t.client_id,t.event_id,t.proposal_id);

-- Only an issued replacement requires re-signing; a saved draft never revokes a signed agreement.
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
    AND NOT EXISTS(SELECT 1 FROM contracts newer WHERE newer.proposal_id=k.proposal_id AND newer.revision>k.revision AND newer.status IN ('ISSUED','SIGNED')))
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
