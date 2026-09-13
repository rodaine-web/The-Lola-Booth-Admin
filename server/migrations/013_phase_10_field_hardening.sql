ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS setup_warning_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS event_start_warning_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS equipment_return_warning_hours INTEGER NOT NULL DEFAULT 12;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS delivery_default_expiration_days INTEGER;

ALTER TABLE galleries DROP CONSTRAINT IF EXISTS galleries_status_check;
ALTER TABLE galleries ADD CONSTRAINT galleries_status_check
  CHECK (status IN ('NOT_STARTED','PROCESSING','READY','DELIVERED','VIEWED','ARCHIVED'));
ALTER TABLE galleries ALTER COLUMN status SET DEFAULT 'NOT_STARTED';
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_target TEXT,
  category TEXT NOT NULL CHECK (category IN ('LEADS','SALES','PAYMENTS','EVENTS','STAFF','EQUIPMENT','INCIDENTS','SYSTEM')),
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','HIGH','CRITICAL')),
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT,
  entity_id UUID,
  action_url TEXT,
  channel TEXT NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','EMAIL','SMS','PUSH')),
  delivery_status TEXT NOT NULL DEFAULT 'CREATED' CHECK (delivery_status IN ('CREATED','SENT','FAILED','SKIPPED')),
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  categories JSONB NOT NULL DEFAULT '{}',
  critical_mandatory BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offline_action_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  status TEXT NOT NULL DEFAULT 'SYNCED' CHECK (status IN ('SYNCED','CONFLICT','FAILED')),
  request_payload JSONB NOT NULL DEFAULT '{}',
  response_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_brief_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  staff_assignment_id UUID REFERENCES staff_assignments(id) ON DELETE SET NULL,
  staff_profile_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  recipient_email TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_SENT' CHECK (status IN ('NOT_SENT','SENT','DELIVERED','FAILED')),
  provider TEXT,
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error TEXT,
  brief_snapshot JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gallery_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  gallery_id UUID REFERENCES galleries(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','ARCHIVED')),
  thank_you_message TEXT,
  expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gallery_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES gallery_deliveries(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('EXTERNAL_GALLERY_LINK','INTERNAL_FILE','DOWNLOAD_LINK','VIDEO_LINK')),
  label TEXT NOT NULL,
  url TEXT,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO permissions (key) VALUES
  ('event.operations.view'),
  ('event.operations.manage'),
  ('event.checklist.manage'),
  ('event.incident.create'),
  ('event.incident.manage'),
  ('equipment.checkout'),
  ('equipment.return'),
  ('equipment.override'),
  ('staff.brief.send'),
  ('gallery.delivery.send'),
  ('read:notifications'),
  ('write:notifications')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('event.operations.view','event.operations.manage','event.checklist.manage','event.incident.create','event.incident.manage','equipment.checkout','equipment.return','equipment.override','staff.brief.send','gallery.delivery.send','read:notifications','write:notifications')
WHERE r.name IN ('OWNER','ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('event.operations.view','event.operations.manage','event.checklist.manage','event.incident.create','event.incident.manage','equipment.checkout','equipment.return','staff.brief.send','gallery.delivery.send','read:notifications','write:notifications')
WHERE r.name='EVENT_MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('event.operations.view','event.checklist.manage','event.incident.create','equipment.checkout','equipment.return','read:notifications')
WHERE r.name='ATTENDANT'
ON CONFLICT DO NOTHING;

INSERT INTO email_templates (template_key, name, subject, body, category, active)
VALUES
  ('GALLERY_DELIVERY', 'Gallery Delivery', 'Your LOLA photos are ready', 'Hi {{first_name}},\n\nYour photos from {{event_name}} are ready.\n\nView your photos: {{delivery_url}}\n\nThanks for having LOLA be part of your event.\n\nGood people. Better photos.\n\nLOLA Booths', 'EVENTS', true),
  ('STAFF_BRIEF', 'Staff Brief', 'Your LOLA Event Brief - {{event_name}}', 'Hi {{first_name}},\n\nYour LOLA event brief is ready.\n\nEvent: {{event_name}}\nDate: {{event_date}}\nCall Time: {{call_time}}\nVenue: {{venue_name}}\nRole: {{role}}\n\nOpen Event: {{event_url}}\n\nGood people. Better photos.\n\nLOLA Booths', 'EVENTS', true),
  ('THANK_YOU_FROM_LOLA', 'Thank You From LOLA', 'Thank you from LOLA', 'Hi {{first_name}},\n\nThank you for having LOLA be part of {{event_name}}.\n\nGood people. Better photos.\n\nLOLA Booths', 'EVENTS', true)
ON CONFLICT (template_key) DO UPDATE SET subject=EXCLUDED.subject, body=EXCLUDED.body, active=EXCLUDED.active, updated_at=now();

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, dismissed_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role_target, read_at, dismissed_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_offline_action_receipts_key ON offline_action_receipts(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_gallery_deliveries_token ON gallery_deliveries(token);
CREATE INDEX IF NOT EXISTS idx_gallery_deliveries_event ON gallery_deliveries(event_id, status);
CREATE INDEX IF NOT EXISTS idx_staff_brief_deliveries_event ON staff_brief_deliveries(event_id, staff_assignment_id);
