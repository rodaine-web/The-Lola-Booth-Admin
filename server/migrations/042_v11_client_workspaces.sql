CREATE TABLE client_workspaces (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 proposal_id UUID NOT NULL REFERENCES proposals(id),
 token_hash TEXT NOT NULL UNIQUE,
 token_ciphertext JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '180 days',
 revoked_at TIMESTAMPTZ,
 created_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX client_workspaces_one_active ON client_workspaces(proposal_id) WHERE revoked_at IS NULL;
