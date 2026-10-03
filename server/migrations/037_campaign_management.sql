CREATE TABLE campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 type text NOT NULL DEFAULT 'CORPORATE_OUTREACH', channel text NOT NULL DEFAULT 'EMAIL' CHECK(channel IN ('EMAIL','SMS')),
 description text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','READY','SCHEDULED','SENDING','SENT','PAUSED','CANCELLED','FAILED','ARCHIVED')),
 subject text NOT NULL DEFAULT '{{contact.first_name}}, make {{company.name}}''s year-end celebration unforgettable',
 preview_text text NOT NULL DEFAULT 'The LOLA Glam, The LOLA 360 or both. Premium year-end experiences for your team.',
 sender_name text NOT NULL DEFAULT 'The LOLA Booth', reply_to text NOT NULL DEFAULT 'info@thelolabooth.com',
 template_key text NOT NULL DEFAULT 'corporate-year-end-2026', content_json jsonb NOT NULL DEFAULT '{}', audience_json jsonb NOT NULL DEFAULT '{}',
 timezone text NOT NULL DEFAULT 'America/Chicago', scheduled_at timestamptz, started_at timestamptz, completed_at timestamptz,
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaign_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES campaigns(id),
 lead_id uuid REFERENCES leads(id), client_id uuid REFERENCES clients(id), email text NOT NULL,
 first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '', company text NOT NULL DEFAULT '',
 token_hash text UNIQUE, token_expires_at timestamptz, status text NOT NULL DEFAULT 'PENDING',
 communication_id uuid UNIQUE REFERENCES communications(id), queued_at timestamptz, sent_at timestamptz,
 delivered_at timestamptz, opened_at timestamptz, clicked_at timestamptz, failed_at timestamptz, unsubscribed_at timestamptz, interested_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,email)
);
CREATE INDEX campaign_due ON campaigns(status,scheduled_at);
CREATE INDEX campaign_recipient_states ON campaign_recipients(campaign_id,status);
CREATE TABLE campaign_interests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES campaigns(id),
 campaign_recipient_id uuid NOT NULL UNIQUE REFERENCES campaign_recipients(id),
 package text NOT NULL CHECK(package IN ('GLAM','360','DUO')), event_date date NOT NULL, event_time time NOT NULL, location text,
 source text NOT NULL DEFAULT 'CAMPAIGN', submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_interest_recent ON campaign_interests(campaign_id,submitted_at DESC);
CREATE TABLE campaign_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES campaigns(id), recipient_id uuid REFERENCES campaign_recipients(id),
 event_key text UNIQUE, event_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_event_timeline ON campaign_events(campaign_id,created_at DESC);
CREATE TABLE campaign_suppressions (email text PRIMARY KEY, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE communications ADD COLUMN IF NOT EXISTS campaign_recipient_id uuid REFERENCES campaign_recipients(id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS reply_to text;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS sender_name text;
CREATE UNIQUE INDEX communication_campaign_recipient ON communications(campaign_recipient_id) WHERE campaign_recipient_id IS NOT NULL;
INSERT INTO permissions(key,description) VALUES
 ('campaigns.read','View campaigns'),('campaigns.create','Create campaigns'),('campaigns.edit','Edit campaigns'),
 ('campaigns.send','Send campaign emails'),('campaigns.schedule','Schedule campaigns'),('campaigns.cancel','Pause or cancel campaigns') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name IN ('OWNER','ADMIN','SUPER_ADMIN') AND p.key LIKE 'campaigns.%' ON CONFLICT DO NOTHING;
INSERT INTO campaigns(name,description) VALUES('2026 Corporate Year-End Celebration','Approved corporate outreach template. Draft only; select a consented audience before sending.');
