-- Live releases are separate from all test orders and reservations.
CREATE TABLE gallery_live_mailing_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES gallery_albums(id),
 proposal_id uuid REFERENCES proposals(id), version_id uuid REFERENCES proposal_versions(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 500), cost_limit_cents integer NOT NULL CHECK(cost_limit_cents BETWEEN 1 AND 10000000),
 unit_cost_cents integer NOT NULL CHECK(unit_cost_cents BETWEEN 1 AND 100000),
 price_source varchar(2000) NOT NULL, price_verified_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','AUTHORIZED','COMPLETE','NEEDS_REVIEW','CANCELLED')),
 authorization_note varchar(2000),created_by uuid NOT NULL REFERENCES users(id),authorized_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),authorized_at timestamptz,
 CHECK(quantity*unit_cost_cents<=cost_limit_cents)
);
CREATE TABLE gallery_live_mailing_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES gallery_live_mailing_batches(id),album_id uuid NOT NULL REFERENCES gallery_albums(id),
 postcard_id uuid NOT NULL REFERENCES gallery_postcards(id), revision integer NOT NULL,
 recipient_label text NOT NULL,recipient_key char(64) NOT NULL,recipient_ciphertext jsonb NOT NULL,sender_ciphertext jsonb NOT NULL,sender_hash char(64) NOT NULL,
 proof_hash char(64) NOT NULL,test_postcard_id text NOT NULL,
 cost_cents integer NOT NULL CHECK(cost_cents>0),status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','QUEUED','PROCESSING','SUBMITTED','NEEDS_REVIEW','CANCELLED')),
 lob_postcard_id text UNIQUE,lob_status text,provider_updated_at timestamptz,provider_render_status text,last_status_checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,last_error text,
 UNIQUE(batch_id,postcard_id)
);
CREATE UNIQUE INDEX gallery_live_one_recipient ON gallery_live_mailing_jobs(album_id,recipient_key) WHERE status<>'CANCELLED';
CREATE INDEX gallery_live_queue ON gallery_live_mailing_jobs(status,created_at);
CREATE TABLE gallery_live_lob_events (
 event_id text PRIMARY KEY,postcard_reference text NOT NULL,event_type text NOT NULL,provider_created_at timestamptz NOT NULL,
 payload_ciphertext jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz
);
CREATE TABLE gallery_live_webhook_health (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),last_verified_at timestamptz NOT NULL,event_id text NOT NULL
);
