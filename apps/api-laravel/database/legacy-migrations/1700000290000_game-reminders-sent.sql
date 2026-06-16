-- Up Migration --
--
-- Idempotency ledger for the games-reminder sweeper.
--
-- The sweeper polls every few minutes for games starting in ~2 hours and
-- fires a "Your game starts in 2 hours" notification to each confirmed
-- participant. Two tick windows can overlap the same game (e.g. a game at
-- t+118min is in range at the 09:00 AND 09:05 sweep), so we need an
-- exactly-once guard. We get it by INSERTing into this table first with
-- `ON CONFLICT (game_id, user_id) DO NOTHING RETURNING *` — only the rows
-- the INSERT actually created come back, and only those trigger an
-- `emit()`. After a restart the existing rows still block re-sends.
--
-- FK ON DELETE CASCADE on both columns means: a cancelled game or a
-- deleted user wipes their reminder rows for free, so we never carry
-- dangling history.

CREATE TABLE game_reminders_sent (
  game_id  uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

-- Down Migration --

DROP TABLE IF EXISTS game_reminders_sent;
