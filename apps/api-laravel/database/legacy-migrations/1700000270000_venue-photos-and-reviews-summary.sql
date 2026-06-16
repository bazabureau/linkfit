-- Court photos + venue rating summary.
--
-- BEFORE this migration `venues.photo_url` was a single nullable
-- column. The product needs multiple photos per venue (hero +
-- carousel) so the iOS VenueDetail screen can render a proper image
-- gallery — and the existing review system needed an aggregated
-- summary column so the listing surface can show a star without
-- doing N+1 review-table aggregations per row.
--
-- We keep the legacy single column populated as the "cover" for
-- backwards compat (anything that still reads `photo_url` will see
-- `photo_urls[0]` via the trigger below).

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3, 2);

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;

-- Trigger: keep `photo_url` in sync with the first element of
-- `photo_urls` so callers that haven't migrated still get the cover.
CREATE OR REPLACE FUNCTION venues_sync_photo_url()
RETURNS TRIGGER AS $$
BEGIN
  NEW.photo_url := CASE
    WHEN COALESCE(array_length(NEW.photo_urls, 1), 0) > 0
      THEN NEW.photo_urls[1]
    ELSE NULL
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS venues_sync_photo_url_trigger ON venues;
CREATE TRIGGER venues_sync_photo_url_trigger
BEFORE INSERT OR UPDATE OF photo_urls ON venues
FOR EACH ROW
EXECUTE FUNCTION venues_sync_photo_url();

-- Backfill: if any venue had a single `photo_url` set previously,
-- migrate it into the array so the existing one-cover seed shows up
-- in the carousel after this migration runs.
UPDATE venues
SET photo_urls = ARRAY[photo_url]
WHERE photo_url IS NOT NULL
  AND COALESCE(array_length(photo_urls, 1), 0) = 0;

-- Seed a few representative photos for the two demo venues so the
-- iOS app has something to render until real owners upload theirs.
-- Unsplash CC-licensed padel imagery; the public app downloads via
-- CachedAsyncImage so deploy-time bandwidth is bounded.
UPDATE venues
SET photo_urls = ARRAY[
  'https://images.unsplash.com/photo-1652688623807-12acdf7feaba?w=1200',
  'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=1200',
  'https://images.unsplash.com/photo-1531315396756-905d68d21b56?w=1200'
]
WHERE name ILIKE '%Padel Center Baku%';

UPDATE venues
SET photo_urls = ARRAY[
  'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1200',
  'https://images.unsplash.com/photo-1573497019418-b400bb3ab074?w=1200'
]
WHERE name ILIKE '%Sea Breeze%';
