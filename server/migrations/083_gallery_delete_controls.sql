-- Preserve Dropbox revision receipts when an operator deletes a picture.
-- A subsequent sync skips that revision rather than silently restoring it.
ALTER TABLE gallery_dropbox_imports ALTER COLUMN media_id DROP NOT NULL;
ALTER TABLE gallery_dropbox_imports DROP CONSTRAINT gallery_dropbox_imports_media_id_fkey;
ALTER TABLE gallery_dropbox_imports ADD CONSTRAINT gallery_dropbox_imports_media_id_fkey
 FOREIGN KEY(media_id) REFERENCES gallery_media(id) ON DELETE SET NULL;
