ALTER TABLE leads ALTER COLUMN email DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN event_date DROP NOT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS normalized_email TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS normalized_phone TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_subtype TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS form_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS form_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_lead_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_set_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS raw_provider_reference JSONB NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_contacted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS duplicate_status TEXT NOT NULL DEFAULT 'UNIQUE'
  CHECK (duplicate_status IN ('UNIQUE', 'POSSIBLE_DUPLICATE', 'EXISTING_CONTACT', 'IDEMPOTENT_REPLAY', 'TEST'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS duplicate_of_lead_id UUID REFERENCES leads(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS landing_page_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referrer_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_status TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_reference TEXT;

UPDATE leads
SET normalized_email = COALESCE(normalized_email, lower(NULLIF(email, ''))),
    normalized_phone = COALESCE(normalized_phone, NULLIF(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), '')),
    received_at = COALESCE(received_at, created_at),
    provider = COALESCE(provider, lead_source),
    source_subtype = COALESCE(source_subtype, referral_source)
WHERE deleted_at IS NULL;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS communication_preferences JSONB NOT NULL DEFAULT '{}';

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS lead_assignment_mode TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK (lead_assignment_mode IN ('MANUAL', 'ROUND_ROBIN', 'SPECIFIC_USER', 'BY_SOURCE'));
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS lead_assignment_user_id UUID REFERENCES users(id);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS lead_assignment_rules JSONB NOT NULL DEFAULT '{}';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS auto_acknowledge_website_leads BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS auto_acknowledge_social_leads BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS business_hours JSONB NOT NULL DEFAULT '{"monday":["09:00","17:00"],"tuesday":["09:00","17:00"],"wednesday":["09:00","17:00"],"thursday":["09:00","17:00"],"friday":["09:00","17:00"]}';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS google_review_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS facebook_review_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS other_review_url TEXT;

ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS api_version TEXT;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS selected_forms JSONB NOT NULL DEFAULT '[]';
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS leads_received_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_successful_lead_at TIMESTAMPTZ;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS provider_event_id TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS last_error TEXT;
DO $$
BEGIN
  ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_status_check;
  ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_status_check CHECK (status IN (
    'RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'FAILED_NEEDS_REVIEW', 'IGNORED', 'RESOLVED'
  ));
END $$;
UPDATE webhook_events SET provider_event_id = COALESCE(provider_event_id, external_event_id);

CREATE TABLE IF NOT EXISTS lead_source_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  webhook_event_id UUID REFERENCES webhook_events(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  source_subtype TEXT,
  form_id TEXT,
  form_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_set_id TEXT,
  ad_id TEXT,
  external_lead_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'CREATED_LEAD', 'ATTACHED_TO_EXISTING', 'POSSIBLE_DUPLICATE', 'IDEMPOTENT_REPLAY', 'FAILED_NEEDS_REVIEW', 'RESOLVED')),
  test_mode BOOLEAN NOT NULL DEFAULT false,
  safe_payload JSONB NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'SALES',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  transactional BOOLEAN NOT NULL DEFAULT true,
  variables TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL CHECK (action_type IN ('SEND_EMAIL', 'SEND_EMAIL_TEMPLATE', 'CREATE_TASK', 'ASSIGN_LEAD', 'CHANGE_LEAD_STATUS', 'ADD_INTERNAL_NOTE')),
  action_config JSONB NOT NULL DEFAULT '{}',
  delay_amount INTEGER NOT NULL DEFAULT 0,
  delay_unit TEXT NOT NULL DEFAULT 'MINUTES' CHECK (delay_unit IN ('MINUTES', 'HOURS', 'DAYS')),
  send_window TEXT NOT NULL DEFAULT 'IMMEDIATE' CHECK (send_window IN ('IMMEDIATE', 'BUSINESS_HOURS')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}',
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  automation_job_id UUID REFERENCES automation_jobs(id) ON DELETE SET NULL,
  trigger_key TEXT,
  entity_type TEXT,
  entity_id UUID,
  scheduled_for TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  result TEXT NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversion_postbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('QUALIFIED', 'PROPOSAL_SENT', 'BOOKED', 'PAID')),
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'DISABLED', 'SENT', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

