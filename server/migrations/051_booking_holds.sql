-- Additive reservation infrastructure. Existing equipment rows represent individual units.
CREATE TABLE booking_holds (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id UUID NOT NULL REFERENCES events(id),
 created_by UUID REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CONFIRMED','RELEASED','EXPIRED')),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX booking_holds_one_active_event ON booking_holds(event_id) WHERE status='ACTIVE';
CREATE INDEX booking_holds_expiry ON booking_holds(expires_at) WHERE status='ACTIVE';
CREATE TABLE booking_hold_resources (
 hold_id UUID NOT NULL REFERENCES booking_holds(id) ON DELETE CASCADE,
 equipment_id UUID REFERENCES equipment(id),
 backdrop_id UUID REFERENCES backdrops(id),
 CHECK(num_nonnulls(equipment_id,backdrop_id)=1)
);
CREATE UNIQUE INDEX booking_hold_equipment ON booking_hold_resources(hold_id,equipment_id) WHERE equipment_id IS NOT NULL;
CREATE UNIQUE INDEX booking_hold_backdrop ON booking_hold_resources(hold_id,backdrop_id) WHERE backdrop_id IS NOT NULL;

-- Shared by holds and assignments; handles overnight windows and turnaround.
CREATE OR REPLACE FUNCTION event_unavailable_range(target_event_id UUID)
RETURNS TSTZRANGE AS $$
DECLARE e events%ROWTYPE; buffer_minutes INTEGER; booking_timezone TEXT;
BEGIN
 SELECT * INTO e FROM events WHERE id=target_event_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
 SELECT default_equipment_turnaround_buffer_minutes,timezone INTO buffer_minutes,booking_timezone FROM business_settings LIMIT 1;
 -- Legacy records with incomplete timing conservatively occupy their calendar day.
 -- New resource reservations are rejected separately by assert_event_reservations.
 IF e.start_time IS NULL OR e.end_time IS NULL THEN
  RETURN tstzrange((e.event_date::timestamp AT TIME ZONE COALESCE(booking_timezone,'America/Chicago'))-make_interval(mins=>COALESCE(buffer_minutes,30)),
   ((e.event_date+1)::timestamp AT TIME ZONE COALESCE(booking_timezone,'America/Chicago'))+make_interval(mins=>COALESCE(buffer_minutes,30)),'[)');
 END IF;
 RETURN tstzrange(
  ((e.event_date+COALESCE(e.setup_time,e.start_time)) AT TIME ZONE COALESCE(booking_timezone,'America/Chicago'))-make_interval(mins=>COALESCE(buffer_minutes,30)),
  ((e.event_date+COALESCE(e.breakdown_time,e.end_time)
   +CASE WHEN COALESCE(e.breakdown_time,e.end_time)<=COALESCE(e.setup_time,e.start_time) THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE COALESCE(booking_timezone,'America/Chicago'))
   +make_interval(mins=>COALESCE(buffer_minutes,30)), '[)');
END; $$ LANGUAGE plpgsql VOLATILE;

CREATE FUNCTION assert_event_reservations(target UUID) RETURNS VOID AS $$
DECLARE window_range TSTZRANGE; item RECORD; used INTEGER; stock INTEGER;
BEGIN
 -- Serialize reservation mutations, including independent HTTP requests.
 PERFORM pg_advisory_xact_lock(7811051);
 IF NOT EXISTS(SELECT 1 FROM events WHERE id=target AND deleted_at IS NULL AND status NOT IN ('CANCELLED','COMPLETED')) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM equipment_assignments WHERE event_id=target AND released_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM event_planning WHERE event_id=target AND backdrop_id IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM booking_holds WHERE event_id=target AND status='ACTIVE' AND expires_at>clock_timestamp()) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM events WHERE id=target AND (start_time IS NULL OR end_time IS NULL)) THEN
  RAISE EXCEPTION 'Reservation requires event start and end times' USING ERRCODE='23514';
 END IF;
 window_range:=event_unavailable_range(target);
 FOR item IN
  SELECT equipment_id FROM equipment_assignments WHERE event_id=target AND released_at IS NULL
  UNION SELECT r.equipment_id FROM booking_hold_resources r JOIN booking_holds h ON h.id=r.hold_id
   WHERE h.event_id=target AND h.status='ACTIVE' AND h.expires_at>clock_timestamp() AND r.equipment_id IS NOT NULL
 LOOP
  IF NOT EXISTS(SELECT 1 FROM equipment WHERE id=item.equipment_id AND deleted_at IS NULL AND status NOT IN ('MAINTENANCE','RETIRED')) THEN
   RAISE EXCEPTION 'Equipment is unavailable' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
   SELECT 1 FROM equipment_assignments a JOIN events e ON e.id=a.event_id
   WHERE a.equipment_id=item.equipment_id AND a.released_at IS NULL AND e.id<>target
    AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') AND event_unavailable_range(e.id)&&window_range
   UNION ALL
   SELECT 1 FROM booking_hold_resources r JOIN booking_holds h ON h.id=r.hold_id JOIN events e ON e.id=h.event_id
   WHERE r.equipment_id=item.equipment_id AND h.event_id<>target AND h.status='ACTIVE' AND h.expires_at>clock_timestamp()
    AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') AND event_unavailable_range(e.id)&&window_range
  ) THEN RAISE EXCEPTION 'Equipment has a conflicting reservation' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR item IN
  SELECT backdrop_id FROM event_planning WHERE event_id=target AND backdrop_id IS NOT NULL
  UNION SELECT r.backdrop_id FROM booking_hold_resources r JOIN booking_holds h ON h.id=r.hold_id
   WHERE h.event_id=target AND h.status='ACTIVE' AND h.expires_at>clock_timestamp() AND r.backdrop_id IS NOT NULL
 LOOP
  SELECT quantity INTO stock FROM backdrops WHERE id=item.backdrop_id AND kind='PHYSICAL' AND status='ACTIVE';
  IF EXISTS(SELECT 1 FROM backdrops WHERE id=item.backdrop_id AND kind='DIGITAL' AND status='ACTIVE') THEN CONTINUE; END IF;
  IF stock IS NULL OR stock<1 THEN RAISE EXCEPTION 'Backdrop is unavailable' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO used FROM (
   SELECT p.event_id FROM event_planning p JOIN events e ON e.id=p.event_id
    WHERE p.backdrop_id=item.backdrop_id AND e.id<>target AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED')
     AND event_unavailable_range(e.id)&&window_range
   UNION
   SELECT h.event_id FROM booking_holds h JOIN booking_hold_resources r ON r.hold_id=h.id JOIN events e ON e.id=h.event_id
    WHERE r.backdrop_id=item.backdrop_id AND h.event_id<>target AND h.status='ACTIVE' AND h.expires_at>clock_timestamp()
     AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') AND event_unavailable_range(e.id)&&window_range
  ) reservations;
  IF used>=stock THEN RAISE EXCEPTION 'Backdrop has a conflicting reservation' USING ERRCODE='23514'; END IF;
 END LOOP;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION check_event_resource_mutation() RETURNS TRIGGER AS $$
