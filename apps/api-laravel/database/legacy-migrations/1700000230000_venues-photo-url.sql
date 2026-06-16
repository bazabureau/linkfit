-- Up Migration --
--
-- Add a `photo_url` column to `venues` so the admin can attach a hero image
-- to each venue. Stored as a plain text URL — uploads go through the
-- existing `/api/v1/messages/upload-image` endpoint, which writes the file
-- to disk and returns an absolute URL we persist here.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS photo_url text NULL;

-- Down Migration --
ALTER TABLE venues DROP COLUMN IF EXISTS photo_url;
