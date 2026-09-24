ALTER TABLE communications ADD COLUMN IF NOT EXISTS rendered_subject TEXT;
UPDATE communications SET rendered_subject = subject WHERE rendered_subject IS NULL;

CREATE TABLE IF NOT EXISTS communication_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  template_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  subject_template TEXT,
  body_template TEXT NOT NULL,
  text_template TEXT,
  default_send_mode TEXT NOT NULL,
  description TEXT,
  variables TEXT[] NOT NULL DEFAULT '{}',
  snapshot JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, version)
);

INSERT INTO communication_template_versions (
  template_id, template_key, version, name, category, template_type, channel, status,
  subject_template, body_template, text_template, default_send_mode, description, variables, snapshot
)
SELECT
  id, COALESCE(key, template_key), version, name, category, template_type, channel, status,
  COALESCE(subject_template, subject), COALESCE(body_template, body), text_template, default_send_mode,
  description, variables,
  jsonb_build_object(
    'subject_template', COALESCE(subject_template, subject),
    'body_template', COALESCE(body_template, body),
    'text_template', text_template,
    'version', version
  )
FROM email_templates
WHERE deleted_at IS NULL
ON CONFLICT (template_id, version) DO NOTHING;

ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS proof_document_id UUID REFERENCES files(id);
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS approved_version INTEGER;
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS revision_notes TEXT;
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS approval_snapshot JSONB NOT NULL DEFAULT '{}';

DO $$
BEGIN
  ALTER TABLE creative_approvals DROP CONSTRAINT IF EXISTS creative_approvals_status_check;
  UPDATE creative_approvals SET status='PENDING_APPROVAL' WHERE status='PENDING';
  ALTER TABLE creative_approvals ALTER COLUMN status SET DEFAULT 'DRAFT';
  ALTER TABLE creative_approvals ADD CONSTRAINT creative_approvals_status_check CHECK (status IN (
    'DRAFT', 'PENDING_APPROVAL', 'VIEWED', 'CHANGES_REQUESTED', 'APPROVED', 'SUPERSEDED', 'CANCELLED', 'EXPIRED', 'REVOKED'
  ));
END $$;

CREATE TABLE IF NOT EXISTS creative_approval_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID NOT NULL REFERENCES creative_approvals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  proof_document_id UUID REFERENCES files(id),
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(approval_id, version)
);

CREATE TABLE IF NOT EXISTS proposal_document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sections JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  optional_fields TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS document_template_key TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS editable_sections JSONB NOT NULL DEFAULT '[]';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_template_key TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS corporate_billing JSONB NOT NULL DEFAULT '{}';

INSERT INTO proposal_document_templates (key, name, description, sections)
VALUES
  ('standard_event_proposal', 'Standard Event Proposal', 'Default event proposal structure.', '["Introduction","Recommended Experience","Scope of Services","Investment","Payment Schedule","Next Steps","Terms","Acceptance"]'),
  ('wedding_proposal', 'Wedding Proposal', 'Wedding-focused proposal structure.', '["Introduction","Wedding Experience","Guest Journey","Scope of Services","Deliverables","Investment","Payment Schedule","Next Steps","Terms","Acceptance"]'),
  ('corporate_event_proposal', 'Corporate Event Proposal', 'Corporate event proposal structure.', '["Introduction","Event Objective","Recommended Experience","Guest Journey","Scope of Services","Deliverables","Investment","Payment Schedule","Next Steps","Terms","Acceptance"]'),
  ('custom_brand_activation_proposal', 'Custom Brand Activation Proposal', 'Brand activation proposal structure.', '["Introduction","Activation Objective","Recommended Experience","Creative Concept","Guest Journey","Brand Integration","Scope of Services","Deliverables","Optional Enhancements","Production Requirements","Investment","Payment Schedule","Next Steps","Terms","Acceptance"]'),
  ('custom_experience_proposal', 'Custom Experience Proposal', 'Flexible proposal structure for custom experiences.', '["Introduction","Experience Concept","Guest Journey","Scope of Services","Deliverables","Investment","Payment Schedule","Next Steps","Terms","Acceptance"]')
ON CONFLICT (key) DO NOTHING;