BEGIN
 PERFORM assert_event_reservations(NEW.id);
 IF NEW.status='CANCELLED' OR NEW.deleted_at IS NOT NULL THEN
  UPDATE booking_holds SET status='RELEASED',updated_at=now() WHERE event_id=NEW.id AND status='ACTIVE';
  UPDATE equipment_assignments SET released_at=COALESCE(released_at,now()) WHERE event_id=NEW.id AND released_at IS NULL;
  UPDATE staff_assignments SET released_at=COALESCE(released_at,now()) WHERE event_id=NEW.id AND released_at IS NULL;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER event_reservation_recheck AFTER UPDATE OF event_date,start_time,end_time,setup_time,breakdown_time,status,deleted_at ON events
 FOR EACH ROW EXECUTE FUNCTION check_event_resource_mutation();

CREATE FUNCTION check_resource_assignment() RETURNS TRIGGER AS $$
BEGIN
 PERFORM assert_event_reservations(NEW.event_id);
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER equipment_hold_recheck AFTER INSERT OR UPDATE ON equipment_assignments FOR EACH ROW EXECUTE FUNCTION check_resource_assignment();
CREATE TRIGGER backdrop_hold_recheck AFTER INSERT OR UPDATE OF backdrop_id ON event_planning FOR EACH ROW EXECUTE FUNCTION check_resource_assignment();

