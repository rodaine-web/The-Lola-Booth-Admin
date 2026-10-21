-- Customer access is explicit and defaults to off, including existing uploads.
ALTER TABLE files ADD COLUMN customer_shared_at timestamptz;
ALTER TABLE files ADD COLUMN customer_shared_by uuid REFERENCES users(id);
ALTER TABLE files ADD CONSTRAINT files_customer_share_pair CHECK ((customer_shared_at IS NULL)=(customer_shared_by IS NULL));
CREATE INDEX files_customer_shared_event ON files(event_id,created_at DESC) WHERE customer_shared_at IS NOT NULL AND deleted_at IS NULL;
