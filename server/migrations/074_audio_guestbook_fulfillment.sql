ALTER TABLE experiences ALTER COLUMN default_duration DROP NOT NULL;
-- Individual equipment units are shared by standalone and add-on rentals.
ALTER TABLE equipment ADD COLUMN inventory_pool text CHECK(inventory_pool IS NULL OR inventory_pool='AUDIO_GUESTBOOK');
CREATE TABLE audio_guestbook_fulfillments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES events(id),
 equipment_id uuid NOT NULL REFERENCES equipment(id),
 booking_kind text NOT NULL CHECK(booking_kind IN ('STANDALONE','ADDON')),
 method text NOT NULL CHECK(method IN ('LOCAL','SHIPPING')),
 dispatch_at timestamptz NOT NULL,
 expected_return_at timestamptz NOT NULL,
 ready_at timestamptz NOT NULL,
 return_shipping_included boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','DISPATCHED','RETURNED','READY','CANCELLED')),
 dispatched_at timestamptz,
 returned_at timestamptz,
 inspected_at timestamptz,
 notes text NOT NULL DEFAULT '',
 inspection_notes text,
 created_by uuid REFERENCES users(id),
 updated_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(dispatch_at<expected_return_at AND expected_return_at<=ready_at),
 CHECK(method<>'SHIPPING' OR return_shipping_included),
 CHECK(status<>'DISPATCHED' OR dispatched_at IS NOT NULL),
 CHECK(status NOT IN ('RETURNED','READY') OR returned_at IS NOT NULL),
 CHECK(status<>'READY' OR inspected_at IS NOT NULL),
 CHECK(returned_at IS NULL OR (dispatched_at IS NOT NULL AND returned_at>=dispatched_at)),
 CHECK(inspected_at IS NULL OR (returned_at IS NOT NULL AND inspected_at>=returned_at))
);
CREATE UNIQUE INDEX one_active_audio_fulfillment_per_event ON audio_guestbook_fulfillments(event_id,equipment_id) WHERE status NOT IN ('READY','CANCELLED');
CREATE INDEX audio_fulfillment_equipment ON audio_guestbook_fulfillments(equipment_id,status);
CREATE TRIGGER audio_reservation_lock BEFORE INSERT OR UPDATE OR DELETE ON audio_guestbook_fulfillments FOR EACH STATEMENT EXECUTE FUNCTION lock_reservation_mutation();

CREATE FUNCTION audio_guestbook_range(f audio_guestbook_fulfillments) RETURNS tstzrange AS $$
 SELECT CASE WHEN f.status IN ('READY','CANCELLED') THEN 'empty'::tstzrange ELSE
 tstzrange(LEAST(f.dispatch_at,COALESCE(f.dispatched_at,f.dispatch_at)),CASE WHEN f.status IN ('DISPATCHED','RETURNED') AND f.ready_at<=clock_timestamp() THEN NULL ELSE f.ready_at END,'[)') END;
$$ LANGUAGE sql VOLATILE;

