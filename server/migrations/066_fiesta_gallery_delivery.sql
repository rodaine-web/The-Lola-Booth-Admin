ALTER TABLE gallery_albums ADD COLUMN retention_days integer CHECK(retention_days IN(30,60,90));
CREATE UNIQUE INDEX gallery_people_external_ref_unique ON gallery_people(album_id,external_ref) WHERE external_ref IS NOT NULL;
CREATE TABLE fiesta_gallery_shares (
 album_id uuid NOT NULL REFERENCES gallery_albums(id),
 person_id uuid NOT NULL,
 filename text NOT NULL,
 channel text NOT NULL CHECK(channel IN('EMAIL','SMS')),
 recipient_ciphertext jsonb NOT NULL,
 capture_ref text NOT NULL,
 source_share_time text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(album_id,person_id,filename),
 FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id)
);
