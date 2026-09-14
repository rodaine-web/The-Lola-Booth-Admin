ALTER TABLE worker_heartbeats ADD COLUMN IF NOT EXISTS last_successful_communication_processing_at TIMESTAMPTZ;
ALTER TABLE worker_heartbeats ADD COLUMN IF NOT EXISTS last_failed_communication_processing_at TIMESTAMPTZ;
ALTER TABLE worker_heartbeats ADD COLUMN IF NOT EXISTS last_processing_error TEXT;

DO $$
BEGIN
  ALTER TABLE worker_heartbeats DROP CONSTRAINT IF EXISTS worker_heartbeats_status_check;
  ALTER TABLE worker_heartbeats ADD CONSTRAINT worker_heartbeats_status_check
    CHECK (status IN ('HEALTHY','DEGRADED','STALE','MISCONFIGURED','DISCONNECTED','DOWN','ERROR','UNKNOWN'));

  ALTER TABLE system_health_snapshots DROP CONSTRAINT IF EXISTS system_health_snapshots_status_check;
  ALTER TABLE system_health_snapshots ADD CONSTRAINT system_health_snapshots_status_check
    CHECK (status IN ('HEALTHY','DEGRADED','STALE','MISCONFIGURED','DISCONNECTED','DOWN','ERROR','UNKNOWN'));
END $$;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_consent_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_consent_type TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_opted_out_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_consent_reference TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_consent_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_consent_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_opted_out_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS communication_fallback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  environment TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_communication_fallback_events_created ON communication_fallback_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communications_scheduled_claim ON communications(status, scheduled_at, id) WHERE deleted_at IS NULL;

INSERT INTO email_templates (
  template_key, key, name, category, subject, body, variables, active, transactional,
  template_type, channel, status, subject_template, body_template, text_template, default_send_mode, description
) VALUES
  ('staff_brief_email', 'staff_brief_email', 'Staff Brief Email', 'OPERATIONS', 'Your LOLA Event Brief - {{event.name}}', 'Hi {{staff.first_name}},\n\nYour LOLA event brief is ready for {{event.name}}.\n\nDate: {{event.date}}\nCall Time: {{production.call_time}}\nRole: {{staff.role}}\nVenue: {{event.venue}}\nAddress: {{production.venue_address}}\nDay-of Contact: {{production.day_of_contact}}\nExperience: {{production.experience}}\nEquipment: {{production.equipment}}\n\nSetup Instructions: {{production.setup_instructions}}\n\nOpen Event: {{event.url}}\n\nGood people. Better photos.\nLOLA Booths', ARRAY['staff.first_name','event.name','event.date','production.call_time','staff.role','event.venue','production.venue_address','production.day_of_contact','production.experience','production.equipment','production.setup_instructions','event.url'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA Event Brief - {{event.name}}', 'Hi {{staff.first_name}},\n\nYour LOLA event brief is ready for {{event.name}}.\n\nDate: {{event.date}}\nCall Time: {{production.call_time}}\nRole: {{staff.role}}\nVenue: {{event.venue}}\nAddress: {{production.venue_address}}\nDay-of Contact: {{production.day_of_contact}}\nExperience: {{production.experience}}\nEquipment: {{production.equipment}}\n\nSetup Instructions: {{production.setup_instructions}}\n\nOpen Event: {{event.url}}\n\nGood people. Better photos.\nLOLA Booths', 'Your LOLA event brief is ready: {{event.url}}', 'AUTOMATIC', 'Staff event brief delivery.'),
  ('gallery_delivery_email', 'gallery_delivery_email', 'Gallery Delivery Email', 'EVENTS', 'Your LOLA photos are ready', 'Hi {{client.first_name}},\n\nYour photos from {{event.name}} are ready.\n\nView your photos: {{gallery.url}}\n\nThanks for having LOLA be part of your event.\n\nGood people. Better photos.\n\nLOLA Booths', ARRAY['client.first_name','event.name','gallery.url'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA photos are ready', 'Hi {{client.first_name}},\n\nYour photos from {{event.name}} are ready.\n\nView your photos: {{gallery.url}}\n\nThanks for having LOLA be part of your event.\n\nGood people. Better photos.\n\nLOLA Booths', 'Your photos are ready: {{gallery.url}}', 'AUTOMATIC', 'Client gallery delivery email.'),
  ('public_inquiry_owner_notification', 'public_inquiry_owner_notification', 'Public Inquiry Owner Notification', 'LEADS', 'New LOLA {{request.type}} - {{client.name}}', 'Form type: {{request.type}}\nSubmission time: {{request.submitted_at}}\nName: {{client.name}}\nEmail: {{client.email}}\nPhone: {{client.phone}}\nEvent date: {{event.date}}\nEvent type: {{event.type}}\nGuest count: {{event.guest_count}}\nMessage: {{request.notes}}\nSource page: {{request.source_page}}\nResult: {{request.status}}', ARRAY['request.type','request.submitted_at','client.name','client.email','client.phone','event.date','event.type','event.guest_count','request.notes','request.source_page','request.status'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'New LOLA {{request.type}} - {{client.name}}', 'Form type: {{request.type}}\nSubmission time: {{request.submitted_at}}\nName: {{client.name}}\nEmail: {{client.email}}\nPhone: {{client.phone}}\nEvent date: {{event.date}}\nEvent type: {{event.type}}\nGuest count: {{event.guest_count}}\nMessage: {{request.notes}}\nSource page: {{request.source_page}}\nResult: {{request.status}}', 'New inquiry from {{client.name}}', 'AUTOMATIC', 'Owner notification for public inquiry submissions.'),
  ('public_inquiry_customer_confirmation', 'public_inquiry_customer_confirmation', 'Public Inquiry Customer Confirmation', 'LEADS', 'We received your LOLA inquiry', 'Hi {{client.first_name}},\n\nThank you for reaching out to The LOLA Booth. We received your inquiry and the LOLA team will review the details you shared.\n\nEvent date: {{event.date}}\nEvent type: {{event.type}}\nGuest count: {{event.guest_count}}\nMessage: {{request.notes}}\n\nIf anything changes, you can reply to this email with updated details.\n\nLOLA Booths', ARRAY['client.first_name','event.date','event.type','event.guest_count','request.notes'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'We received your LOLA inquiry', 'Hi {{client.first_name}},\n\nThank you for reaching out to The LOLA Booth. We received your inquiry and the LOLA team will review the details you shared.\n\nEvent date: {{event.date}}\nEvent type: {{event.type}}\nGuest count: {{event.guest_count}}\nMessage: {{request.notes}}\n\nIf anything changes, you can reply to this email with updated details.\n\nLOLA Booths', 'We received your LOLA inquiry.', 'AUTOMATIC', 'Customer confirmation for public inquiries.'),
  ('notification_email_default', 'notification_email_default', 'Notification Email Default', 'INTERNAL', '{{request.type}}', '{{request.notes}}', ARRAY['request.type','request.notes'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', '{{request.type}}', '{{request.notes}}', '{{request.notes}}', 'AUTOMATIC', 'Fallback editable email body for notification emails.')
ON CONFLICT (template_key) DO NOTHING;
