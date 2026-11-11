-- Additive staging Gallery 2.0 foundation. Existing grants/albums stay intact.
CREATE TABLE gallery_survey_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 event_code text NOT NULL,
 source_digest text NOT NULL,
 configuration_digest text NOT NULL,
 source_ciphertext jsonb NOT NULL,
 mapping jsonb NOT NULL,
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 5000),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(album_id,source_digest), UNIQUE(id,album_id)
);
CREATE TABLE gallery_survey_responses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 import_id uuid NOT NULL,
 source_row integer NOT NULL CHECK(source_row>=2),
 response_ciphertext jsonb NOT NULL,
 filename_ref text,
 issues jsonb NOT NULL DEFAULT '[]',
 media_id uuid,
 match_method text CHECK(match_method IN('EXACT_FILENAME','MANUAL')),
 review_status text NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(review_status IN('NEEDS_REVIEW','CONFIRMED','EXCLUDED')),
 reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_reason jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(import_id,album_id) REFERENCES gallery_survey_imports(id,album_id),
 FOREIGN KEY(media_id,album_id) REFERENCES gallery_media(id,album_id),
 UNIQUE(import_id,source_row),
 CHECK((media_id IS NULL)=(match_method IS NULL))
);
CREATE INDEX gallery_survey_responses_review ON gallery_survey_responses(album_id,review_status);
