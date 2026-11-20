-- Automatic mailings remain once per batch. Each explicit admin email request
-- has its own idempotency key and history row, including confirmed resends.
ALTER TABLE gallery_postcard_notifications ADD COLUMN request_key uuid;
ALTER TABLE gallery_postcard_notifications ADD COLUMN requested_by uuid REFERENCES users(id);
ALTER TABLE gallery_postcard_notifications DROP CONSTRAINT gallery_postcard_notifications_batch_id_key;
CREATE UNIQUE INDEX gallery_postcard_notifications_automatic_batch
 ON gallery_postcard_notifications(batch_id) WHERE request_key IS NULL;
CREATE UNIQUE INDEX gallery_postcard_notifications_manual_request
 ON gallery_postcard_notifications(request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX gallery_postcard_notifications_active_batch
 ON gallery_postcard_notifications(batch_id) WHERE status IN('PENDING','SENDING');
