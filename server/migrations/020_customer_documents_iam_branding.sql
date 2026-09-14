ALTER TABLE proposals ADD COLUMN IF NOT EXISTS proposal_source TEXT NOT NULL DEFAULT 'GENERATED';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS proposal_title TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS proposal_date DATE NOT NULL DEFAULT current_date;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS external_document_storage_key TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS external_document_filename TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS external_document_mime_type TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS external_document_size_bytes BIGINT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS external_document_uploaded_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS external_document_uploaded_by UUID REFERENCES users(id);

DO $$
BEGIN
  ALTER TABLE proposals ADD CONSTRAINT proposals_source_check CHECK (proposal_source IN ('GENERATED', 'UPLOADED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_status_check;
  ALTER TABLE email_messages ADD CONSTRAINT email_messages_status_check
    CHECK (status IN ('DRAFT', 'QUEUED', 'SENT', 'SENT_TO_PROVIDER', 'DELIVERED', 'BOUNCED', 'FAILED'));
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_type TEXT NOT NULL CHECK (token_type IN ('INVITATION', 'PASSWORD_RESET')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_account_tokens_user_type ON user_account_tokens(user_id, token_type, expires_at) WHERE used_at IS NULL;

INSERT INTO roles (name, description)
VALUES ('SUPER_ADMIN', 'Administrative operator with user and system management access but no root override.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (key, description) VALUES
  ('view:users', 'View users and invitations'),
  ('create:users', 'Create users and invitations'),
  ('edit:users', 'Edit user profiles'),
  ('disable:users', 'Deactivate user accounts'),
  ('assign:roles', 'Assign allowed user roles'),
  ('invitations.send', 'Send account invitations'),
  ('password_resets.send', 'Send password reset links'),
  ('proposals.upload', 'Upload external proposal PDFs'),
  ('proposals.manage_versions', 'Manage proposal versions'),
  ('communications.compose', 'Compose manual branded emails'),
  ('communications.template_management', 'Manage branded communication templates')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
  AND p.key IN (
    'view:users','create:users','edit:users','disable:users','assign:roles','invitations.send','password_resets.send',
    'proposals.upload','proposals.manage_versions','communications.compose','communications.template_management',
    'templates.view','templates.manage','communications.view','communications.send','communications.schedule','communications.retry','automations.view','automations.manage'
  )
ON CONFLICT DO NOTHING;

INSERT INTO email_templates (
  template_key, key, name, category, subject, body, variables, active, transactional,
  template_type, channel, status, subject_template, body_template, text_template, default_send_mode, description
) VALUES
  ('BOOKING_INQUIRY_CONFIRMATION', 'BOOKING_INQUIRY_CONFIRMATION', 'Booking Inquiry Confirmation', 'WEBSITE', 'Your booking inquiry has been received', 'Thank you for choosing The Lola Booth! We have received your event booking request and our team is already reviewing the details.\n\nWe will be in touch shortly with availability, package options, and a custom quote.', ARRAY['client.first_name','event.date','event.venue','event.type','event.guest_count'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your booking inquiry has been received', 'Thank you for choosing The Lola Booth! We have received your event booking request and our team is already reviewing the details.\n\nWe will be in touch shortly with availability, package options, and a custom quote.', 'Your booking inquiry has been received.', 'AUTOMATIC', 'Customer confirmation for booking inquiry submissions.'),
  ('CONTACT_CONFIRMATION', 'CONTACT_CONFIRMATION', 'Contact Confirmation', 'WEBSITE', 'Thank you for reaching out', 'We received your message and truly appreciate your interest in The Lola Booth. Our team is reviewing your details and we will be in touch shortly, usually within one business day.', ARRAY['client.first_name','request.notes'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Thank you for reaching out', 'We received your message and truly appreciate your interest in The Lola Booth. Our team is reviewing your details and we will be in touch shortly, usually within one business day.', 'Thank you for reaching out.', 'AUTOMATIC', 'Customer confirmation for contact form submissions.'),
  ('PROPOSAL_DELIVERY', 'PROPOSAL_DELIVERY', 'Proposal Delivery', 'SALES', 'Your LOLA proposal is ready', 'Thank you for considering The Lola Booth for your upcoming event!\n\nWe have prepared your custom proposal with all the details, including package options, pricing, and next steps.', ARRAY['client.first_name','proposal.public_url','event.date','event.venue','event.type','proposal.package_name'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA proposal is ready', 'Thank you for considering The Lola Booth for your upcoming event!\n\nWe have prepared your custom proposal with all the details, including package options, pricing, and next steps.', 'Your LOLA proposal is ready: {{proposal.public_url}}', 'REVIEW_BEFORE_SEND', 'Link-first proposal delivery email.'),
  ('INVOICE_DELIVERY', 'INVOICE_DELIVERY', 'Invoice Delivery', 'FINANCE', 'Your LOLA invoice is ready', 'Thank you for choosing The Lola Booth! Your invoice is now ready for review. You can view the full details, make a secure payment, or contact us if you have any questions.', ARRAY['client.first_name','invoice.public_url','invoice.balance_due','invoice.due_date'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA invoice is ready', 'Thank you for choosing The Lola Booth! Your invoice is now ready for review. You can view the full details, make a secure payment, or contact us if you have any questions.', 'Your LOLA invoice is ready: {{invoice.public_url}}', 'REVIEW_BEFORE_SEND', 'Link-first invoice delivery email.'),
  ('PAYMENT_CONFIRMATION', 'PAYMENT_CONFIRMATION', 'Payment Confirmation', 'FINANCE', 'Payment received by The Lola Booth', 'Thank you. Your payment has been received and applied to your Lola Booth invoice.', ARRAY['client.first_name','payment.amount','invoice.number'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Payment received by The Lola Booth', 'Thank you. Your payment has been received and applied to your Lola Booth invoice.', 'Payment received by The Lola Booth.', 'AUTOMATIC', 'Customer payment confirmation email.'),
  ('GENERIC', 'GENERIC', 'Generic Manual Email', 'GENERAL', '{{subject}}', '{{body}}', ARRAY['client.first_name','subject','body'], true, false, 'EMAIL', 'EMAIL', 'ACTIVE', '{{subject}}', '{{body}}', '{{body}}', 'REVIEW_BEFORE_SEND', 'Reusable branded manual email shell.')
ON CONFLICT (template_key) DO UPDATE
SET key=EXCLUDED.key,
    name=EXCLUDED.name,
    category=EXCLUDED.category,
    subject=EXCLUDED.subject,
    body=EXCLUDED.body,
    variables=EXCLUDED.variables,
    active=EXCLUDED.active,
    transactional=EXCLUDED.transactional,
    template_type=EXCLUDED.template_type,
    channel=EXCLUDED.channel,
    status=EXCLUDED.status,
    subject_template=EXCLUDED.subject_template,
    body_template=EXCLUDED.body_template,
    text_template=EXCLUDED.text_template,
    default_send_mode=EXCLUDED.default_send_mode,
    description=EXCLUDED.description,
    updated_at=now();
