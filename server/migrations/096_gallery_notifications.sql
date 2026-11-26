-- Transactional photo notifications reuse Gallery identities and communications.
CREATE TABLE gallery_notification_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), config jsonb NOT NULL, version integer NOT NULL DEFAULT 1, updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gallery_notification_settings(config) VALUES('{"enabled":false}');
CREATE TABLE gallery_notification_authorizations (
 album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,person_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN('EMAIL','SMS')),evidence text NOT NULL CHECK(length(evidence)>=10),authorized_by uuid REFERENCES users(id),authorized_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 PRIMARY KEY(album_id,person_id,channel),FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id) ON DELETE CASCADE
);
CREATE TABLE gallery_notification_suppressions (
 contact_hash text PRIMARY KEY,channel text NOT NULL CHECK(channel IN('EMAIL','SMS')),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gallery_notification_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,event_id uuid NOT NULL REFERENCES events(id),published_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(album_id)
);
CREATE TABLE gallery_notification_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),publication_id uuid NOT NULL REFERENCES gallery_notification_publications(id) ON DELETE CASCADE,settings_version integer NOT NULL,snapshot jsonb NOT NULL,recipients_ciphertext jsonb NOT NULL,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',decision text CHECK(decision IN('APPROVED','CANCELED')),decided_by uuid REFERENCES users(id),decided_at timestamptz
);
CREATE TABLE gallery_notification_budgets (
 month date PRIMARY KEY,reserved_micros bigint NOT NULL DEFAULT 0 CHECK(reserved_micros>=0),actual_micros bigint NOT NULL DEFAULT 0 CHECK(actual_micros>=0)
);
CREATE TABLE gallery_notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),publication_id uuid NOT NULL REFERENCES gallery_notification_publications(id) ON DELETE CASCADE,event_id uuid NOT NULL REFERENCES events(id),channel text NOT NULL CHECK(channel IN('EMAIL','SMS')),contact_hash text NOT NULL,contact_ciphertext jsonb NOT NULL,scopes jsonb NOT NULL,status text NOT NULL,communication_id uuid REFERENCES communications(id),review_id uuid REFERENCES gallery_notification_reviews(id),body_ciphertext jsonb,segments integer NOT NULL DEFAULT 0,estimated_micros bigint NOT NULL DEFAULT 0,actual_micros bigint,price_currency text,provider_sid text UNIQUE,failure_code text,budget_month date REFERENCES gallery_notification_budgets(month),reserved_micros bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),submitted_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,channel,contact_hash)
);
CREATE INDEX gallery_notification_queue ON gallery_notification_deliveries(created_at) WHERE status='APPROVED';
CREATE TABLE gallery_phone_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),delivery_id uuid NOT NULL REFERENCES gallery_notification_deliveries(id) ON DELETE CASCADE,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,revoked_at timestamptz,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gallery_phone_email_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),access_id uuid NOT NULL REFERENCES gallery_phone_access(id) ON DELETE CASCADE,email_ciphertext jsonb NOT NULL,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,verified_at timestamptz,communication_id uuid REFERENCES communications(id),created_at timestamptz NOT NULL DEFAULT now()
);
-- Token-scoped email verification does NOT create phone ownership. Legacy unverified rows are never trusted.
CREATE TABLE gallery_trusted_phone_emails (
 phone_hash text PRIMARY KEY,email_ciphertext jsonb NOT NULL,evidence text NOT NULL,verified_at timestamptz NOT NULL,revoked_at timestamptz
);
CREATE TABLE gallery_notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),publication_id uuid REFERENCES gallery_notification_publications(id) ON DELETE CASCADE,delivery_id uuid REFERENCES gallery_notification_deliveries(id) ON DELETE CASCADE,kind text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
-- A provider callback can arrive before create() returns the message SID.
CREATE TABLE gallery_twilio_callback_inbox (
 fingerprint text PRIMARY KEY,provider_sid text NOT NULL,account_sid text NOT NULL,service_sid text NOT NULL,status text NOT NULL,error_code text,created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz
);
CREATE INDEX gallery_twilio_callback_pending ON gallery_twilio_callback_inbox(provider_sid) WHERE processed_at IS NULL;
