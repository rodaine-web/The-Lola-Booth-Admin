ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_session_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SUCCEEDED';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
BEGIN
  ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
  ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check CHECK (payment_method IN (
    'CARD', 'CASH', 'CHECK', 'BANK_TRANSFER', 'ZELLE', 'PAYPAL', 'VENMO', 'ONLINE', 'EXTERNAL_CARD', 'OTHER'
  ));

  ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
  ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN (
    'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'
  ));
END $$;

UPDATE payments
SET provider = COALESCE(provider, 'MANUAL'),
    currency = COALESCE(currency, 'USD'),
    status = COALESCE(status, 'SUCCEEDED'),
    paid_at = COALESCE(paid_at, payment_date::timestamptz);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment ON payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_invoice_status ON payments(invoice_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider);

ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id);
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES proposals(id);
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS provider_session_id TEXT;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

DO $$
BEGIN
  ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_status_check;
  ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_status_check CHECK (status IN (
    'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'
  ));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_idempotency ON payment_attempts(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON payment_attempts(invoice_id);

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider_refund_id TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refund_date DATE NOT NULL DEFAULT current_date;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refund_type TEXT NOT NULL DEFAULT 'PARTIAL';
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_status_check;
  ALTER TABLE refunds ADD CONSTRAINT refunds_status_check CHECK (status IN (
    'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
  ));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_idempotency ON refunds(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_provider_refund ON refunds(provider, provider_refund_id) WHERE provider_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_invoice ON refunds(invoice_id);

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS payload_hash TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE payment_gateway_events ADD COLUMN IF NOT EXISTS payload_hash TEXT;
ALTER TABLE payment_gateway_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'RECEIVED';
ALTER TABLE payment_gateway_events ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE TABLE IF NOT EXISTS payment_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID REFERENCES proposals(id),
  invoice_id UUID REFERENCES invoices(id),
  event_id UUID REFERENCES events(id),
  client_id UUID REFERENCES clients(id),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('FULL_PAYMENT', 'DEPOSIT_BALANCE', 'CUSTOM_INSTALLMENTS')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_schedule_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES payment_schedules(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date DATE,
  invoice_id UUID REFERENCES invoices(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INVOICED', 'PAID', 'CANCELLED')),
  display_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS booking_confirmation_policy TEXT NOT NULL DEFAULT 'DEPOSIT_PAID';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_deposit_type TEXT NOT NULL DEFAULT 'PERCENTAGE';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_deposit_value NUMERIC(12,2) NOT NULL DEFAULT 30;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_balance_due_days_before_event INTEGER NOT NULL DEFAULT 7;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS stripe_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS paypal_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS offline_payment_instructions TEXT NOT NULL DEFAULT 'Please contact LOLA Booths for offline payment instructions.';

DO $$
BEGIN
  ALTER TABLE business_settings DROP CONSTRAINT IF EXISTS business_settings_booking_confirmation_policy_check;
  ALTER TABLE business_settings ADD CONSTRAINT business_settings_booking_confirmation_policy_check CHECK (booking_confirmation_policy IN (
    'MANUAL', 'PROPOSAL_ACCEPTED', 'DEPOSIT_PAID', 'FULL_PAYMENT'
  ));
END $$;
