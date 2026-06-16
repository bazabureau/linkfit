-- Up Migration --
--
-- Story reactions — Instagram-style emoji reactions on a story. One row per
-- (story_id, user_id) pair, so a user can hold at most one reaction per story.
-- Re-reacting REPLACES the prior emoji (the POST handler does an UPSERT against
-- the composite PK), DELETE removes only the caller's row.
--
-- Supported emojis are constrained to the same five values the iOS reaction
-- bar exposes: heart, fire, 100, clap, padel. The CHECK constraint is the
-- single source of truth — the Zod enum in `stories.schema.ts` mirrors it.
-- Adding a new emoji is a two-line migration (extend the CHECK list) plus a
-- Zod enum bump.
--
-- The `story_reactions_story_idx` covers the aggregate-counts-per-emoji query
-- used by `GET /stories/feed` (grouped by emoji per story_id) so the feed
-- page stays single-round-trip even after the join.

CREATE TABLE IF NOT EXISTS story_reactions (
  story_id    uuid         NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id     uuid         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  emoji       text         NOT NULL CHECK (emoji IN ('heart', 'fire', '100', 'clap', 'padel')),
  created_at  timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS story_reactions_story_idx
  ON story_reactions (story_id);

-- Down Migration --
DROP INDEX IF EXISTS story_reactions_story_idx;
DROP TABLE IF EXISTS story_reactions;
