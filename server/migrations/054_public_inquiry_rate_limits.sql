-- Ephemeral, HMAC-keyed public write quotas shared across API replicas.
CREATE TABLE IF NOT EXISTS public_api_rate_limits (
 key_hash text PRIMARY KEY,
 hits integer NOT NULL CHECK(hits>=0),
 reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_api_rate_limits_reset ON public_api_rate_limits(reset_at);
