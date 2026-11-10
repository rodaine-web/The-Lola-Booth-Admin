-- Approved catalogue images for newly prepared proposals/Admin previews.
-- Existing sent documents keep their embedded snapshot imagery.
ALTER TABLE experiences ADD COLUMN image_url text;
