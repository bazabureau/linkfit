-- Up Migration --
-- Activity feed events — a stripped-down "Strava for padel" timeline.
--
-- Design notes:
--   - `feed_events` is a denormalized append-only log. Each row is one event
--     ("X joined a game", "Y won a match", etc.). We keep the actor user id
--     and a free-form jsonb payload because the renderer is iOS — the server
--     never has to project the row back into a strongly-typed shape.
--   - Visibility is intentionally tri-state: `public` shows everywhere,
--     `followers` is the default (only people who follow the actor see it),
--     `private` is invisible to everyone except the actor themselves (useful
--     for diagnostics/back-pressure tests, kept as an enum value so we never
--     have to migrate later).
--   - The fan-out is pull-based: a small worker (see `feed.worker.ts`)
--     polls a watermark over `game_participants`, `ratings`, `tournament_entries`,
--     and `follows` once per minute and inserts feed events. We persist the
--     last-processed timestamp in `feed_cursor` so a restart resumes cleanly.
--   - Primary read query: "give me the latest N events from people I follow,
--     plus my own". The composite index on (actor_user_id, created_at DESC)
--     keeps that lookup index-only.

CREATE TYPE feed_event_type AS ENUM (
  'joined_game',
  'won_match',
  'registered_tournament',
  'elo_milestone',
  'followed_user',
  'new_partnership'
);

CREATE TYPE feed_visibility AS ENUM ('public', 'followers', 'private');

CREATE TABLE feed_events (
  id            uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          feed_event_type   NOT NULL,
  payload       jsonb             NOT NULL DEFAULT '{}'::jsonb,
  visibility    feed_visibility   NOT NULL DEFAULT 'followers',
  created_at    timestamptz       NOT NULL DEFAULT now()
);

-- Per-actor newest-first lookup — used both by the fan-out (to compute the
-- "latest event per actor" guard) and by the read endpoint when the caller
-- wants their own timeline. We index DESC so the planner can do a backward
-- scan and avoid an explicit sort.
CREATE INDEX feed_events_actor_created_idx
  ON feed_events (actor_user_id, created_at DESC);

-- Global timeline scan support — when filtering by visibility we want a
-- partial index that only covers the rows we actually serve. A bare
-- `created_at DESC` index would balloon with private/diagnostic rows.
CREATE INDEX feed_events_visible_created_idx
  ON feed_events (created_at DESC)
  WHERE visibility IN ('public', 'followers');

-- Idempotency guard for the fan-out worker: ("did I already create a
-- feed_event for this source row?"). We encode the source row's natural key
-- inside the payload jsonb (e.g. `payload->>'source_key' = 'rating:<id>'`)
-- and use a partial unique index keyed by (actor, type, source_key) to
-- short-circuit duplicates across worker restarts.
CREATE UNIQUE INDEX feed_events_dedupe_idx
  ON feed_events (actor_user_id, type, (payload->>'source_key'))
  WHERE payload ? 'source_key';

-- Single-row table that holds the worker's high-water mark per source.
-- Modeled as a key/value pair so adding new sources later doesn't require
-- a schema change. The worker writes one row per source ("games_join",
-- "ratings_processed", etc.) and reads it back to skip already-processed
-- input rows.
CREATE TABLE feed_cursor (
  source     text        PRIMARY KEY,
  watermark  timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration --
DROP TABLE IF EXISTS feed_cursor;
DROP INDEX IF EXISTS feed_events_dedupe_idx;
DROP INDEX IF EXISTS feed_events_visible_created_idx;
DROP INDEX IF EXISTS feed_events_actor_created_idx;
DROP TABLE IF EXISTS feed_events;
DROP TYPE  IF EXISTS feed_visibility;
DROP TYPE  IF EXISTS feed_event_type;
