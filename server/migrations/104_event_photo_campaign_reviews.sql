CREATE TABLE event_photo_campaign_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE, name text NOT NULL,
 channels jsonb NOT NULL, snapshot jsonb NOT NULL, email_recipients_ciphertext jsonb NOT NULL,
 sms_review_id uuid REFERENCES gallery_notification_reviews(id) ON DELETE SET NULL,
 created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 decision text CHECK(decision IN('APPROVED','CANCELED')),decided_by uuid REFERENCES users(id),decided_at timestamptz
);
CREATE INDEX event_photo_campaign_event ON event_photo_campaign_reviews(event_id,created_at DESC);
