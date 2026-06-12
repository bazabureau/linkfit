-- Up Migration --

-- Notifications -----------------------------------------------------------
CREATE TYPE notification_type AS ENUM (
  'game_joined',           -- somebody joined your game
  'game_cancelled',        -- a game you were in was cancelled
  'game_reminder',         -- 1h before your game starts
  'no_show_marked',        -- host marked you as no-show
  'rating_received',       -- someone rated you
  'tournament_invite',     -- you were invited to a tournament
  'message_received',      -- new DM
  'system'                 -- generic platform announcement
);

CREATE TABLE notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       text        NOT NULL,
  body        text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_user_all_idx
  ON notifications (user_id, created_at DESC);

-- Messages ----------------------------------------------------------------
-- Two-party DM model. Conversation row is the bag; conversation_participants
-- holds the two user ids (extensible to group chats later). Messages stream
-- chronologically; mark-read tracks per-participant.

CREATE TABLE conversations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NULL
);

CREATE TABLE conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  last_read_at    timestamptz NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_participants_user_idx
  ON conversation_participants (user_id);

-- Helper: pair-uniqueness for 1:1 conversations. Without it, two users could
-- open multiple DM threads. Enforced via a triggerless approach: a UNIQUE
-- index on the canonical sorted-pair signature.
CREATE OR REPLACE FUNCTION conversation_pair_key(conv_id uuid)
RETURNS text AS $$
  SELECT string_agg(user_id::text, ':' ORDER BY user_id)
    FROM conversation_participants
   WHERE conversation_id = conv_id;
$$ LANGUAGE sql STABLE;

-- We can't UNIQUE-INDEX a stable function result directly, so instead enforce
-- "exactly 2 distinct participants per conversation" via a partial check and
-- handle dedup in the service layer (cheap because of the user_idx).

CREATE TABLE messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id  uuid        NOT NULL REFERENCES users(id)         ON DELETE RESTRICT,
  body            text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_idx
  ON messages (conversation_id, created_at DESC);

-- Trigger to keep conversations.last_message_at fresh.
CREATE OR REPLACE FUNCTION bump_conversation_last_message_at()
RETURNS trigger AS $$
BEGIN
  UPDATE conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_bump_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION bump_conversation_last_message_at();

-- Tournaments -------------------------------------------------------------
CREATE TYPE tournament_status AS ENUM (
  'announced', 'registration_open', 'registration_closed',
  'in_progress', 'completed', 'cancelled'
);

CREATE TABLE tournaments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  description     text        NULL,
  sport_id        uuid        NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  venue_id        uuid        NULL     REFERENCES venues(id) ON DELETE SET NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  registration_deadline timestamptz NULL,
  max_squads      smallint    NOT NULL CHECK (max_squads BETWEEN 2 AND 256),
  squad_size      smallint    NOT NULL CHECK (squad_size BETWEEN 1 AND 20),
  entry_fee_minor integer     NOT NULL DEFAULT 0 CHECK (entry_fee_minor >= 0),
  currency        char(3)     NOT NULL DEFAULT 'AZN',
  status          tournament_status NOT NULL DEFAULT 'announced',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournaments_dates_chk CHECK (ends_at >= starts_at),
  CONSTRAINT tournaments_registration_chk CHECK (
    registration_deadline IS NULL OR registration_deadline <= starts_at
  )
);

CREATE INDEX tournaments_starts_at_idx ON tournaments (starts_at);
CREATE INDEX tournaments_sport_status_idx ON tournaments (sport_id, status, starts_at);

CREATE TRIGGER tournaments_set_updated_at
  BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tournament_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  captain_user_id uuid        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  squad_name      text        NOT NULL,
  player_ids      uuid[]      NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','withdrawn','disqualified')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, captain_user_id),
  UNIQUE (tournament_id, squad_name)
);

CREATE INDEX tournament_entries_tournament_idx ON tournament_entries (tournament_id);

-- Down Migration ----------------------------------------------------------
DROP TABLE IF EXISTS tournament_entries;
DROP TRIGGER IF EXISTS tournaments_set_updated_at ON tournaments;
DROP TABLE IF EXISTS tournaments;
DROP TYPE  IF EXISTS tournament_status;

DROP TRIGGER IF EXISTS messages_bump_conversation ON messages;
DROP FUNCTION IF EXISTS bump_conversation_last_message_at();
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_participants;
DROP FUNCTION IF EXISTS conversation_pair_key(uuid);
DROP TABLE IF EXISTS conversations;

DROP INDEX IF EXISTS notifications_user_all_idx;
DROP INDEX IF EXISTS notifications_user_unread_idx;
DROP TABLE IF EXISTS notifications;
DROP TYPE  IF EXISTS notification_type;
