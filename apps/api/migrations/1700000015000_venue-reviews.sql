-- Up Migration --
--
-- Venue reviews. One review per (venue, author) pair — UPSERTs collapse
-- subsequent edits onto the same row. `removed_at` is a soft-delete column
-- so analytics/aggregates can exclude removed rows without losing audit
-- history. The aggregate VIEW `venue_rating_summary` powers the avg/count
-- shown on venue cards and the histogram returned by the rating-summary
-- endpoint.

CREATE TABLE venue_reviews (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  author_user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating          smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body            text        NULL,
  photo_url       text        NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz NULL,
  -- Enforce one review per author per venue. Partial unique index so soft-
  -- deleted rows don't block re-reviewing later (`removed_at IS NULL`).
  UNIQUE (venue_id, author_user_id)
);

CREATE TRIGGER venue_reviews_set_updated_at
  BEFORE UPDATE ON venue_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX venue_reviews_venue_idx
  ON venue_reviews (venue_id, created_at DESC)
  WHERE removed_at IS NULL;

CREATE INDEX venue_reviews_author_idx
  ON venue_reviews (author_user_id)
  WHERE removed_at IS NULL;

-- Aggregate view for venue cards. Excludes soft-deleted rows. Returns a
-- row for every venue that has at least one live review — venues without
-- reviews are LEFT JOINed by the caller and coalesced to (NULL, 0).
CREATE VIEW venue_rating_summary AS
  SELECT
    venue_id,
    ROUND(AVG(rating)::numeric, 2)::numeric(3, 2) AS avg_rating,
    COUNT(*)::int                                  AS review_count
  FROM venue_reviews
  WHERE removed_at IS NULL
  GROUP BY venue_id;

-- Down Migration --
DROP VIEW IF EXISTS venue_rating_summary;
DROP INDEX IF EXISTS venue_reviews_author_idx;
DROP INDEX IF EXISTS venue_reviews_venue_idx;
DROP TRIGGER IF EXISTS venue_reviews_set_updated_at ON venue_reviews;
DROP TABLE IF EXISTS venue_reviews;
