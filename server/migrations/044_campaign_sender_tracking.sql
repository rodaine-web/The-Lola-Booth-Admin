ALTER TABLE campaigns ADD COLUMN sender_email text NOT NULL DEFAULT '';
ALTER TABLE communications ADD COLUMN sender_email text;
ALTER TABLE campaign_recipients ADD COLUMN tracking_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE campaign_tracking_links (
 token_hash text PRIMARY KEY,
 recipient_id uuid NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('OPEN','CLICK')),
 destination text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 year',
 CHECK ((kind='CLICK' AND destination IS NOT NULL) OR (kind='OPEN' AND destination IS NULL))
);
CREATE INDEX campaign_tracking_recipient ON campaign_tracking_links(recipient_id);
