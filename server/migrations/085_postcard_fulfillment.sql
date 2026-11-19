-- Additive postcard workspace, single-photo access and private client reporting.
CREATE TABLE gallery_photo_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES gallery_media(id) ON DELETE CASCADE,
 access_key_id uuid NOT NULL REFERENCES gallery_access_keys(id) ON DELETE CASCADE,
 token_hash char(64) NOT NULL UNIQUE,
 credentials_ciphertext jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(media_id,access_key_id)
);
CREATE TABLE gallery_postcard_exclusions (
 album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
 survey_row_id uuid NOT NULL REFERENCES gallery_fiesta_survey_rows(id) ON DELETE CASCADE,
 fingerprint char(64) NOT NULL,
 reason varchar(2000) NOT NULL CHECK(char_length(btrim(reason))>=10),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(album_id,fingerprint)
);
ALTER TABLE gallery_live_mailing_jobs ADD COLUMN submitted_at timestamptz;
ALTER TABLE gallery_live_mailing_jobs ADD COLUMN scheduled_release_at timestamptz;
ALTER TABLE gallery_live_mailing_jobs ADD COLUMN mailed_at timestamptz;
ALTER TABLE gallery_live_mailing_jobs ADD COLUMN delivered_at timestamptz;
ALTER TABLE gallery_live_mailing_jobs ADD COLUMN expected_delivery_date date;
-- Existing batches are not silently emailed on deployment.
ALTER TABLE gallery_live_mailing_batches ADD COLUMN report_notification_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE gallery_live_mailing_batches ALTER COLUMN report_notification_eligible SET DEFAULT true;
CREATE TABLE gallery_postcard_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
 batch_id uuid REFERENCES gallery_live_mailing_batches(id),
 snapshot_ciphertext jsonb NOT NULL,
 created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gallery_postcard_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL UNIQUE REFERENCES gallery_live_mailing_batches(id),
 report_id uuid REFERENCES gallery_postcard_reports(id),
 recipient_ciphertext jsonb,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENDING','SENT','NEEDS_REVIEW')),
 last_error text,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,sent_at timestamptz
);
