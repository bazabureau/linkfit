-- Up Migration --
--
-- Instagram-style ephemeral stories. Two tables:
--
--   * stories       — 24-hour ephemeral posts (image / video) authored by a
--                     user. Surfaces as round avatars on top of the iOS
--                     home page, mirroring the IG / WhatsApp idiom. Court
--                     photos, match wins, group chat clips.
--
--   * story_views   — Per-viewer view ledger. Composite PK on
--                     (story_id, viewer_user_id) so re-views are no-ops
--                     via INSERT ... ON CONFLICT DO NOTHING — keeping
--                     `view_count` truthful (unique viewers, not impressions).
--
-- The 24-hour TTL is enforced by the out-of-band `StoriesExpireSweeper`,
-- which DELETEs rows where `expires_at < now()` every 30 minutes and
-- unlinks the on-disk media file. The partial index below keeps the feed
-- query fast against the live set: only active stories index a row.

CREATE TABLE IF NOT EXISTS stories (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url     text         NOT NULL,
  media_type    text         NOT NULL CHECK (media_type IN ('image', 'video')),
  caption       text         NULL,
  created_at    timestamptz  NOT NULL DEFAULT NOW(),
  expires_at    timestamptz  NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  view_count    integer      NOT NULL DEFAULT 0
);

-- Composite index over (user_id, expires_at, created_at) — Postgres requires
-- partial-index predicates to use only IMMUTABLE functions, and `NOW()` is
-- STABLE, so we can't write a `WHERE expires_at > NOW()` partial. A full
-- composite covers the feed query: the planner uses the (user_id, expires_at)
-- prefix to filter live rows then walks the created_at DESC component for
-- the LIMIT scan. Trade-off: slightly larger index, but writes never need
-- the row-eviction logic a partial would impose.
CREATE INDEX IF NOT EXISTS stories_active_idx
  ON stories (user_id, expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS story_views (
  story_id       uuid         NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_user_id uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at      timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, viewer_user_id)
);

-- Down Migration --
DROP TABLE IF EXISTS story_views;
DROP INDEX IF EXISTS stories_active_idx;
DROP TABLE IF EXISTS stories;
