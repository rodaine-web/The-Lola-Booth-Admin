-- Additive; existing leads remain unapproved. No historical proposal jobs are backfilled.
ALTER TABLE leads ADD COLUMN availability_confirmed_at timestamptz;
ALTER TABLE leads ADD COLUMN availability_confirmed_by uuid REFERENCES users(id);
ALTER TABLE leads ADD COLUMN availability_fingerprint text;
ALTER TABLE leads ADD CONSTRAINT lead_availability_complete CHECK (
 (availability_confirmed_at IS NULL AND availability_confirmed_by IS NULL AND availability_fingerprint IS NULL)
 OR (availability_confirmed_at IS NOT NULL AND availability_confirmed_by IS NOT NULL AND availability_fingerprint IS NOT NULL));
CREATE FUNCTION invalidate_lead_availability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.event_date,NEW.event_start_time,NEW.event_end_time,NEW.venue_name,NEW.venue_address,NEW.city,NEW.state,NEW.zip,NEW.email,NEW.guest_count,NEW.event_type,NEW.preferred_package_id,NEW.preferred_experience_id,NEW.source_details->'bookingInquiry')
 IS DISTINCT FROM ROW(OLD.event_date,OLD.event_start_time,OLD.event_end_time,OLD.venue_name,OLD.venue_address,OLD.city,OLD.state,OLD.zip,OLD.email,OLD.guest_count,OLD.event_type,OLD.preferred_package_id,OLD.preferred_experience_id,OLD.source_details->'bookingInquiry') THEN
  NEW.availability_confirmed_at=NULL; NEW.availability_confirmed_by=NULL; NEW.availability_fingerprint=NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER invalidate_lead_availability BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION invalidate_lead_availability();
CREATE FUNCTION lead_availability_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.availability_fingerprint IS DISTINCT FROM OLD.availability_fingerprint OR NEW.deleted_at IS NOT NULL OR NEW.status IN('LOST','WON','ARCHIVED')) THEN
  UPDATE automation_jobs SET status='CANCELLED',last_error='Availability approval changed or lead closed',updated_at=now()
   WHERE job_type='BOOKING_SEND_WEBSITE_PROPOSAL' AND related_entity_id=NEW.id AND status='PENDING';
 END IF;
 IF NEW.deleted_at IS NULL AND NEW.status NOT IN('LOST','WON','ARCHIVED') AND (
  EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.source_details->'bookingInquiry'->'selections','[]'::jsonb)) s WHERE s->>'pricingMode'='CUSTOM' OR s->>'packageName' ILIKE '%custom%')
  OR EXISTS(SELECT 1 FROM packages WHERE id=NEW.preferred_package_id AND (pricing_mode='CUSTOM' OR COALESCE(website_key,name) ILIKE '%custom%'))
 ) THEN
  INSERT INTO tasks(lifecycle_key,title,description,lead_id,assigned_user_id,due_date,priority)
   VALUES('lead-custom-discovery:'||NEW.id,'Schedule discovery call','Custom package requested. Discuss scope and pricing before preparing and sending a proposal.',NEW.id,NEW.assigned_user_id,current_date+1,'HIGH')
   ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER lead_availability_tasks AFTER INSERT OR UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION lead_availability_tasks();
