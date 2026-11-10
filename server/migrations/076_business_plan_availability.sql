-- Only newly accepted internal business plans add these production-readiness checks.
-- Existing commercial snapshots, payment gates and celebration bookings are unchanged.
CREATE FUNCTION business_reservation_missing(target uuid) RETURNS text[] AS $$
DECLARE item record; missing text[]:=ARRAY[]::text[]; staff_count integer:=0; print_count integer:=0; pattern text;
BEGIN
 FOR item IN
  SELECT DISTINCT ent->>'experience' AS experience, COALESCE((ent->>'selectedPrints')::integer,(ent->>'prints')::integer,0) AS prints
  FROM proposals p JOIN proposal_versions v ON v.id=p.accepted_version_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.snapshot#>'{content,catalog_quote,entitlements}','[]'::jsonb)) ent
  WHERE p.event_id=target AND p.deleted_at IS NULL AND p.status IN ('ACCEPTED','CONVERTED') AND ent->>'businessPlan'='true'
 LOOP
  staff_count:=staff_count+1;
  pattern:=CASE item.experience WHEN 'glam' THEN 'glam|dslr' WHEN '360' THEN '360' WHEN 'mirror' THEN 'mirror' WHEN 'vogue' THEN 'vogue' ELSE NULL END;
  IF pattern IS NOT NULL AND NOT EXISTS(SELECT FROM equipment_assignments a JOIN equipment e ON e.id=a.equipment_id WHERE a.event_id=target AND a.released_at IS NULL AND e.deleted_at IS NULL AND e.status NOT IN ('MAINTENANCE','RETIRED') AND (e.name||' '||e.category)~*pattern) THEN
   missing:=array_append(missing,'Assign available '||item.experience||' equipment before confirming this business booking.');
  END IF;
  IF item.prints>0 THEN print_count:=print_count+1;END IF;
 END LOOP;
 IF staff_count>(SELECT count(*) FROM staff_assignments a JOIN staff_profiles s ON s.id=a.staff_profile_id WHERE a.event_id=target AND a.released_at IS NULL AND s.active=true AND s.deleted_at IS NULL) THEN missing:=array_append(missing,'Assign an available trained attendant for each selected business experience before confirmation.');END IF;
 IF print_count>(SELECT count(*) FROM equipment_assignments a JOIN equipment e ON e.id=a.equipment_id WHERE a.event_id=target AND a.released_at IS NULL AND e.deleted_at IS NULL AND e.status NOT IN ('MAINTENANCE','RETIRED') AND (e.name||' '||e.category)~*'printer|print station') THEN missing:=array_append(missing,'Assign supported printing equipment for each business experience with included prints before confirmation.');END IF;
 RETURN missing;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION guard_business_confirmation() RETURNS trigger AS $$
DECLARE missing text[];
BEGIN
 IF NEW.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS') AND (TG_OP='INSERT' OR OLD.status NOT IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS')) THEN
  missing:=business_reservation_missing(NEW.id);
  IF cardinality(missing)>0 THEN RAISE EXCEPTION '%',array_to_string(missing,' ') USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER business_confirmation_availability BEFORE INSERT OR UPDATE OF status ON events FOR EACH ROW EXECUTE FUNCTION guard_business_confirmation();

-- Preserve the existing agreement and financial prerequisites while reporting business resources.
CREATE OR REPLACE FUNCTION booking_confirmation_missing(target UUID) RETURNS TEXT[] AS $$
DECLARE commercial RECORD; missing TEXT[]:=ARRAY[]::TEXT[]; required NUMERIC; paid NUMERIC;
 days_until INTEGER; exception_row booking_payment_exceptions%ROWTYPE;
BEGIN
 missing:=business_reservation_missing(target);
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
