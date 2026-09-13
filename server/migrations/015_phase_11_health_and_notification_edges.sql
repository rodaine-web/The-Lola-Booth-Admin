DO $$
BEGIN
  ALTER TABLE worker_heartbeats DROP CONSTRAINT IF EXISTS worker_heartbeats_status_check;
  ALTER TABLE worker_heartbeats ADD CONSTRAINT worker_heartbeats_status_check
    CHECK (status IN ('HEALTHY','DEGRADED','MISCONFIGURED','DISCONNECTED','DOWN','ERROR','UNKNOWN'));

  ALTER TABLE system_health_snapshots DROP CONSTRAINT IF EXISTS system_health_snapshots_status_check;
  ALTER TABLE system_health_snapshots ADD CONSTRAINT system_health_snapshots_status_check
    CHECK (status IN ('HEALTHY','DEGRADED','MISCONFIGURED','DISCONNECTED','DOWN','ERROR','UNKNOWN'));
END $$;

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT false;
