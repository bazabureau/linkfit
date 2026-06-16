-- Up Migration --
--
-- Group chat extension for conversations. We're keeping the 1:1 DM path
-- untouched (it's feature-frozen) and adding the columns + indexes needed for
-- N-participant tournament-squad and game-participant threads.
--
-- Design notes
-- ─────────────
-- * `kind` is an ENUM ('direct','group'). All existing rows are 1:1 DMs so
--   they keep the default 'direct' — the 1:1 service layer never inspects
--   `kind` and stays a no-op-compatible reader.
-- * `title` is set for group threads only ("Squad name", "Game on Friday…").
--   1:1 DMs ignore it.
-- * `game_id` / `tournament_id` are the *origin* link — a group conversation
--   is born from a specific game or tournament-entry/tournament and that
--   FK is what makes the "get-or-create-group-for-game" call idempotent.
-- * UNIQUE partial index on (game_id) WHERE kind='group' AND game_id IS NOT
--   NULL prevents racing the create call from minting two threads for the
--   same game. Tournament gets the same treatment.
-- * Nothing in this migration alters or removes ANY existing message or
--   conversation row — strictly additive.

CREATE TYPE conversation_kind AS ENUM ('direct', 'group');

ALTER TABLE conversations
  ADD COLUMN kind          conversation_kind NOT NULL DEFAULT 'direct',
  ADD COLUMN title         text              NULL,
  ADD COLUMN game_id       uuid              NULL REFERENCES games(id)       ON DELETE SET NULL,
  ADD COLUMN tournament_id uuid              NULL REFERENCES tournaments(id) ON DELETE SET NULL;

-- One group conversation per game.
CREATE UNIQUE INDEX conversations_group_game_uq
  ON conversations (game_id)
  WHERE kind = 'group' AND game_id IS NOT NULL;

-- One group conversation per tournament.
CREATE UNIQUE INDEX conversations_group_tournament_uq
  ON conversations (tournament_id)
  WHERE kind = 'group' AND tournament_id IS NOT NULL;

-- Quick lookup: "all group convs I'm in" — the existing
-- conversation_participants_user_idx already covers the participant join, but
-- a covering index on kind speeds the group-vs-direct filter when we list
-- conversations in the dedicated /group endpoints.
CREATE INDEX conversations_kind_idx
  ON conversations (kind);

-- Down Migration ----------------------------------------------------------
DROP INDEX IF EXISTS conversations_kind_idx;
DROP INDEX IF EXISTS conversations_group_tournament_uq;
DROP INDEX IF EXISTS conversations_group_game_uq;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS tournament_id,
  DROP COLUMN IF EXISTS game_id,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS kind;
DROP TYPE IF EXISTS conversation_kind;