INSERT INTO invoice_document_templates (key, name, description, optional_fields)
VALUES
  ('standard_invoice', 'Standard Invoice', 'Default invoice layout.', '{}'),
  ('corporate_invoice', 'Corporate Invoice', 'Corporate billing invoice layout.', ARRAY['company','billing_contact','billing_address','po_number','accounts_payable_email','project_name','tax_exemption','payment_terms']),
  ('brand_activation_invoice', 'Brand Activation Invoice', 'Brand activation invoice layout.', ARRAY['company','billing_contact','billing_address','po_number','accounts_payable_email','project_name','tax_exemption','payment_terms'])
ON CONFLICT (key) DO NOTHING;

INSERT INTO email_templates (
  template_key, key, name, category, subject, body, variables, active, transactional,
  template_type, channel, status, subject_template, body_template, text_template, default_send_mode, description
) VALUES
  ('creative_proof_ready', 'creative_proof_ready', 'Creative Proof Ready', 'APPROVALS', 'Your LOLA proof is ready for review', 'Hi {{client.first_name}},\n\nYour creative proof is ready for review: {{approval.url}}\n\nLOLA Booths', ARRAY['client.first_name','approval.url'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Your LOLA proof is ready for review', 'Hi {{client.first_name}},\n\nYour creative proof is ready for review: {{approval.url}}\n\nLOLA Booths', 'Your creative proof is ready: {{approval.url}}', 'REVIEW_BEFORE_SEND', 'Creative approval request email.'),
  ('creative_proof_approved', 'creative_proof_approved', 'Creative Proof Approved', 'APPROVALS', 'Creative proof approved', '{{client.name}} approved version {{approval.version}} of the creative proof.', ARRAY['client.name','approval.version'], true, true, 'INTERNAL_NOTIFICATION', 'INTERNAL', 'ACTIVE', 'Creative proof approved', '{{client.name}} approved version {{approval.version}} of the creative proof.', '{{client.name}} approved proof version {{approval.version}}.', 'AUTOMATIC', 'Internal approval notification.'),
  ('creative_revision_requested', 'creative_revision_requested', 'Creative Revision Requested', 'APPROVALS', 'Creative revision requested', '{{client.name}} requested changes on version {{approval.version}}.\n\nNotes: {{approval.notes}}', ARRAY['client.name','approval.version','approval.notes'], true, true, 'INTERNAL_NOTIFICATION', 'INTERNAL', 'ACTIVE', 'Creative revision requested', '{{client.name}} requested changes on version {{approval.version}}.\n\nNotes: {{approval.notes}}', '{{client.name}} requested proof changes.', 'AUTOMATIC', 'Internal revision request notification.'),
  ('production_approval', 'production_approval', 'Production Approval', 'APPROVALS', 'Production approval needed', 'Please review and approve production details: {{approval.url}}', ARRAY['approval.url'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Production approval needed', 'Please review and approve production details: {{approval.url}}', 'Production approval needed: {{approval.url}}', 'REVIEW_BEFORE_SEND', 'Production approval request.'),
  ('brand_assets_requested', 'brand_assets_requested', 'Brand Assets Requested', 'APPROVALS', 'Brand assets requested for your LOLA activation', 'Hi {{client.first_name}},\n\nPlease send brand assets for {{event.name}} so we can prepare production details.\n\nLOLA Booths', ARRAY['client.first_name','event.name'], true, true, 'EMAIL', 'EMAIL', 'ACTIVE', 'Brand assets requested for your LOLA activation', 'Hi {{client.first_name}},\n\nPlease send brand assets for {{event.name}} so we can prepare production details.\n\nLOLA Booths', 'Please send brand assets for {{event.name}}.', 'REVIEW_BEFORE_SEND', 'Brand asset request email.')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO permissions (key, description) VALUES
  ('templates.view', 'View communication templates'),
  ('templates.manage', 'Create and manage communication templates'),
  ('communications.view', 'View communications'),
  ('communications.send', 'Send communications'),
  ('communications.schedule', 'Schedule communications'),
  ('communications.retry', 'Retry failed communications'),
  ('automations.view', 'View communication automations'),
  ('automations.manage', 'Manage communication automations'),
  ('approvals.manage', 'Manage creative approvals')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('OWNER', 'ADMIN')
  AND p.key IN ('templates.view','templates.manage','communications.view','communications.send','communications.schedule','communications.retry','automations.view','automations.manage','approvals.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name='EVENT_MANAGER'
  AND p.key IN ('templates.view','communications.view','communications.send','communications.schedule','communications.retry','automations.view','approvals.manage')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_template_versions_template ON communication_template_versions(template_id, version);
CREATE INDEX IF NOT EXISTS idx_creative_approval_revisions_approval ON creative_approval_revisions(approval_id, version);
