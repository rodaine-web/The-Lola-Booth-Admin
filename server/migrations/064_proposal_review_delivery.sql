-- Unsent revisions never replace the customer's published commercial terms.
ALTER TABLE proposals ADD COLUMN draft_version_id uuid REFERENCES proposal_versions(id);
ALTER TABLE proposals ADD COLUMN published_version_id uuid REFERENCES proposal_versions(id);
UPDATE proposals p SET published_version_id=COALESCE(p.accepted_version_id,(SELECT id FROM proposal_versions v WHERE v.proposal_id=p.id ORDER BY version_number DESC LIMIT 1)) WHERE p.sent_at IS NOT NULL OR p.status IN ('SENT','VIEWED','ACCEPTED','CONVERTED');
CREATE TABLE proposal_send_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),proposal_id uuid NOT NULL REFERENCES proposals(id),version_id uuid NOT NULL REFERENCES proposal_versions(id),request_id uuid NOT NULL,
 snapshot jsonb NOT NULL,primary_token jsonb NOT NULL,recipients jsonb NOT NULL,
 status text NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','PROCESSING','COMPLETE','PARTIAL','FAILED','UNKNOWN')),
 created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(proposal_id,request_id)
);
CREATE TABLE proposal_send_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES proposal_send_batches(id),email text NOT NULL,is_primary boolean NOT NULL,
 token_hash text UNIQUE,token_ciphertext jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','ACCEPTED','FAILED','UNKNOWN')),
 provider text,provider_message_id text,error_code text,sent_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(batch_id,email)
);
CREATE INDEX proposal_send_pending ON proposal_send_batches(proposal_id) WHERE status IN ('PROCESSING','UNKNOWN');
