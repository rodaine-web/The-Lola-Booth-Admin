ALTER TABLE keepsake_station_policies ADD COLUMN published_at timestamptz;
ALTER TABLE keepsake_station_policies ADD COLUMN published_by uuid REFERENCES users(id);
-- RETIRED can only be reached by replacing a previously published policy.
UPDATE keepsake_station_policies SET published_at=created_at WHERE status IN ('PUBLISHED','RETIRED');
