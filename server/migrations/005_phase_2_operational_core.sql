ALTER TABLE leads ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_budget NUMERIC(12,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_date DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT;

DO $$
BEGIN
  ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
  ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN (
    'NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_DRAFT', 'PROPOSAL_SENT',
    'FOLLOW_UP', 'WON', 'LOST', 'ARCHIVED'
  ));
END $$;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE events ADD COLUMN IF NOT EXISTS event_number TEXT UNIQUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS backdrop TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS print_template TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS parking_loading_instructions TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS power_requirements TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS wifi_notes TEXT;

UPDATE events
SET event_number = 'EVT-' || lpad(row_number::text, 5, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS row_number
  FROM events
  WHERE event_number IS NULL
) numbered
WHERE events.id = numbered.id;

DO $$
BEGIN
  ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
  ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN (
    'INQUIRY', 'TENTATIVE', 'CONFIRMED', 'PREPARING', 'READY',
    'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
    'DRAFT', 'PENDING_CONTRACT', 'PENDING_DEPOSIT'
  ));
END $$;

ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS notes TEXT;
DO $$
BEGIN
  ALTER TABLE staff_assignments DROP CONSTRAINT IF EXISTS staff_assignments_assignment_role_check;
  ALTER TABLE staff_assignments ADD CONSTRAINT staff_assignments_assignment_role_check
  CHECK (assignment_role IN ('ATTENDANT', 'LEAD_ATTENDANT', 'EVENT_MANAGER', 'OTHER'));
END $$;

ALTER TABLE packages ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS included_hours NUMERIC(6,2);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS default_deposit NUMERIC(5,2);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS proposal_description TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS website_description TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_one_most_popular
ON packages(most_popular)
WHERE most_popular = true AND deleted_at IS NULL;

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS proposal_description TEXT;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS cover_image_media_id UUID REFERENCES media_library(id);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS default_pricing NUMERIC(12,2);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS setup_duration INTEGER;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS breakdown_duration INTEGER;

ALTER TABLE addons ADD COLUMN IF NOT EXISTS taxable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE addons ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE addons ADD COLUMN IF NOT EXISTS proposal_description TEXT;
DO $$
BEGIN
  ALTER TABLE addons DROP CONSTRAINT IF EXISTS addons_pricing_type_check;
  ALTER TABLE addons ADD CONSTRAINT addons_pricing_type_check
  CHECK (pricing_type IN ('FIXED', 'PER_HOUR', 'PER_UNIT', 'PER_GUEST', 'CUSTOM'));
END $$;

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS legal_business_name TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_balance_due_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS proposal_prefix TEXT NOT NULL DEFAULT 'PROP';

CREATE INDEX IF NOT EXISTS idx_leads_assigned_user ON leads(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(lead_source);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads(follow_up_date);
CREATE INDEX IF NOT EXISTS idx_events_package ON events(package_id);
CREATE INDEX IF NOT EXISTS idx_events_experience ON events(experience_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_priority ON tasks(assigned_user_id, priority);
