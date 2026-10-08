-- Extend the existing provider registry and queue, without touching native campaigns.
ALTER TABLE integration_connections DROP CONSTRAINT IF EXISTS integration_connections_status_check;
ALTER TABLE integration_connections ADD CONSTRAINT integration_connections_status_check CHECK(status IN
 ('DISCONNECTED','NOT_CONNECTED','CONNECTING','CONNECTED','DEGRADED','ERROR','EXPIRED','DISABLED','NEEDS_REAUTHORIZATION','AWAITING_APPROVAL','PENDING_APPROVAL'));
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS connection_generation uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS consecutive_failures int NOT NULL DEFAULT 0;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;
INSERT INTO integration_connections(category,provider,status) VALUES
 ('MARKETING','GA4','NOT_CONNECTED'),('MARKETING','MAILCHIMP','NOT_CONNECTED') ON CONFLICT(category,provider) DO NOTHING;
CREATE TABLE integration_oauth_states (
 state_hash text PRIMARY KEY, provider text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 browser_hash text NOT NULL, verifier_encrypted jsonb, redirect_uri text NOT NULL,
 generation uuid NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_oauth_states_expiry ON integration_oauth_states(expires_at);
CREATE TABLE integration_report_cache (
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 cache_key text NOT NULL, report jsonb NOT NULL, refreshed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,cache_key)
);
CREATE INDEX integration_jobs_external_ops ON integration_jobs(provider,event_name,created_at DESC);
-- Marketing preferences only; transactional channels remain independent.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS marketing_opted_out_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_opted_out_at timestamptz;
