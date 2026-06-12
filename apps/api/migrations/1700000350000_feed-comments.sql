-- Up Migration --
-- Feed comments. Threads of short text bodies attached to a feed_events row,
-- powering the "Community" surface on the iOS home feed (Wave-9).
--
-- Design notes:
--   - One row per comment. We keep this flat (no parent_id) on purpose —
--     reply-to-comment threading is out of scope; iOS renders a single
--     newest-first list per card and that's plenty for v1.
--   - CHECK on length(body) is the hard guard. Zod at the route enforces the
--     same bounds for a friendly 400 — the DB constraint is the floor.
--   - The (event_id, created_at DESC) composite covers the keyset paginated
--     read query without an explicit sort.
--   - The (user_id) index supports "comments by user" reads (used by GDPR
--     export and any future profile-comments view) and lets `ON DELETE
--     CASCADE` work efficiently when a user is hard-deleted.

CREATE TABLE feed_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  body        text        NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feed_comments_event_idx ON feed_comments (event_id, created_at DESC);
CREATE INDEX feed_comments_user_idx  ON feed_comments (user_id);

-- Down Migration --
DROP INDEX IF EXISTS feed_comments_user_idx;
DROP INDEX IF EXISTS feed_comments_event_idx;
DROP TABLE IF EXISTS feed_comments;
