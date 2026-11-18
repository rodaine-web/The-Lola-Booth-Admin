-- Schema only: does not enable Lob, submit postcards or alter existing records.
CREATE TABLE IF NOT EXISTS gallery_postcards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 person_id uuid NOT NULL,
 media_id uuid NOT NULL,
 recipient_ciphertext jsonb NOT NULL,
 recipient_label text NOT NULL,
 consent_at timestamptz NOT NULL,
 consent_source text NOT NULL,
 front_url text NOT NULL,
 back_url text NOT NULL,
 size text NOT NULL DEFAULT '4x6' CHECK(size='4x6'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','SUBMITTING','SUBMITTED_TEST','FAILED','CANCELLED')),
 approved_by uuid REFERENCES users(id), approved_at timestamptz,
 lob_postcard_id text, lob_status text, last_error text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id),
 FOREIGN KEY(media_id,album_id) REFERENCES gallery_media(id,album_id),
 UNIQUE(album_id,person_id,media_id)
);
CREATE INDEX IF NOT EXISTS gallery_postcards_album_status ON gallery_postcards(album_id,status);

CREATE TABLE IF NOT EXISTS gallery_postcard_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 filename text NOT NULL,
 fingerprint text NOT NULL,
 recipient_ciphertext jsonb NOT NULL,
 recipient_label text NOT NULL,
 consent boolean NOT NULL DEFAULT false,
 consent_source text NOT NULL,
 status text NOT NULL CHECK(status IN('MATCHED','UNMATCHED','AMBIGUOUS','NO_CONSENT','PREPARED')),
 person_id uuid,media_id uuid,
 postcard_id uuid REFERENCES gallery_postcards(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(album_id,fingerprint),
 FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id),
 FOREIGN KEY(media_id,album_id) REFERENCES gallery_media(id,album_id)
);
CREATE INDEX IF NOT EXISTS gallery_postcard_recipients_album_status ON gallery_postcard_recipients(album_id,status);

CREATE TABLE IF NOT EXISTS gallery_postcard_back_artworks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 version integer NOT NULL CHECK(version>0),
 original_filename varchar(200) NOT NULL,
 mime_type varchar(50) NOT NULL CHECK(mime_type IN('image/jpeg','image/png')),
 width_px integer NOT NULL,height_px integer NOT NULL,
 sha256 char(64) NOT NULL,
 storage_provider varchar(40) NOT NULL,storage_key text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REVOKED')),
 created_by uuid NOT NULL REFERENCES users(id),approved_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,
 UNIQUE(album_id,version),UNIQUE(album_id,id)
);
CREATE INDEX IF NOT EXISTS gallery_postcard_back_artworks_album_idx ON gallery_postcard_back_artworks(album_id,status);
