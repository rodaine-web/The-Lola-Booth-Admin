-- Credentials live outside immutable signed agreement records.
CREATE TABLE contract_access_credentials (
 contract_id UUID PRIMARY KEY REFERENCES contracts(id),
 token_ciphertext JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE contract_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 contract_id UUID NOT NULL REFERENCES contracts(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('INVITATION','SIGNED_COPY')),
 recipient TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PROCESSING','SENT_TO_PROVIDER','FAILED','UNKNOWN','DEVELOPMENT_ONLY')),
 attempt_count INTEGER NOT NULL DEFAULT 1,
 communication_id UUID REFERENCES communications(id),
 provider TEXT,
 provider_message_id TEXT,
 failure_code TEXT,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ,
 UNIQUE(contract_id,purpose)
);
