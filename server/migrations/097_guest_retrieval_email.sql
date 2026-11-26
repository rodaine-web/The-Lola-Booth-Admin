-- Temporary guest-provided retrieval addresses are not verified identities or consent.
ALTER TABLE gallery_albums ADD COLUMN guest_retrieval_restricted boolean NOT NULL DEFAULT true;
CREATE TABLE guest_photo_retrieval_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phone_hash text NOT NULL,email_hash text NOT NULL,
 album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,person_id uuid NOT NULL,key_id uuid NOT NULL REFERENCES gallery_access_keys(id) ON DELETE CASCADE,
 contact_ciphertext jsonb NOT NULL,verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status='UNVERIFIED'),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','REVIEW_REQUIRED')),version integer NOT NULL DEFAULT 1,
 source text NOT NULL DEFAULT 'GUEST_PROVIDED',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),corrected_by uuid REFERENCES users(id),
 UNIQUE(phone_hash,album_id,person_id),FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id) ON DELETE CASCADE
);
CREATE INDEX guest_retrieval_phone ON guest_photo_retrieval_addresses(phone_hash);
CREATE INDEX guest_retrieval_email ON guest_photo_retrieval_addresses(email_hash);
-- Keep historic event-scoped associations. Conflicting historic addresses require Admin review.
WITH entries AS (
 SELECT c.phone_hash,c.email_hash,c.contact_ciphertext,c.created_at,(s.value->>'albumId')::uuid album_id,(s.value->>'personId')::uuid person_id,(s.value->>'keyId')::uuid key_id
 FROM keepsakes_unverified_contacts c JOIN keepsakes_photo_requests r ON r.id=c.request_id CROSS JOIN LATERAL jsonb_array_elements(r.scopes) s
 WHERE s.value ? 'albumId' AND s.value ? 'personId' AND s.value ? 'keyId'
), conflicts AS (SELECT phone_hash,album_id,person_id,count(DISTINCT email_hash) AS n FROM entries GROUP BY 1,2,3), picked AS (
 SELECT DISTINCT ON(e.phone_hash,e.album_id,e.person_id) e.*,c.n FROM entries e JOIN conflicts c USING(phone_hash,album_id,person_id) ORDER BY e.phone_hash,e.album_id,e.person_id,e.created_at,e.email_hash
)
INSERT INTO guest_photo_retrieval_addresses(phone_hash,email_hash,album_id,person_id,key_id,contact_ciphertext,status,source,created_at)
 SELECT e.phone_hash,e.email_hash,e.album_id,e.person_id,e.key_id,e.contact_ciphertext,CASE WHEN e.n>1 THEN 'REVIEW_REQUIRED' ELSE 'ACTIVE' END,'LEGACY_GUEST_PROVIDED',e.created_at FROM picked e
 JOIN gallery_people p ON p.id=e.person_id AND p.album_id=e.album_id JOIN gallery_access_keys k ON k.id=e.key_id AND k.album_id=e.album_id;
CREATE TABLE guest_photo_retrieval_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text NOT NULL UNIQUE,ip_hash text NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE guest_photo_retrieval_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text NOT NULL UNIQUE,session_id uuid NOT NULL REFERENCES guest_photo_retrieval_sessions(id) ON DELETE CASCADE,
 phone_hash text NOT NULL,phone_ciphertext jsonb NOT NULL,association_version text NOT NULL,disposition text NOT NULL CHECK(disposition IN('NEW','RETURNING','RECOVERY')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE guest_photo_retrieval_limits (
 key_hash text PRIMARY KEY,window_started_at timestamptz NOT NULL DEFAULT now(),searches integer NOT NULL DEFAULT 0,failures integer NOT NULL DEFAULT 0,blocked_until timestamptz
);
ALTER TABLE keepsakes_photo_requests ADD COLUMN guest_retrieval_delivery_state text CHECK(guest_retrieval_delivery_state IN('QUEUED','SUBMITTING','SENT_TO_PROVIDER','FAILED','SUPPRESSED','UNKNOWN'));
