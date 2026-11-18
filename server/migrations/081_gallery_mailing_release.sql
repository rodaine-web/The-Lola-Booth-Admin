CREATE TABLE gallery_mailing_policies (
 album_id uuid PRIMARY KEY REFERENCES gallery_albums(id), proposal_id uuid REFERENCES proposals(id), version_id uuid REFERENCES proposal_versions(id),
 allowance_quantity integer NOT NULL DEFAULT 0 CHECK(allowance_quantity>=0), quantity_limit integer NOT NULL CHECK(quantity_limit BETWEEN 0 AND 10000),
 cost_limit_cents integer NOT NULL CHECK(cost_limit_cents BETWEEN 0 AND 10000000), unit_cost_cents integer NOT NULL CHECK(unit_cost_cents BETWEEN 1 AND 100000),
 override_reason text NOT NULL DEFAULT '', approved_by uuid NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gallery_postcards ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE gallery_postcards ADD COLUMN proof_hash char(64);
ALTER TABLE gallery_postcards ADD COLUMN proof_approved_by uuid REFERENCES users(id);
ALTER TABLE gallery_postcards ADD COLUMN proof_approved_at timestamptz;
ALTER TABLE gallery_postcards ADD COLUMN provider_updated_at timestamptz;
ALTER TABLE gallery_postcards ADD COLUMN provider_render_status text;
ALTER TABLE gallery_postcards ADD COLUMN last_status_checked_at timestamptz;
CREATE TABLE gallery_mailing_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES gallery_albums(id), client_id uuid NOT NULL REFERENCES clients(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10000),return_address_ciphertext jsonb,return_address_hash char(64), notes varchar(2000) NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','APPROVED','DECLINED')),
 reviewed_by uuid REFERENCES users(id),review_note varchar(2000),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(album_id,client_id)
);
CREATE TABLE gallery_mailing_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),album_id uuid NOT NULL REFERENCES gallery_albums(id),postcard_id uuid NOT NULL REFERENCES gallery_postcards(id),
 revision integer NOT NULL,recipient_key char(64) NOT NULL,proof_hash char(64) NOT NULL,
 sender_ciphertext jsonb NOT NULL,sender_hash char(64) NOT NULL,extra_copy_reason text NOT NULL DEFAULT '',cost_cents integer NOT NULL CHECK(cost_cents>0),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','SUBMITTED','NEEDS_REVIEW','CANCELLED')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,last_error text,
 UNIQUE(postcard_id,revision)
);
CREATE UNIQUE INDEX gallery_mailing_one_recipient ON gallery_mailing_jobs(album_id,recipient_key) WHERE status<>'CANCELLED' AND extra_copy_reason='';
CREATE TABLE gallery_mailing_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,album_id uuid NOT NULL REFERENCES gallery_albums(id),postcard_id uuid REFERENCES gallery_postcards(id),
 action text NOT NULL,actor_id uuid REFERENCES users(id),detail_ciphertext jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gallery_lob_events (
 event_id text PRIMARY KEY,postcard_reference text NOT NULL,event_type text NOT NULL,provider_created_at timestamptz NOT NULL,
 payload_ciphertext jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz
);
CREATE INDEX gallery_mailing_queue ON gallery_mailing_jobs(status,created_at);
CREATE TABLE partner_workspace_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES partner_workspaces(id),event_id uuid NOT NULL REFERENCES events(id),
 message varchar(3000) NOT NULL,status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RESOLVED')),created_at timestamptz NOT NULL DEFAULT now(),resolved_by uuid REFERENCES users(id)
);
CREATE TABLE partner_workspace_shared_files (
 workspace_id uuid NOT NULL REFERENCES partner_workspaces(id),event_id uuid NOT NULL REFERENCES events(id),file_id uuid NOT NULL REFERENCES files(id),
 shared_by uuid NOT NULL REFERENCES users(id),shared_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,file_id)
);
