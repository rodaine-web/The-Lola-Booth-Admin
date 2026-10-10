-- Retain commercial prerequisites and existing reservation conflict guards.
CREATE OR REPLACE FUNCTION booking_confirmation_missing(target UUID) RETURNS TEXT[] AS $$
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
 RETURN missing;
END; $$ LANGUAGE plpgsql;

-- Equipment is an operations task, never a commercial confirmation prerequisite.
CREATE FUNCTION notify_booking_equipment_assignment() RETURNS TRIGGER AS $$
DECLARE task_id UUID;
BEGIN
 IF NEW.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS')
 AND OLD.status NOT IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS')
 AND NOT EXISTS(SELECT 1 FROM equipment_assignments WHERE event_id=NEW.id AND released_at IS NULL) THEN
  INSERT INTO tasks(title,description,event_id,client_id,status,priority,lifecycle_key)
  VALUES('Assign equipment for confirmed booking','Booking is confirmed. Assign the required equipment before the event; availability and conflict checks apply when assigning.',NEW.id,NEW.client_id,'OPEN','HIGH','booking-equipment:'||NEW.id)
  ON CONFLICT (lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING RETURNING id INTO task_id;
  IF task_id IS NOT NULL THEN
   INSERT INTO notifications(role_target,category,severity,title,body,entity_type,entity_id,action_url,metadata)
   VALUES('MANAGERS','EQUIPMENT','WARNING','Assign equipment for confirmed booking',NEW.event_name||' is confirmed. Equipment assignment is still required.','event',NEW.id,'/events/events/'||NEW.id,jsonb_build_object('task_id',task_id));
  END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER booking_equipment_assignment_notice AFTER UPDATE OF status ON events
 FOR EACH ROW EXECUTE FUNCTION notify_booking_equipment_assignment();

CREATE FUNCTION close_booking_equipment_assignment_task() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.released_at IS NULL THEN
  UPDATE tasks SET status='DONE',updated_at=now() WHERE lifecycle_key='booking-equipment:'||NEW.event_id AND status NOT IN ('DONE','CANCELLED');
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER booking_equipment_assignment_task_completed AFTER INSERT OR UPDATE OF released_at ON equipment_assignments
 FOR EACH ROW EXECUTE FUNCTION close_booking_equipment_assignment_task();
