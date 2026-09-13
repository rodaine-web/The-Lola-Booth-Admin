CREATE OR REPLACE FUNCTION event_unavailable_range(target_event_id UUID)
RETURNS TSTZRANGE AS $$
DECLARE
  event_row events%ROWTYPE;
BEGIN
  SELECT * INTO event_row FROM events WHERE id = target_event_id;
  IF event_row.id IS NULL THEN
    RAISE EXCEPTION 'Event % not found', target_event_id;
  END IF;
  RETURN tstzrange(
    (event_row.event_date + COALESCE(event_row.setup_time, event_row.start_time))::timestamptz,
    (event_row.event_date + COALESCE(event_row.breakdown_time, event_row.end_time))::timestamptz,
    '[)'
  );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION prevent_equipment_double_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.released_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM equipment_assignments existing
    WHERE existing.equipment_id = NEW.equipment_id
      AND existing.released_at IS NULL
      AND existing.id <> COALESCE(NEW.id, gen_random_uuid())
      AND event_unavailable_range(existing.event_id) && event_unavailable_range(NEW.event_id)
  ) THEN
    RAISE EXCEPTION 'Equipment is already assigned to an overlapping event';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_staff_double_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.released_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM staff_assignments existing
    WHERE existing.staff_profile_id = NEW.staff_profile_id
      AND existing.released_at IS NULL
      AND existing.id <> COALESCE(NEW.id, gen_random_uuid())
      AND event_unavailable_range(existing.event_id) && event_unavailable_range(NEW.event_id)
  ) THEN
    RAISE EXCEPTION 'Staff member is already assigned to an overlapping event';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_equipment_double_booking
BEFORE INSERT OR UPDATE ON equipment_assignments
FOR EACH ROW EXECUTE FUNCTION prevent_equipment_double_booking();

CREATE TRIGGER trg_prevent_staff_double_booking
BEFORE INSERT OR UPDATE ON staff_assignments
FOR EACH ROW EXECUTE FUNCTION prevent_staff_double_booking();
