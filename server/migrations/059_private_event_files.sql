-- Existing file rows remain intact. Legacy metadata does not acquire public access.
ALTER TABLE files ADD COLUMN upload_request_id uuid;
ALTER TABLE files ADD COLUMN content_sha256 text CHECK(content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX files_event_upload_request ON files(event_id,upload_request_id) WHERE upload_request_id IS NOT NULL;
