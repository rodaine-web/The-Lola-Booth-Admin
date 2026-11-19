-- Encrypted import evidence and durable review outcomes; no mail is sent.
CREATE TABLE gallery_fiesta_survey_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 event_code text NOT NULL,
 source_sha256 char(64) NOT NULL,
 source_ciphertext jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,album_id)
);
CREATE TABLE gallery_fiesta_survey_rows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 batch_id uuid NOT NULL,
 fingerprint char(64) NOT NULL,
 filename text NOT NULL,
 source_row integer NOT NULL CHECK(source_row>=2),
 person_id uuid,
 status text NOT NULL CHECK(status IN ('NEEDS_REVIEW','IMPORTED','NO_CONSENT','PREPARED_LOCKED')),
 issues text[] NOT NULL DEFAULT '{}',
 answers_ciphertext jsonb NOT NULL,
 FOREIGN KEY(batch_id,album_id) REFERENCES gallery_fiesta_survey_batches(id,album_id),
 FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id),
 UNIQUE(batch_id,fingerprint)
);
CREATE INDEX gallery_fiesta_survey_rows_current ON gallery_fiesta_survey_rows(album_id,fingerprint,sequence DESC);
