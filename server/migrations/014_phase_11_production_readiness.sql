ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS audit_log_retention_days INTEGER NOT NULL DEFAULT 2555;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS notification_retention_days INTEGER NOT NULL DEFAULT 365;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS offline_receipt_retention_days INTEGER NOT NULL DEFAULT 90;

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'HEALTHY'
    CHECK (status IN ('HEALTHY','DEGRADED','MISCONFIGURED','DISCONNECTED','ERROR','UNKNOWN')),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL
    CHECK (status IN ('HEALTHY','DEGRADED','MISCONFIGURED','DISCONNECTED','ERROR','UNKNOWN')),
  checks JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_health_snapshots_created_at ON system_health_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_seen ON worker_heartbeats(last_heartbeat_at DESC);