CREATE FUNCTION assert_audio_guestbook_inventory(target uuid) RETURNS void AS $$
DECLARE f audio_guestbook_fulfillments%ROWTYPE; e events%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(7811051);
 SELECT * INTO e FROM events WHERE id=target;
 FOR f IN SELECT * FROM audio_guestbook_fulfillments WHERE event_id=target AND status NOT IN ('READY','CANCELLED') LOOP
  IF NOT EXISTS(SELECT FROM equipment WHERE id=f.equipment_id AND inventory_pool='AUDIO_GUESTBOOK' AND deleted_at IS NULL AND status NOT IN ('MAINTENANCE','RETIRED')) THEN
   RAISE EXCEPTION 'Choose an available Audio Guestbook inventory unit' USING ERRCODE='23514'; END IF;
  IF f.status='RESERVED' AND (f.dispatch_at>lower(event_unavailable_range(target)) OR f.expected_return_at<upper(event_unavailable_range(target))) THEN
   RAISE EXCEPTION 'Audio fulfillment must cover event setup, service and breakdown' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM audio_guestbook_fulfillments other WHERE other.event_id<>target AND other.equipment_id=f.equipment_id AND audio_guestbook_range(other)&&audio_guestbook_range(f)) THEN
   RAISE EXCEPTION 'Audio Guestbook is already reserved during delivery, shipping, return or inspection' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM equipment_assignments a JOIN events ev ON ev.id=a.event_id WHERE a.equipment_id=f.equipment_id AND a.event_id<>target AND a.released_at IS NULL AND ev.deleted_at IS NULL AND ev.status NOT IN ('COMPLETED','CANCELLED') AND event_unavailable_range(a.event_id)&&audio_guestbook_range(f)) OR
   EXISTS(SELECT FROM booking_hold_resources r JOIN booking_holds h ON h.id=r.hold_id JOIN events ev ON ev.id=h.event_id WHERE r.equipment_id=f.equipment_id AND h.event_id<>target AND h.status='ACTIVE' AND h.expires_at>clock_timestamp() AND ev.deleted_at IS NULL AND ev.status NOT IN ('COMPLETED','CANCELLED') AND event_unavailable_range(h.event_id)&&audio_guestbook_range(f)) THEN
   RAISE EXCEPTION 'Audio Guestbook conflicts with an existing assignment or checkout hold' USING ERRCODE='23514'; END IF;
 END LOOP;
 -- Every path using an Audio unit must supply its complete fulfillment window.
 IF e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') AND EXISTS(
  SELECT FROM (SELECT equipment_id FROM equipment_assignments WHERE event_id=target AND released_at IS NULL UNION SELECT r.equipment_id FROM booking_hold_resources r JOIN booking_holds h ON h.id=r.hold_id WHERE h.event_id=target AND h.status='ACTIVE' AND h.expires_at>clock_timestamp()) resources
  JOIN equipment eq ON eq.id=resources.equipment_id WHERE eq.inventory_pool='AUDIO_GUESTBOOK' AND NOT EXISTS(SELECT FROM audio_guestbook_fulfillments reservation WHERE reservation.event_id=target AND reservation.equipment_id=eq.id AND reservation.status NOT IN ('READY','CANCELLED'))
 ) THEN RAISE EXCEPTION 'Enter Audio Guestbook fulfillment dates before reserving its equipment' USING ERRCODE='23514'; END IF;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION guard_audio_fulfillment() RETURNS trigger AS $$
BEGIN
 IF TG_OP='INSERT' AND (NEW.status<>'RESERVED' OR NEW.dispatched_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL) THEN RAISE EXCEPTION 'New Audio fulfillments must begin as reservations' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancel an Audio fulfillment to preserve its history' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status IN ('READY','CANCELLED') THEN RAISE EXCEPTION 'Completed Audio fulfillment history is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.event_id<>OLD.event_id OR (OLD.status<>'RESERVED' AND (NEW.equipment_id<>OLD.equipment_id OR NEW.dispatch_at<>OLD.dispatch_at OR NEW.booking_kind<>OLD.booking_kind OR NEW.method<>OLD.method)) THEN RAISE EXCEPTION 'Dispatched rental identity cannot change' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='RESERVED' AND NEW.status IN ('DISPATCHED','CANCELLED')) OR (OLD.status='DISPATCHED' AND NEW.status='RETURNED') OR (OLD.status='RETURNED' AND NEW.status='READY')) THEN RAISE EXCEPTION 'Invalid Audio fulfillment transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='READY' AND (NEW.returned_at>clock_timestamp() OR NEW.inspected_at>clock_timestamp()) THEN RAISE EXCEPTION 'Record actual return and completed inspection before releasing equipment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audio_fulfillment_guard BEFORE INSERT OR UPDATE OR DELETE ON audio_guestbook_fulfillments FOR EACH ROW EXECUTE FUNCTION guard_audio_fulfillment();
