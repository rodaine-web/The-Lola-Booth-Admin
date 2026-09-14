ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS key TEXT;
UPDATE email_templates SET key = template_key WHERE key IS NULL;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS template_type TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS subject_template TEXT;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS body_template TEXT;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS text_template TEXT;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS default_send_mode TEXT NOT NULL DEFAULT 'SEND_NOW';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE email_templates
SET subject_template = COALESCE(subject_template, subject),
    body_template = COALESCE(body_template, body),
    text_template = COALESCE(text_template, body),
    status = CASE WHEN active THEN 'ACTIVE' ELSE 'DRAFT' END
WHERE deleted_at IS NULL;

ALTER TABLE communications ADD COLUMN IF NOT EXISTS channel TEXT;
UPDATE communications SET channel = type WHERE channel IS NULL;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES email_templates(id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS template_key TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS template_version INTEGER;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES proposals(id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS recipient TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS cc TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE communications ADD COLUMN IF NOT EXISTS bcc TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE communications ADD COLUMN IF NOT EXISTS rendered_body TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS rendered_html TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS merge_data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE communications ADD COLUMN IF NOT EXISTS send_mode TEXT NOT NULL DEFAULT 'SEND_NOW';
ALTER TABLE communications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SENT';
ALTER TABLE communications ADD COLUMN IF NOT EXISTS trigger_key TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS failure_message TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES users(id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE communications ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE communications
SET sent_at = occurred_at,
    recipient = COALESCE(recipient, ''),
    rendered_body = COALESCE(rendered_body, message_summary),
    created_by = COALESCE(created_by, user_id),
    sent_by = COALESCE(sent_by, user_id)
WHERE status = 'SENT';

DO $$
BEGIN
  ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_action_type_check;
  ALTER TABLE automations ADD CONSTRAINT automations_action_type_check CHECK (action_type IN (
    'SEND_EMAIL',
    'SEND_EMAIL_TEMPLATE',
    'CREATE_DRAFT_EMAIL',
    'CREATE_DRAFT_SMS',
    'SCHEDULE_COMMUNICATION',
    'CREATE_TASK',
    'ASSIGN_LEAD',
    'CHANGE_LEAD_STATUS',
    'ADD_INTERNAL_NOTE',
    'SEND_SMS'
  ));
END $$;

CREATE TABLE IF NOT EXISTS creative_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  communication_id UUID REFERENCES communications(id) ON DELETE SET NULL,
  gallery_id UUID REFERENCES galleries(id) ON DELETE SET NULL,
  approval_type TEXT NOT NULL DEFAULT 'GALLERY' CHECK (approval_type IN ('GALLERY', 'DESIGN', 'LAYOUT', 'OTHER')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'EXPIRED', 'REVOKED')),
  public_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  approved_by_name TEXT,
  approved_by_email TEXT,
  response_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_templates_key_status ON email_templates(key, status) WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_templates_channel ON email_templates(channel, template_type, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_communications_status_scheduled ON communications(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_communications_template ON communications(template_id, template_key);
CREATE INDEX IF NOT EXISTS idx_communications_entity_status ON communications(client_id, lead_id, event_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_communications_idempotency ON communications(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creative_approvals_event_status ON creative_approvals(event_id, status);

INSERT INTO email_templates (
  template_key, key, name, category, subject, body, variables, active, transactional,
  template_type, channel, status, subject_template, body_template, text_template, default_send_mode, description
) VALUES
  ('sms_new_inquiry_ack', 'sms_new_inquiry_ack', 'SMS New Inquiry Acknowledgement', 'SALES', 'SMS New Inquiry Acknowledgement', 'Hi {{client.first_name}}, thanks for reaching out to LOLA Booths. We received your {{event.type}} inquiry and will follow up shortly.', ARRAY['client.first_name','event.type'], true, true, 'SMS', 'SMS', 'ACTIVE', 'SMS New Inquiry Acknowledgement', 'Hi {{client.first_name}}, thanks for reaching out to LOLA Booths. We received your {{event.type}} inquiry and will follow up shortly.', 'Hi {{client.first_name}}, thanks for reaching out to LOLA Booths. We received your {{event.type}} inquiry and will follow up shortly.', 'CREATE_DRAFT', 'Short lead acknowledgement for future SMS providers.'),
  ('email_new_inquiry_ack', 'email_new_inquiry_ack', 'Email New Inquiry Acknowledgement', 'SALES', 'We received your LOLA Booths inquiry', 'Hi {{client.first_name}},\n\nThanks for reaching out to LOLA Booths. We received your inquiry for {{event.date}} at {{event.venue}} and someone from our team will follow up shortly.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name','event.date','event.venue'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'We received your LOLA Booths inquiry', 'Hi {{client.first_name}},\n\nThanks for reaching out to LOLA Booths. We received your inquiry for {{event.date}} at {{event.venue}} and someone from our team will follow up shortly.\n\nGood people. Better photos.\n\nLOLA Booths', 'Hi {{client.first_name}}, thanks for reaching out to LOLA Booths.', 'SEND_NOW', 'Lead acknowledgement email.'),
  ('lead_follow_up_general', 'lead_follow_up_general', 'Lead Follow-up General', 'SALES', 'Following up from LOLA Booths', 'Hi {{client.first_name}},\n\nI wanted to follow up on your {{event.type}} inquiry. We would love to help create a polished booth experience for {{event.date}}.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name','event.type','event.date'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Following up from LOLA Booths', 'Hi {{client.first_name}},\n\nI wanted to follow up on your {{event.type}} inquiry. We would love to help create a polished booth experience for {{event.date}}.\n\nGood people. Better photos.\n\nLOLA Booths', 'Hi {{client.first_name}}, following up on your LOLA Booths inquiry.', 'CREATE_DRAFT', 'General sales follow-up draft.'),
  ('proposal_sent', 'proposal_sent', 'Proposal Sent', 'SALES', 'Your LOLA Booths proposal {{proposal.number}}', 'Hi {{client.first_name}},\n\nYour proposal is ready: {{proposal.url}}\n\nWe attached a PDF copy for your records.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name','proposal.number','proposal.url'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA Booths proposal {{proposal.number}}', 'Hi {{client.first_name}},\n\nYour proposal is ready: {{proposal.url}}\n\nWe attached a PDF copy for your records.\n\nGood people. Better photos.\n\nLOLA Booths', 'Your proposal is ready: {{proposal.url}}', 'SEND_NOW', 'Default proposal delivery email.'),
  ('proposal_reminder', 'proposal_reminder', 'Proposal Reminder', 'SALES', 'A quick reminder about your LOLA proposal', 'Hi {{client.first_name}},\n\nYour proposal {{proposal.number}} is still available here: {{proposal.url}}\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name','proposal.number','proposal.url'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'A quick reminder about your LOLA proposal', 'Hi {{client.first_name}},\n\nYour proposal {{proposal.number}} is still available here: {{proposal.url}}\n\nGood people. Better photos.\n\nLOLA Booths', 'Reminder: {{proposal.url}}', 'SEND_NOW', 'Proposal follow-up before acceptance.'),
  ('proposal_expiring', 'proposal_expiring', 'Proposal Expiring', 'SALES', 'Your LOLA proposal expires soon', 'Hi {{client.first_name}},\n\nYour proposal {{proposal.number}} is valid through {{proposal.expires_at}}.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name','proposal.number','proposal.expires_at'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA proposal expires soon', 'Hi {{client.first_name}},\n\nYour proposal {{proposal.number}} is valid through {{proposal.expires_at}}.\n\nGood people. Better photos.\n\nLOLA Booths', 'Your proposal expires soon: {{proposal.url}}', 'SEND_NOW', 'Proposal expiry reminder.'),
  ('proposal_accepted', 'proposal_accepted', 'Proposal Accepted', 'SALES', 'Your LOLA proposal is accepted', 'Hi {{client.first_name}},\n\nThank you for accepting your proposal. We will follow up with next steps.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA proposal is accepted', 'Hi {{client.first_name}},\n\nThank you for accepting your proposal. We will follow up with next steps.\n\nGood people. Better photos.\n\nLOLA Booths', 'Thanks for accepting your proposal.', 'SEND_NOW', 'Accepted proposal confirmation.'),
  ('deposit_invoice_sent', 'deposit_invoice_sent', 'Deposit Invoice Sent', 'FINANCE', 'Your LOLA Booths deposit invoice {{invoice.number}}', 'Hi {{client.first_name}},\n\nYour deposit invoice is ready: {{invoice.url}}\n\nAmount due: {{invoice.amount_due}}\n\nLOLA Booths', ARRAY['client.first_name','invoice.number','invoice.url','invoice.amount_due'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA Booths deposit invoice {{invoice.number}}', 'Hi {{client.first_name}},\n\nYour deposit invoice is ready: {{invoice.url}}\n\nAmount due: {{invoice.amount_due}}\n\nLOLA Booths', 'Your deposit invoice is ready: {{invoice.url}}', 'SEND_NOW', 'Deposit invoice delivery email.'),
  ('payment_receipt', 'payment_receipt', 'Payment Receipt', 'FINANCE', 'Payment received by LOLA Booths', 'Hi {{client.first_name}},\n\nWe received your payment of {{payment.amount}}. Thank you.\n\nLOLA Booths', ARRAY['client.first_name','payment.amount'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Payment received by LOLA Booths', 'Hi {{client.first_name}},\n\nWe received your payment of {{payment.amount}}. Thank you.\n\nLOLA Booths', 'Payment received: {{payment.amount}}', 'SEND_NOW', 'Receipt email after payment.'),
  ('balance_due_reminder', 'balance_due_reminder', 'Balance Due Reminder', 'FINANCE', 'Upcoming balance for {{invoice.number}}', 'Hi {{client.first_name}},\n\nYour remaining balance is {{invoice.balance_due}} and is due {{invoice.due_date}}.\n\nLOLA Booths', ARRAY['client.first_name','invoice.number','invoice.balance_due','invoice.due_date'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Upcoming balance for {{invoice.number}}', 'Hi {{client.first_name}},\n\nYour remaining balance is {{invoice.balance_due}} and is due {{invoice.due_date}}.\n\nLOLA Booths', 'Balance due {{invoice.due_date}}: {{invoice.balance_due}}', 'SEND_NOW', 'Balance due reminder.'),
  ('booking_confirmation', 'booking_confirmation', 'Booking Confirmation', 'EVENTS', 'Your LOLA Booths booking is confirmed', 'Hi {{client.first_name}},\n\nYour {{event.type}} booking for {{event.date}} at {{event.venue}} is confirmed.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name','event.type','event.date','event.venue'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA Booths booking is confirmed', 'Hi {{client.first_name}},\n\nYour {{event.type}} booking for {{event.date}} at {{event.venue}} is confirmed.\n\nGood people. Better photos.\n\nLOLA Booths', 'Your LOLA Booths booking is confirmed.', 'SEND_NOW', 'Booked event confirmation.'),
  ('event_week_reminder', 'event_week_reminder', 'Event Week Reminder', 'EVENTS', 'Your LOLA Booths event is coming up', 'Hi {{client.first_name}},\n\nWe are looking forward to your event on {{event.date}} at {{event.venue}}.\n\nLOLA Booths', ARRAY['client.first_name','event.date','event.venue'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA Booths event is coming up', 'Hi {{client.first_name}},\n\nWe are looking forward to your event on {{event.date}} at {{event.venue}}.\n\nLOLA Booths', 'We are looking forward to {{event.date}}.', 'SEND_NOW', 'Pre-event reminder.'),
  ('gallery_delivery', 'gallery_delivery', 'Gallery Delivery', 'EVENTS', 'Your photos are ready', 'Hi {{client.first_name}},\n\nYour photos are ready: {{gallery.url}}\n\nLOLA Booths', ARRAY['client.first_name','gallery.url'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your photos are ready', 'Hi {{client.first_name}},\n\nYour photos are ready: {{gallery.url}}\n\nLOLA Booths', 'Your photos are ready: {{gallery.url}}', 'SEND_NOW', 'Gallery delivery email.'),
  ('review_request', 'review_request', 'Review Request', 'EVENTS', 'How was your LOLA Booths experience?', 'Hi {{client.first_name}},\n\nThank you for having LOLA Booths at your event. If you loved the experience, we would be grateful for a review: {{business.review_url}}\n\nLOLA Booths', ARRAY['client.first_name','business.review_url'], true, false, 'EMAIL', 'EMAIL', 'ACTIVE', 'How was your LOLA Booths experience?', 'Hi {{client.first_name}},\n\nThank you for having LOLA Booths at your event. If you loved the experience, we would be grateful for a review: {{business.review_url}}\n\nLOLA Booths', 'Would you leave us a review? {{business.review_url}}', 'SEND_NOW', 'Post-event review request.'),
  ('staff_assignment_notification', 'staff_assignment_notification', 'Staff Assignment Notification', 'OPERATIONS', 'LOLA Booths assignment for {{event.date}}', 'Hi {{staff.first_name}},\n\nYou have been assigned to {{event.name}} on {{event.date}} at {{event.venue}}.\n\nRole: {{staff.role}}\n\nLOLA Booths', ARRAY['staff.first_name','staff.role','event.name','event.date','event.venue'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'LOLA Booths assignment for {{event.date}}', 'Hi {{staff.first_name}},\n\nYou have been assigned to {{event.name}} on {{event.date}} at {{event.venue}}.\n\nRole: {{staff.role}}\n\nLOLA Booths', 'Assignment: {{event.name}} on {{event.date}}', 'SEND_NOW', 'Staff assignment notice.'),
  ('internal_duplicate_lead_alert', 'internal_duplicate_lead_alert', 'Internal Duplicate Lead Alert', 'INTERNAL', 'Possible duplicate lead', 'A possible duplicate lead was detected for {{client.name}}.\n\nLead: {{lead.id}}\nDuplicate of: {{lead.duplicate_of_id}}', ARRAY['client.name','lead.id','lead.duplicate_of_id'], true, true, 'INTERNAL_NOTIFICATION', 'INTERNAL', 'ACTIVE', 'Possible duplicate lead', 'A possible duplicate lead was detected for {{client.name}}.\n\nLead: {{lead.id}}\nDuplicate of: {{lead.duplicate_of_id}}', 'Possible duplicate lead: {{client.name}}', 'SEND_NOW', 'Internal duplicate lead alert.'),
  ('proposal_document_default', 'proposal_document_default', 'Proposal Document Default', 'DOCUMENT', 'Proposal Document', 'Proposal for {{client.name}}\nEvent: {{event.name}}\nPackage: {{proposal.package_name}}\nTotal: {{proposal.total}}', ARRAY['client.name','event.name','proposal.package_name','proposal.total'], true, true, 'PROPOSAL', 'DOCUMENT', 'ACTIVE', 'Proposal Document', 'Proposal for {{client.name}}\nEvent: {{event.name}}\nPackage: {{proposal.package_name}}\nTotal: {{proposal.total}}', 'Proposal for {{client.name}}', 'GENERATE_DOCUMENT', 'Default proposal document content template.'),
  ('invoice_document_default', 'invoice_document_default', 'Invoice Document Default', 'DOCUMENT', 'Invoice Document', 'Invoice {{invoice.number}}\nClient: {{client.name}}\nAmount due: {{invoice.amount_due}}\nDue: {{invoice.due_date}}', ARRAY['invoice.number','client.name','invoice.amount_due','invoice.due_date'], true, true, 'INVOICE', 'DOCUMENT', 'ACTIVE', 'Invoice Document', 'Invoice {{invoice.number}}\nClient: {{client.name}}\nAmount due: {{invoice.amount_due}}\nDue: {{invoice.due_date}}', 'Invoice {{invoice.number}} for {{client.name}}', 'GENERATE_DOCUMENT', 'Default invoice document content template.')
ON CONFLICT (template_key) DO NOTHING;
