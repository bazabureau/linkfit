-- Up Migration --
--
-- Wave-12: Story overlays + mentions.
--
-- Two additive surfaces grafted onto the existing `stories` table:
--
--   * `stories.overlays` (JSONB)  — Free-form list of non-mention overlays
--                                   (text labels, stickers, location pins).
--                                   The iOS composer encodes its overlay
--                                   structs straight into this array; the
--                                   server treats it as opaque so future
--                                   overlay types land as a wire-only
--                                   change. Mentions are deliberately NOT
--                                   in here — they are normalized into
--                                   `story_mentions` so downstream queries
--                                   ("which of my stories tag user X?",
--                                   "list stories I'm tagged in") can hit a
--                                   real indexed table rather than an
--                                   unindexed jsonb scan.
--
--   * `story_mentions`             — One row per (story, mentioned user).
--                                   `(x, y)` are normalized [0..1] frame
--                                   coordinates the iOS viewer renders as
--                                   a tappable chip. ON DELETE CASCADE on
--                                   both sides so the rows evaporate along
--                                   with the story (24h TTL via the
--                                   `StoriesExpireSweeper`) or when either
--                                   user soft-deletes.
--
-- Push notifications to mentioned users are emitted by the service layer
-- on insert — see `StoriesService.create` for the bidirectional
-- `user_blocks` filter and the `story.mention` push template.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS overlays jsonb NULL;

CREATE TABLE IF NOT EXISTS story_mentions (
  story_id           uuid         NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  mentioned_user_id  uuid         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  x                  real         NOT NULL,
  y                  real         NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, mentioned_user_id)
);

-- Reverse-lookup index for the "stories I'm tagged in" feed. The PK above
-- already covers the forward lookup (story -> mentioned users in the join
-- used by `GET /stories/feed`).
CREATE INDEX IF NOT EXISTS story_mentions_user_idx
  ON story_mentions (mentioned_user_id);

-- Down Migration --
DROP INDEX IF EXISTS story_mentions_user_idx;
DROP TABLE IF EXISTS story_mentions;
ALTER TABLE stories DROP COLUMN IF EXISTS overlays;