CREATE FUNCTION recheck_audio_fulfillment() RETURNS trigger AS $$
BEGIN IF TG_OP='UPDATE' AND NEW.status<>OLD.status AND NEW.status IN ('RETURNED','READY','CANCELLED') THEN RETURN NEW;END IF;PERFORM assert_audio_guestbook_inventory(NEW.event_id);RETURN NEW;END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audio_fulfillment_conflicts AFTER INSERT OR UPDATE ON audio_guestbook_fulfillments FOR EACH ROW EXECUTE FUNCTION recheck_audio_fulfillment();
CREATE FUNCTION recheck_audio_assignment() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.released_at IS NOT NULL AND OLD.released_at IS NULL AND EXISTS(SELECT FROM audio_guestbook_fulfillments WHERE event_id=NEW.event_id AND equipment_id=NEW.equipment_id AND status NOT IN ('READY','CANCELLED')) AND NOT EXISTS(SELECT FROM events WHERE id=NEW.event_id AND (status='CANCELLED' OR deleted_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Cancel the Audio fulfillment or complete its return inspection before releasing this unit' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.event_id=OLD.event_id AND NEW.equipment_id=OLD.equipment_id AND NEW.released_at IS NOT DISTINCT FROM OLD.released_at AND NEW.lifecycle_status IN ('RETURNED','MAINTENANCE') AND OLD.lifecycle_status IN ('CHECKED_OUT','IN_TRANSIT','ON_SITE') THEN RETURN NEW;END IF;
 PERFORM assert_audio_guestbook_inventory(NEW.event_id);RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audio_assignment_recheck AFTER INSERT OR UPDATE ON equipment_assignments FOR EACH ROW EXECUTE FUNCTION recheck_audio_assignment();
CREATE FUNCTION recheck_audio_hold() RETURNS trigger AS $$
DECLARE target uuid;
BEGIN SELECT event_id INTO target FROM booking_holds WHERE id=NEW.hold_id;PERFORM assert_audio_guestbook_inventory(target);RETURN NEW;END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audio_hold_recheck AFTER INSERT OR UPDATE ON booking_hold_resources FOR EACH ROW EXECUTE FUNCTION recheck_audio_hold();

CREATE FUNCTION event_requests_audio_guestbook(target uuid) RETURNS boolean AS $$
 SELECT EXISTS(SELECT FROM events ev JOIN experiences x ON x.id=ev.experience_id WHERE ev.id=target AND x.slug~*'audio|guestbook')
 OR EXISTS(SELECT FROM event_experiences ex JOIN experiences x ON x.id=ex.experience_id WHERE ex.event_id=target AND x.slug~*'audio|guestbook')
 OR EXISTS(SELECT FROM proposals p WHERE p.event_id=target AND p.deleted_at IS NULL AND p.status IN ('ACCEPTED','CONVERTED') AND (p.pricing_snapshot#>>'{package,pricing_profile,experience}'='audio' OR EXISTS(SELECT FROM experiences x WHERE x.id::text=p.pricing_snapshot#>>'{experience,id}' AND x.slug~*'audio|guestbook')))
 OR EXISTS(SELECT FROM event_addons ea JOIN addons a ON a.id=ea.addon_id WHERE ea.event_id=target AND (a.pricing_policy->>'key'='audio-guestbook' OR a.name~*'audio.*guest.*book'))
 OR EXISTS(SELECT FROM proposals p, jsonb_array_elements(CASE WHEN jsonb_typeof(p.pricing_snapshot->'lineItems')='array' THEN p.pricing_snapshot->'lineItems' ELSE '[]'::jsonb END) line WHERE p.event_id=target AND p.deleted_at IS NULL AND p.status IN ('ACCEPTED','CONVERTED') AND EXISTS(SELECT FROM addons a WHERE a.id::text=line->>'addon_id' AND (a.pricing_policy->>'key'='audio-guestbook' OR a.name~*'audio.*guest.*book')));
$$ LANGUAGE sql STABLE;
CREATE FUNCTION recheck_audio_event() RETURNS trigger AS $$
BEGIN
 IF NEW.status='CANCELLED' OR NEW.deleted_at IS NOT NULL THEN UPDATE audio_guestbook_fulfillments SET status='CANCELLED',updated_at=now() WHERE event_id=NEW.id AND status='RESERVED';END IF;
 IF NEW.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS') AND (TG_OP='INSERT' OR OLD.status NOT IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS')) AND event_requests_audio_guestbook(NEW.id) AND NOT EXISTS(SELECT FROM audio_guestbook_fulfillments WHERE event_id=NEW.id AND status NOT IN ('CANCELLED','READY')) THEN RAISE EXCEPTION 'Reserve Audio Guestbook inventory and fulfillment dates before confirming' USING ERRCODE='23514'; END IF;
 IF NEW.deleted_at IS NULL AND NEW.status NOT IN ('CANCELLED','COMPLETED') THEN PERFORM assert_audio_guestbook_inventory(NEW.id);END IF;RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audio_event_recheck AFTER INSERT OR UPDATE OF status,event_date,start_time,end_time,setup_time,breakdown_time,deleted_at ON events FOR EACH ROW EXECUTE FUNCTION recheck_audio_event();

CREATE FUNCTION protect_audio_inventory_pool() RETURNS trigger AS $$
BEGIN IF OLD.inventory_pool='AUDIO_GUESTBOOK' AND NEW.inventory_pool IS DISTINCT FROM OLD.inventory_pool AND EXISTS(SELECT FROM audio_guestbook_fulfillments WHERE equipment_id=OLD.id AND status NOT IN ('READY','CANCELLED')) THEN RAISE EXCEPTION 'Complete or cancel open Audio fulfillments before changing this inventory group' USING ERRCODE='23514';END IF;RETURN NEW;END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audio_inventory_pool_guard BEFORE UPDATE OF inventory_pool ON equipment FOR EACH ROW EXECUTE FUNCTION protect_audio_inventory_pool();
