-- Up Migration --
-- Feed-event likes. One row per (user, feed_event) pair — the composite PK
-- enforces idempotency at the DB level, so a double-tap on the iOS heart
-- button is a no-op rather than two rows. We keep this as its own table
-- (vs. embedding a counter on feed_events) because:
--   - Likers may appear in a "who liked this" view later, which needs
--     row-level identity.
--   - The denormalized count is trivially aggregatable on read with a
--     COUNT(*) + GROUP BY when serving the feed.
--   - feed_events is otherwise treated as append-only by the fan-out
--     worker; tacking a mutable counter onto it would complicate
--     watermark logic.

CREATE TABLE feed_event_reactions (
  feed_event_id  uuid          NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
  user_id        uuid          NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_event_id, user_id)
);

-- Reverse-lookup: "list the events I've liked, newest first". Used by the
-- iOS profile screen and by potential future activity surfaces.
CREATE INDEX feed_event_reactions_user_idx
  ON feed_event_reactions (user_id, created_at DESC);

-- Per-event lookup for the "who liked this" view. The PK already covers
-- (feed_event_id, user_id) so we don't need a second index for COUNT(*)
-- aggregates — Postgres uses the leading column of the PK efficiently.

-- Down Migration --
DROP INDEX IF EXISTS feed_event_reactions_user_idx;
DROP TABLE IF EXISTS feed_event_reactions;
