-- Nullable overrides inherit the album's personal-download defaults.
ALTER TABLE gallery_people ADD COLUMN allow_download boolean;
ALTER TABLE gallery_people ADD COLUMN allow_zip boolean;
