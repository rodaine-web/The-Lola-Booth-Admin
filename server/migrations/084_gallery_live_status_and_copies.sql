-- Keep recipient deduplication by default; explicit additional photo copies are audited.
ALTER TABLE gallery_live_mailing_jobs ADD COLUMN extra_copy_reason text NOT NULL DEFAULT '' CHECK(extra_copy_reason='' OR char_length(btrim(extra_copy_reason)) BETWEEN 10 AND 2000);
DROP INDEX gallery_live_one_recipient;
CREATE UNIQUE INDEX gallery_live_one_recipient ON gallery_live_mailing_jobs(album_id,recipient_key) WHERE status<>'CANCELLED' AND extra_copy_reason='';
CREATE UNIQUE INDEX gallery_live_one_postcard_revision ON gallery_live_mailing_jobs(postcard_id,revision) WHERE status<>'CANCELLED';
-- Authenticated provider polling supports first-use accounts without inventing a webhook receipt.
ALTER TABLE gallery_live_mailing_batches ADD COLUMN status_channel text NOT NULL DEFAULT 'WEBHOOK' CHECK(status_channel IN('WEBHOOK','POLLING'));
ALTER TABLE gallery_live_mailing_batches ADD COLUMN status_channel_verified_at timestamptz;
