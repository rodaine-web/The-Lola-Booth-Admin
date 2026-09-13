ALTER TABLE packages ADD COLUMN IF NOT EXISTS most_popular BOOLEAN NOT NULL DEFAULT false;

UPDATE roles SET name = 'EVENT_MANAGER' WHERE name = 'EVENT MANAGER';

ALTER TABLE files ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PRIVATE'
  CHECK (visibility IN ('PRIVATE', 'INTERNAL', 'CLIENT_VISIBLE', 'PUBLIC'));
ALTER TABLE files ADD COLUMN IF NOT EXISTS permission_state TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK (permission_state IN ('UNKNOWN', 'APPROVED', 'RESTRICTED', 'DO_NOT_PUBLISH'));

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_json JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_json JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

UPDATE audit_logs
SET actor_user_id = COALESCE(actor_user_id, user_id),
    entity_type = COALESCE(entity_type, entity),
    before_json = COALESCE(before_json, before_value),
    after_json = COALESCE(after_json, after_value)
WHERE actor_user_id IS NULL OR entity_type IS NULL OR before_json IS NULL OR after_json IS NULL;

CREATE TABLE IF NOT EXISTS proposal_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, version_number)
);

CREATE TABLE IF NOT EXISTS proposal_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  delivery_method TEXT NOT NULL DEFAULT 'EMAIL' CHECK (delivery_method IN ('EMAIL', 'LINK', 'MANUAL')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'VIEWED', 'FAILED')),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_deliveries_unique_recipient
ON proposal_deliveries(proposal_id, recipient_email, delivery_method);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  invoice_id UUID REFERENCES invoices(id),
  provider TEXT NOT NULL,
  provider_reference TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  provider_reference TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_gateway_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  communication_id UUID REFERENCES communications(id) ON DELETE SET NULL,
  provider TEXT,
  provider_message_id TEXT,
  from_email TEXT,
  to_email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED')),
  body_preview TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  alt_text TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_provider TEXT NOT NULL DEFAULT 'LOCAL',
  storage_key TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'INTERNAL', 'CLIENT_VISIBLE', 'PUBLIC')),
  permission_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (permission_state IN ('UNKNOWN', 'APPROVED', 'RESTRICTED', 'DO_NOT_PUBLISH')),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS website_hero_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_media_id UUID REFERENCES media_library(id),
  mobile_image_media_id UUID REFERENCES media_library(id),
  alt_text TEXT,
  caption TEXT,
  headline TEXT,
  subheadline TEXT,
  cta_label TEXT,
  cta_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  publish_start TIMESTAMPTZ,
  publish_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS website_gallery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES media_library(id),
  title TEXT,
  caption TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS website_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_key TEXT NOT NULL UNIQUE,
  title TEXT,
  body JSONB NOT NULL DEFAULT '{}',
  seo_title TEXT,
  seo_description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  event_type TEXT,
  quote TEXT NOT NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('PAYMENTS', 'MARKETING', 'EMAIL', 'STORAGE', 'CALENDAR', 'ACCOUNTING', 'AUTOMATION')),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN ('DISCONNECTED', 'CONNECTED', 'ERROR', 'NEEDS_REAUTHORIZATION', 'AWAITING_APPROVAL')),
  encrypted_credentials JSONB,
  connected_account TEXT,
  last_successful_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (category, provider)
);

CREATE TABLE IF NOT EXISTS integration_field_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  local_entity TEXT NOT NULL,
  provider_entity TEXT NOT NULL,
  field_map JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_connection_id, local_entity, provider_entity)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, external_event_id)
);

CREATE TABLE IF NOT EXISTS document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('PROPOSAL', 'CONTRACT', 'INVOICE', 'EMAIL', 'QUESTIONNAIRE')),
  body JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE OR REPLACE VIEW lead_activities AS
SELECT * FROM activities WHERE entity_type = 'lead';

CREATE OR REPLACE VIEW event_staff AS
SELECT * FROM staff_assignments;

CREATE OR REPLACE VIEW event_equipment AS
SELECT * FROM equipment_assignments;

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients(created_at);
CREATE INDEX IF NOT EXISTS idx_events_client_id ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_event_id ON invoices(event_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_event_active ON bookings(event_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_visibility ON media_library(visibility, permission_state);
CREATE INDEX IF NOT EXISTS idx_media_created_at ON media_library(created_at);
CREATE INDEX IF NOT EXISTS idx_website_hero_publish ON website_hero_slides(status, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_website_gallery_publish ON website_gallery_items(status, display_order);
CREATE INDEX IF NOT EXISTS idx_website_content_status ON website_content(status);
CREATE INDEX IF NOT EXISTS idx_testimonials_status_order ON testimonials(status, display_order);
CREATE INDEX IF NOT EXISTS idx_faqs_status_order ON faqs(status, display_order);
CREATE INDEX IF NOT EXISTS idx_integration_status ON integration_connections(category, provider, status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(provider, status, received_at);
