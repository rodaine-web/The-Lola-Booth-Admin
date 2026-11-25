CREATE TABLE keepsakes_photo_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
 session_id uuid NOT NULL REFERENCES keepsakes_photo_sessions(id), selected_asset_ids jsonb NOT NULL,
 target text NOT NULL CHECK(target IN ('SHOP','GALLERY')), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX keepsakes_photo_handoffs_expiry ON keepsakes_photo_handoffs(expires_at);
