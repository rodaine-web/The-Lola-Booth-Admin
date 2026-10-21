-- Read-only event-folder ingestion. Existing galleries and publication are unchanged.
CREATE TABLE gallery_dropbox_sources (
 album_id uuid PRIMARY KEY REFERENCES gallery_albums(id),
 account_id text NOT NULL, folder_id text NOT NULL, folder_path text NOT NULL,
 enabled boolean NOT NULL DEFAULT false, cursor_ciphertext jsonb,
 created_by uuid NOT NULL REFERENCES users(id),
 lease_token uuid, lease_until timestamptz, next_sync_at timestamptz NOT NULL DEFAULT now(),
 last_sync_at timestamptz, last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,folder_id)
);
CREATE TABLE gallery_dropbox_imports (
 album_id uuid NOT NULL REFERENCES gallery_dropbox_sources(album_id),
 file_id text NOT NULL, revision text NOT NULL, content_hash text NOT NULL,
 media_id uuid NOT NULL REFERENCES gallery_media(id), imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(album_id,file_id,revision)
);
CREATE INDEX gallery_dropbox_sources_due ON gallery_dropbox_sources(next_sync_at) WHERE enabled;

INSERT INTO integration_connections(category,provider,status) VALUES('STORAGE','DROPBOX_GALLERY','DISCONNECTED') ON CONFLICT(category,provider) DO NOTHING;