INSERT INTO integration_connections (category, provider, status, metadata)
VALUES
  ('MARKETING', 'META', 'DISCONNECTED', '{"supports":["FACEBOOK_LEAD_ADS","INSTAGRAM_LEAD_FORMS"],"verification":"Meta webhook challenge and app secret proof are required before CONNECTED."}'),
  ('MARKETING', 'TIKTOK', 'DISCONNECTED', '{"supports":["TIKTOK_LEAD_GENERATION"],"verification":"TikTok Business API webhook verification must be configured from provider docs."}'),
  ('MARKETING', 'LINKEDIN', 'AWAITING_APPROVAL', '{"approval_required":true,"message":"LinkedIn Lead Sync requires LinkedIn API approval."}'),
  ('MARKETING', 'WEBSITE', 'CONNECTED', '{"verified_by":"public_inquiry_api"}'),
  ('EMAIL', 'EMAIL_PROVIDER', 'DISCONNECTED', '{"supported":["development","resend","postmark"],"test_mode":true}')
ON CONFLICT (category, provider) DO UPDATE
SET metadata = integration_connections.metadata || EXCLUDED.metadata,
    updated_at = now();

INSERT INTO email_templates (template_key, name, category, subject, body, variables, active, transactional)
VALUES
  ('NEW_INQUIRY_ACKNOWLEDGEMENT', 'New Inquiry Acknowledgement', 'SALES', 'We received your LOLA Booths inquiry', 'Hi {{first_name}},\n\nThanks for reaching out to LOLA Booths.\n\nWe received your inquiry for {{event_date}} and someone from our team will review the details and follow up shortly.\n\nIn the meantime, you can explore our experiences and packages on our website.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['first_name','event_date'], true, true),
  ('LEAD_FOLLOW_UP', 'Lead Follow-up', 'SALES', 'Following up from LOLA Booths', 'Hi {{first_name}},\n\nI wanted to follow up on your {{event_type}} inquiry. We would love to help create a polished booth experience for {{event_date}}.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['first_name','event_type','event_date'], true, true),
  ('PROPOSAL_SENT', 'Proposal Sent', 'SALES', 'Your LOLA Booths proposal {{proposal_number}}', 'Hi {{client_name}},\n\nYour proposal is ready: {{proposal_url}}\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client_name','proposal_number','proposal_url'], true, true),
  ('PROPOSAL_REMINDER', 'Proposal Reminder', 'SALES', 'A quick reminder about your LOLA proposal', 'Hi {{client_name}},\n\nYour proposal {{proposal_number}} is still available here: {{proposal_url}}\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client_name','proposal_number','proposal_url'], true, true),
  ('PROPOSAL_EXPIRING', 'Proposal Expiring', 'SALES', 'Your LOLA proposal expires soon', 'Hi {{client_name}},\n\nYour proposal {{proposal_number}} is valid through {{due_date}}.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client_name','proposal_number','due_date'], true, true),
  ('PROPOSAL_ACCEPTED', 'Proposal Accepted', 'SALES', 'Your LOLA proposal is accepted', 'Hi {{client_name}},\n\nThank you for accepting your proposal. We will follow up with next steps.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client_name'], true, true),
  ('DEPOSIT_INVOICE_SENT', 'Deposit Invoice Sent', 'FINANCE', 'Your LOLA Booths deposit invoice {{invoice_number}}', 'Hi {{client_name}},\n\nYour deposit invoice is ready: {{invoice_url}}\n\nAmount due: {{amount_due}}\n\nLOLA Booths', ARRAY['client_name','invoice_number','invoice_url','amount_due'], true, true),
  ('DEPOSIT_REMINDER', 'Deposit Reminder', 'FINANCE', 'Deposit reminder for {{invoice_number}}', 'Hi {{client_name}},\n\nThis is a friendly reminder that {{amount_due}} is due for {{invoice_number}}.\n\nLOLA Booths', ARRAY['client_name','amount_due','invoice_number'], true, true),
  ('PAYMENT_RECEIVED', 'Payment Received', 'FINANCE', 'Payment received by LOLA Booths', 'Hi {{client_name}},\n\nWe received your payment. Thank you.\n\nLOLA Booths', ARRAY['client_name'], true, true),
  ('BALANCE_REMINDER', 'Balance Reminder', 'FINANCE', 'Upcoming balance for {{invoice_number}}', 'Hi {{client_name}},\n\nYour remaining balance is {{remaining_balance}} and is due {{due_date}}.\n\nLOLA Booths', ARRAY['client_name','invoice_number','remaining_balance','due_date'], true, true),
  ('BOOKING_CONFIRMATION', 'Booking Confirmation', 'EVENTS', 'Your LOLA Booths booking is confirmed', 'Hi {{client_name}},\n\nYour {{event_type}} booking for {{event_date}} at {{venue}} is confirmed.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client_name','event_type','event_date','venue'], true, true),
  ('EVENT_REMINDER', 'Event Reminder', 'EVENTS', 'Your LOLA Booths event is coming up', 'Hi {{client_name}},\n\nWe are looking forward to your event on {{event_date}} at {{venue}}.\n\nLOLA Booths', ARRAY['client_name','event_date','venue'], true, true),
  ('GALLERY_READY', 'Gallery Ready', 'EVENTS', 'Your photos are ready', 'Hi {{client_name}},\n\nYour photos are ready: {{gallery_url}}\n\nLOLA Booths', ARRAY['client_name','gallery_url'], true, true),
  ('REVIEW_REQUEST', 'Review Request', 'EVENTS', 'How was your LOLA Booths experience?', 'Hi {{client_name}},\n\nThank you for having LOLA Booths at your event. If you loved the experience, we would be grateful for a review: {{review_url}}\n\nLOLA Booths', ARRAY['client_name','review_url'], true, false),
  ('REFUND_PROCESSED', 'Refund Processed', 'FINANCE', 'Your LOLA Booths refund was processed', 'Hi {{client_name}},\n\nYour refund has been processed.\n\nLOLA Booths', ARRAY['client_name'], true, true)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO automations (name, trigger_key, conditions, action_type, action_config, delay_amount, delay_unit, enabled)
