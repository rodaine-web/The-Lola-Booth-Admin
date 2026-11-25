-- Edited deliverables are private outputs, never replacements for gallery media.
CREATE TABLE keepsakes_edit_outputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fulfillment_id uuid NOT NULL REFERENCES keepsakes_fulfillments(id),
 deliverable text NOT NULL CHECK(deliverable IN ('PHOTO','STRIP')), storage_key text NOT NULL, storage_provider text NOT NULL,
 checksum text NOT NULL, size_bytes bigint NOT NULL, mime_type text NOT NULL, width integer NOT NULL,height integer NOT NULL,
 reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',revoked_at timestamptz,
 UNIQUE(fulfillment_id,deliverable)
);
