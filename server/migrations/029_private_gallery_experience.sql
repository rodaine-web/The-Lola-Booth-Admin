-- Private customer galleries are separate from public website portfolio images.
CREATE TABLE gallery_albums (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL UNIQUE REFERENCES events(id),
 title text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PROCESSING','READY','PUBLISHED','DELIVERED','EXPIRED','ARCHIVED')),
 cover_media_id uuid, published_at timestamptz, expires_at timestamptz,
 allow_download boolean NOT NULL DEFAULT true, allow_zip boolean NOT NULL DEFAULT true,
 allow_personal_download boolean NOT NULL DEFAULT true, allow_personal_zip boolean NOT NULL DEFAULT true,
 source_provider text, external_event_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_provider,external_event_id)
);
CREATE TABLE gallery_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES gallery_albums(id),
 storage_provider text NOT NULL, storage_key text NOT NULL UNIQUE, filename text NOT NULL, mime_type text NOT NULL,
 media_type text NOT NULL DEFAULT 'IMAGE' CHECK(media_type IN('IMAGE','VIDEO')), size_bytes bigint NOT NULL CHECK(size_bytes>0),
 checksum text NOT NULL, width integer, height integer, captured_at timestamptz,
 status text NOT NULL DEFAULT 'VISIBLE' CHECK(status IN('VISIBLE','HIDDEN','ARCHIVED')), sort_order integer NOT NULL DEFAULT 0,
 source_provider text NOT NULL DEFAULT 'MANUAL', external_capture_id text, ingested_at timestamptz NOT NULL DEFAULT now(), source_metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,album_id), UNIQUE(album_id,source_provider,external_capture_id)
);
ALTER TABLE gallery_albums ADD CONSTRAINT gallery_cover_same_album FOREIGN KEY(cover_media_id,id) REFERENCES gallery_media(id,album_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE gallery_people (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES gallery_albums(id), display_name text NOT NULL,
 external_ref text, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ARCHIVED')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,album_id)
);
CREATE TABLE gallery_media_people (
 album_id uuid NOT NULL REFERENCES gallery_albums(id), media_id uuid NOT NULL, person_id uuid NOT NULL,
 assignment_source text NOT NULL DEFAULT 'MANUAL' CHECK(assignment_source IN('MANUAL','CAPTURE_SESSION','FACE_MATCH')),
 confidence numeric CHECK(confidence BETWEEN 0 AND 1), confirmed_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(media_id,person_id), FOREIGN KEY(media_id,album_id) REFERENCES gallery_media(id,album_id), FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id)
);
CREATE TABLE gallery_access_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES gallery_albums(id), person_id uuid,
 type text NOT NULL CHECK(type IN('ALBUM','PERSON')), code_hash text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
 encrypted_credentials text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','EXPIRED','REVOKED')),
 expires_at timestamptz, last_used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 CHECK((type='ALBUM' AND person_id IS NULL) OR(type='PERSON' AND person_id IS NOT NULL)),
 FOREIGN KEY(person_id,album_id) REFERENCES gallery_people(id,album_id), UNIQUE(id,album_id)
);
CREATE TABLE gallery_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid REFERENCES gallery_albums(id), access_key_id uuid, media_id uuid,
 action text NOT NULL CHECK(action IN('ALBUM_OPENED','PERSONAL_OPENED','PHOTO_VIEWED','PHOTO_DOWNLOADED','ZIP_DOWNLOADED','LINK_EXPIRED','ACCESS_DENIED','PUBLISHED','DELIVERED','REVOKED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gallery_activity_album_date ON gallery_activity(album_id,created_at);
CREATE INDEX gallery_media_album_sort ON gallery_media(album_id,status,sort_order);
CREATE TABLE gallery_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_provider text NOT NULL, external_event_id text NOT NULL,
 external_capture_id text NOT NULL, storage_provider text NOT NULL, storage_key text NOT NULL UNIQUE,
 filename text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL, checksum text NOT NULL,
 source_metadata jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'UNMATCHED' CHECK(status IN('UNMATCHED','MATCHED','IGNORED')),
 album_id uuid REFERENCES gallery_albums(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_provider,external_event_id,external_capture_id)
);
ALTER TABLE proposals ADD COLUMN visual_sections jsonb NOT NULL DEFAULT '[]';