VALUES
  ('New Website Inquiry Acknowledgement', 'LEAD_CREATED', '{"source":"WEBSITE"}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"NEW_INQUIRY_ACKNOWLEDGEMENT"}', 0, 'MINUTES', true),
  ('New Social Lead Acknowledgement', 'LEAD_CREATED', '{"source_in":["META","FACEBOOK","INSTAGRAM","TIKTOK","LINKEDIN"]}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"NEW_INQUIRY_ACKNOWLEDGEMENT"}', 0, 'MINUTES', false),
  ('Proposal Reminder - 2 Days', 'PROPOSAL_SENT', '{}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"PROPOSAL_REMINDER","cancel_statuses":["ACCEPTED","DECLINED","EXPIRED","ARCHIVED"]}', 2, 'DAYS', true),
  ('Proposal Expiring - 1 Day Before', 'PROPOSAL_EXPIRING', '{}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"PROPOSAL_EXPIRING","cancel_statuses":["ACCEPTED","DECLINED","EXPIRED","ARCHIVED"]}', 1, 'DAYS', true),
  ('Deposit Reminder', 'INVOICE_DUE_SOON', '{"invoice_type":"DEPOSIT"}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"DEPOSIT_REMINDER"}', 0, 'DAYS', true),
  ('Balance Reminder - 7 Days', 'INVOICE_DUE_SOON', '{"days_before_due":7}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"BALANCE_REMINDER"}', 0, 'DAYS', true),
  ('Balance Reminder - 3 Days', 'INVOICE_DUE_SOON', '{"days_before_due":3}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"BALANCE_REMINDER"}', 0, 'DAYS', true),
  ('Event Reminder - 7 Days', 'EVENT_UPCOMING', '{"days_before_event":7}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"EVENT_REMINDER"}', 0, 'DAYS', true),
  ('Review Request - 2 Days After Completion', 'EVENT_COMPLETED', '{"requires_review_url":true}', 'SEND_EMAIL_TEMPLATE', '{"template_key":"REVIEW_REQUEST"}', 2, 'DAYS', false)
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_provider_external
ON leads(provider, external_lead_id)
WHERE provider IS NOT NULL AND external_lead_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_normalized_email ON leads(normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone ON leads(normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_received_at ON leads(received_at);
CREATE INDEX IF NOT EXISTS idx_leads_source_campaign ON leads(lead_source, campaign);
CREATE INDEX IF NOT EXISTS idx_lead_source_events_provider_status ON lead_source_events(provider, status, received_at);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_automation_runs_entity ON automation_runs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_key ON email_templates(template_key) WHERE deleted_at IS NULL;
