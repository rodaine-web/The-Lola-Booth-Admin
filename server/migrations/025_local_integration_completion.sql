ALTER TABLE invoices ADD COLUMN IF NOT EXISTS token_revoked_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
CREATE TABLE IF NOT EXISTS payment_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
 invoice_id uuid NOT NULL REFERENCES invoices(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoice_access_requests (
 invoice_id uuid PRIMARY KEY REFERENCES invoices(id),
 requested_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_touch jsonb NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS latest_touch jsonb NOT NULL DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_touch jsonb NOT NULL DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS latest_touch jsonb NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_consented_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_consent_source text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_consented_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_consent_source text;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS sms_escalations jsonb NOT NULL DEFAULT '{"event_24h":false,"overdue_balance":false,"urgent_operations":false,"overdue_days":7}';
CREATE TABLE IF NOT EXISTS integration_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL,
 event_name text NOT NULL,
 entity_type text NOT NULL,
 entity_id uuid,
 payload jsonb NOT NULL DEFAULT '{}',
 idempotency_key text NOT NULL UNIQUE,
 mode text NOT NULL DEFAULT 'DEVELOPMENT',
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','SUCCEEDED','FAILED','CANCELLED')),
 attempts int NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 completed_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_jobs_due ON integration_jobs(available_at) WHERE status='QUEUED';
CREATE TABLE IF NOT EXISTS integration_dispatches (
 idempotency_key text PRIMARY KEY,
 provider text NOT NULL,
 provider_reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS public_ack_pending boolean NOT NULL DEFAULT false;
