CREATE TABLE IF NOT EXISTS integration_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid REFERENCES integration_jobs(id),
 provider text NOT NULL,
 event_name text NOT NULL,
 attempt int NOT NULL DEFAULT 0,
 mode text NOT NULL,
 result text NOT NULL,
 response_summary jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_attempts_provider_time ON integration_attempts(provider,created_at DESC);
