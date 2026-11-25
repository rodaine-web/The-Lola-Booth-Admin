-- Capabilities reference existing gallery grants; no gallery identities are merged.
CREATE TABLE keepsakes_photo_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_hash text NOT NULL,
 token_hash text NOT NULL UNIQUE, scopes jsonb NOT NULL,
 expires_at timestamptz NOT NULL, redeemed_at timestamptz,
 communication_id uuid REFERENCES communications(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX keepsakes_photo_request_cooldown ON keepsakes_photo_requests(target_hash,created_at);
CREATE TABLE keepsakes_photo_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
 scopes jsonb NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 request_id uuid REFERENCES keepsakes_photo_requests(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE keepsakes_unverified_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_hash text NOT NULL, email_hash text NOT NULL,
 contact_ciphertext jsonb NOT NULL, request_id uuid NOT NULL REFERENCES keepsakes_photo_requests(id),
 verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status='UNVERIFIED'),
 source text NOT NULL DEFAULT 'GUEST_PHONE_LOOKUP', created_at timestamptz NOT NULL DEFAULT now()
);
-- Strip provenance is explicit; do not guess a strip from a branded collage.
ALTER TABLE gallery_session_assets DROP CONSTRAINT gallery_session_assets_kind_check;
ALTER TABLE gallery_session_assets ADD CONSTRAINT gallery_session_assets_kind_check CHECK(kind IN('COMPOSITE','ORIGINAL','PROCESSED','EXTRACTED_CROP','BRANDED_STRIP'));
