ALTER TABLE events ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'PREPARING'
  CHECK (operational_status IN ('PREPARING','READY','EN_ROUTE','ON_SITE','SETTING_UP','LIVE','BREAKDOWN','COMPLETED','ISSUE_REPORTED'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS operational_status_changed_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS setup_started_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_started_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_ended_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS breakdown_completed_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_completed_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS room_name TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_contact_name TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_contact_phone TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS access_instructions TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS load_in_instructions TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS special_restrictions TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS setup_instructions TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS completion_notes TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS completion_override_reason TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
  CHECK (gallery_status IN ('NOT_STARTED','PROCESSING','READY','DELIVERED','ARCHIVED'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_ready_at TIMESTAMPTZ;

ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS acknowledgement_status TEXT NOT NULL DEFAULT 'ASSIGNED'
  CHECK (acknowledgement_status IN ('ASSIGNED','ACKNOWLEDGED','DECLINED'));
ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS decline_reason TEXT;
ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS call_time TIME;
ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS lead_attendant BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS asset_uid TEXT UNIQUE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS qr_token TEXT UNIQUE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]';
UPDATE equipment
SET asset_uid = COALESCE(asset_uid, equipment_id, 'EQ-' || upper(substr(id::text, 1, 8))),
    qr_token = COALESCE(qr_token, encode(digest(id::text || COALESCE(equipment_id, ''), 'sha256'), 'hex'))
WHERE asset_uid IS NULL OR qr_token IS NULL;

ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'RESERVED'
  CHECK (lifecycle_status IN ('RESERVED','CHECKED_OUT','IN_TRANSIT','ON_SITE','RETURNED','ISSUE','MAINTENANCE'));
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS checked_out_by UUID REFERENCES users(id);
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES users(id);
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS condition_before TEXT
  CHECK (condition_before IS NULL OR condition_before IN ('GOOD','MINOR_DAMAGE','DAMAGED','MISSING_ACCESSORY','NEEDS_ATTENTION'));
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS condition_after TEXT
  CHECK (condition_after IS NULL OR condition_after IN ('GOOD','MINOR_DAMAGE','DAMAGED','MISSING_ACCESSORY','NEEDS_ATTENTION'));
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS checkout_notes TEXT;
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS return_notes TEXT;
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS missing_accessories TEXT;

ALTER TABLE event_checklists ADD COLUMN IF NOT EXISTS template_id UUID;
ALTER TABLE event_checklists ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}';

ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'OPERATIONS';
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES users(id);
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS default_assignee_role TEXT;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS timing_phase TEXT NOT NULL DEFAULT 'BEFORE_EVENT'
  CHECK (timing_phase IN ('BEFORE_EVENT','LOAD_OUT','ARRIVAL','SETUP','LIVE','BREAKDOWN','RETURN','POST_EVENT'));
DO $$
BEGIN
  ALTER TABLE checklist_items DROP CONSTRAINT IF EXISTS checklist_items_status_check;
  ALTER TABLE checklist_items ADD CONSTRAINT checklist_items_status_check CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','NOT_REQUIRED','BLOCKED','OPEN','DONE','CANCELLED'));
END $$;
UPDATE checklist_items SET status='PENDING' WHERE status='OPEN';
UPDATE checklist_items SET status='COMPLETED' WHERE status='DONE';

CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  experience_id UUID REFERENCES experiences(id),
  package_id UUID REFERENCES packages(id),
  event_type TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'OPERATIONS',
  required BOOLEAN NOT NULL DEFAULT true,
  default_assignee_role TEXT,
  timing_phase TEXT NOT NULL DEFAULT 'BEFORE_EVENT'
    CHECK (timing_phase IN ('BEFORE_EVENT','LOAD_OUT','ARRIVAL','SETUP','LIVE','BREAKDOWN','RETURN','POST_EVENT')),
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('PRIMARY_CLIENT','DAY_OF_CONTACT','PLANNER','VENUE_CONTACT','OTHER')),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('EQUIPMENT','CLIENT','VENUE','STAFF','SAFETY','TECHNICAL','OTHER')),
  quick_issue TEXT,
  severity TEXT NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT NOT NULL,
  immediate_action TEXT,
  reported_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','CLOSED')),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_creative_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  overlay_template TEXT,
  print_design TEXT,
  welcome_screen TEXT,
  corporate_logo_file_id UUID REFERENCES files(id),
  hashtag TEXT,
  backdrop_selection TEXT,
  brand_colors TEXT,
  special_design_instructions TEXT,
  approval_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (approval_status IN ('NOT_STARTED','IN_PROGRESS','AWAITING_CLIENT','APPROVED','READY')),
  client_approved_at TIMESTAMPTZ,
  client_approval_note TEXT,
  approved_file_id UUID REFERENCES files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('GENERAL','SETUP','CLIENT','VENUE','CREATIVE','STAFF','EQUIPMENT','INCIDENT','POST_EVENT')),
  body TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  visible_to_attendant BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS equipment_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS equipment_kit_items (
  kit_id UUID NOT NULL REFERENCES equipment_kits(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (kit_id, equipment_id)
);

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS default_setup_minutes INTEGER;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS default_breakdown_minutes INTEGER;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS default_staff_count INTEGER;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS default_equipment_kit_id UUID REFERENCES equipment_kits(id);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS default_checklist_template_id UUID REFERENCES checklist_templates(id);

ALTER TABLE packages ADD COLUMN IF NOT EXISTS operational_staff_count INTEGER;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS operational_equipment_needs JSONB NOT NULL DEFAULT '[]';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS checklist_template_id UUID REFERENCES checklist_templates(id);

INSERT INTO permissions (key) VALUES
  ('read:operations'),
  ('write:operations')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('OWNER','ADMIN') AND p.key IN ('read:operations','write:operations')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='EVENT_MANAGER' AND p.key IN ('read:operations','write:operations')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='ATTENDANT' AND p.key IN ('read:attendant')
ON CONFLICT DO NOTHING;

INSERT INTO checklist_templates (name, event_type)
VALUES
  ('General Event', NULL),
  ('Glam Booth', NULL),
  ('360 Booth', NULL),
  ('Vogue Booth', NULL),
  ('Audio Guestbook', NULL),
  ('Corporate Activation', 'Corporate')
ON CONFLICT DO NOTHING;

INSERT INTO checklist_template_items (template_id, label, description, category, required, default_assignee_role, timing_phase, display_order)
SELECT ct.id, item.label, item.description, item.category, item.required, item.role, item.phase, item.sort
FROM checklist_templates ct
JOIN (
  VALUES
    ('General Event','Primary contact confirmed','Confirm day-of contact and phone.','CLIENT',true,'EVENT_MANAGER','BEFORE_EVENT',10),
    ('General Event','Venue access reviewed','Confirm address, parking, and load-in.','VENUE',true,'EVENT_MANAGER','BEFORE_EVENT',20),
    ('General Event','Staff acknowledged','All assigned staff acknowledge assignment.','STAFF',true,'ATTENDANT','BEFORE_EVENT',30),
    ('General Event','Equipment checked out','Manifest is checked out before travel.','EQUIPMENT',true,'ATTENDANT','LOAD_OUT',40),
    ('General Event','Setup complete','Booth is tested and ready before guests arrive.','OPERATIONS',true,'ATTENDANT','SETUP',50),
    ('General Event','Equipment returned','Manifest is returned and condition recorded.','EQUIPMENT',true,'ATTENDANT','RETURN',60),
    ('Glam Booth','Glam lighting tested','Confirm glam lighting and camera settings.','EQUIPMENT',true,'ATTENDANT','SETUP',10),
    ('Glam Booth','Overlay approved','Confirm glam overlay/template approval.','CREATIVE',true,'EVENT_MANAGER','BEFORE_EVENT',20),
    ('360 Booth','360 platform tested','Confirm motor, app, and safety clearance.','EQUIPMENT',true,'ATTENDANT','SETUP',10),
    ('Vogue Booth','Backdrop confirmed','Confirm Vogue backdrop and print look.','CREATIVE',true,'EVENT_MANAGER','BEFORE_EVENT',10),
    ('Audio Guestbook','Audio phone tested','Confirm greeting, storage, and recording.','EQUIPMENT',true,'ATTENDANT','SETUP',10),
    ('Corporate Activation','Brand assets received','Confirm logo/assets and campaign requirements.','CREATIVE',true,'EVENT_MANAGER','BEFORE_EVENT',10),
    ('Corporate Activation','Data capture reviewed','Confirm required capture fields and export notes.','CLIENT',true,'EVENT_MANAGER','BEFORE_EVENT',20)
) AS item(template_name,label,description,category,required,role,phase,sort)
ON item.template_name = ct.name
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_template_items existing
  WHERE existing.template_id=ct.id AND existing.label=item.label
);

CREATE INDEX IF NOT EXISTS idx_events_operational_status ON events(operational_status, event_date);
CREATE INDEX IF NOT EXISTS idx_staff_assignments_ack ON staff_assignments(acknowledgement_status, event_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assignments_lifecycle ON equipment_assignments(lifecycle_status, event_id);
CREATE INDEX IF NOT EXISTS idx_event_incidents_status ON event_incidents(event_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_event_notes_pinned ON event_notes(event_id, pinned) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_contacts_event ON event_contacts(event_id, role) WHERE deleted_at IS NULL;