CREATE FUNCTION check_inventory_reservations() RETURNS TRIGGER AS $$
DECLARE event_row RECORD;
BEGIN
 PERFORM pg_advisory_xact_lock(7811051);
 FOR event_row IN SELECT id FROM events WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED','COMPLETED')
  AND ((TG_TABLE_NAME='equipment' AND EXISTS(SELECT 1 FROM equipment_assignments WHERE event_id=events.id AND equipment_id=NEW.id AND released_at IS NULL))
   OR (TG_TABLE_NAME='backdrops' AND EXISTS(SELECT 1 FROM event_planning WHERE event_id=events.id AND backdrop_id=NEW.id))
   OR EXISTS(SELECT 1 FROM booking_holds h JOIN booking_hold_resources r ON r.hold_id=h.id WHERE h.event_id=events.id AND h.status='ACTIVE' AND h.expires_at>clock_timestamp()
     AND ((TG_TABLE_NAME='equipment' AND r.equipment_id=NEW.id) OR (TG_TABLE_NAME='backdrops' AND r.backdrop_id=NEW.id))))
 LOOP PERFORM assert_event_reservations(event_row.id); END LOOP;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER equipment_inventory_recheck AFTER UPDATE OF status,deleted_at ON equipment FOR EACH ROW EXECUTE FUNCTION check_inventory_reservations();
CREATE TRIGGER backdrop_inventory_recheck AFTER UPDATE OF status,quantity,kind ON backdrops FOR EACH ROW EXECUTE FUNCTION check_inventory_reservations();

-- Acquire before row locks so event, inventory and assignment writers share lock order.
CREATE FUNCTION lock_reservation_mutation() RETURNS TRIGGER AS $$
BEGIN PERFORM pg_advisory_xact_lock(7811051); RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER reservation_lock_events BEFORE UPDATE ON events FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();
CREATE TRIGGER reservation_lock_equipment BEFORE INSERT OR UPDATE OR DELETE ON equipment_assignments FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();
CREATE TRIGGER reservation_lock_planning BEFORE INSERT OR UPDATE OR DELETE ON event_planning FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();
CREATE TRIGGER reservation_lock_inventory BEFORE UPDATE ON equipment FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();
CREATE TRIGGER reservation_lock_backdrops BEFORE UPDATE ON backdrops FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();
CREATE TRIGGER reservation_lock_holds BEFORE INSERT OR UPDATE OR DELETE ON booking_holds FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();
CREATE TRIGGER reservation_lock_hold_resources BEFORE INSERT OR UPDATE OR DELETE ON booking_hold_resources FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();

CREATE OR REPLACE FUNCTION prevent_equipment_double_booking() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.released_at IS NOT NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM equipment_assignments a JOIN events e ON e.id=a.event_id
  WHERE a.equipment_id=NEW.equipment_id AND a.released_at IS NULL AND a.id<>NEW.id
   AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED')
   AND event_unavailable_range(e.id)&&event_unavailable_range(NEW.event_id)) THEN
  RAISE EXCEPTION 'Equipment is already assigned to an overlapping event' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Deferred so confirmation may copy resources and create planning within the
-- same transaction, but ordinary event PATCHes cannot bypass a checkout hold.
CREATE FUNCTION assert_confirmed_hold_resources() RETURNS TRIGGER AS $$
DECLARE held booking_holds%ROWTYPE;
BEGIN
 IF NEW.status NOT IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS') OR OLD.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS','COMPLETED') THEN RETURN NEW; END IF;
 SELECT * INTO held FROM booking_holds WHERE event_id=NEW.id ORDER BY (status='ACTIVE') DESC,created_at DESC,id DESC LIMIT 1;
 IF held.id IS NULL THEN RETURN NEW; END IF;
 IF held.status NOT IN ('ACTIVE','CONFIRMED') OR (held.status='ACTIVE' AND held.expires_at<=clock_timestamp()) THEN
  RAISE EXCEPTION 'Checkout hold expired or was released; recheck availability' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM booking_hold_resources WHERE hold_id=held.id) OR EXISTS(
  SELECT 1 FROM booking_hold_resources r WHERE r.hold_id=held.id AND
   ((r.equipment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM equipment_assignments a WHERE a.event_id=NEW.id AND a.equipment_id=r.equipment_id AND a.released_at IS NULL))
    OR (r.backdrop_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM event_planning p WHERE p.event_id=NEW.id AND p.backdrop_id=r.backdrop_id)))
 ) THEN RAISE EXCEPTION 'Held resources must be assigned atomically before booking confirmation' USING ERRCODE='23514'; END IF;
 UPDATE booking_holds SET status='CONFIRMED',updated_at=now() WHERE id=held.id AND status='ACTIVE';
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER confirmed_hold_resources AFTER UPDATE ON events DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION assert_confirmed_hold_resources();
