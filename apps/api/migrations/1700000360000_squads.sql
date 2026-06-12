-- Up Migration --
--
-- Squads: the persistent doubles foursome for padel.
--
-- Padel is fundamentally a 2-vs-2 sport. The product reality is that most
-- players settle into a small rotating group (the "squad") that books
-- courts together week after week. Modeling that community unit as a
-- first-class object is the foundation for everything downstream — group
-- chat, recurring bookings, automatic team formation for tournaments,
-- shared availability surfaces.
--
-- Two tables:
--
--   * squads          — the squad row. `owner_id` is the captain/admin.
--                       `max_size` defaults to 8 (covers a doubles rotation
--                       comfortably) but can grow to 16 for a more open
--                       community. `2` is the lower bound: a squad of one
--                       is just a person.
--
--   * squad_members   — composite PK (squad_id, user_id). Role separates
--                       the owner (one per squad) from regular members.
--                       Status separates `pending` invites from `active`
--                       memberships — the invitee flips themselves to
--                       active by accepting.
--
-- Invariants enforced in application code (not DB):
--   * Exactly one owner per squad. The CASCADE on owner deletion would
--     orphan the row; the squads service transfers ownership on owner-
--     leave before issuing any delete.
--   * Active membership count cannot exceed `max_size` — checked in the
--     service inside the same transaction as the insert.
--   * `user_blocks` is consulted before issuing any invite so blocked
--     users can't end up in the same squad. Bidirectional check.
--
-- Indexes:
--   * `squad_members_user_idx` makes the "squads I'm in" query (the most
--     hit read on this surface) a single index hit.
--   * The composite PK on squad_members already covers (squad_id, *).

CREATE TABLE IF NOT EXISTS squads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 50),
  description TEXT,
  photo_url   TEXT,
  max_size    INT NOT NULL DEFAULT 8 CHECK (max_size BETWEEN 2 AND 16),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS squad_members (
  squad_id  UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner','member')),
  status    TEXT NOT NULL CHECK (status IN ('pending','active')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (squad_id, user_id)
);

-- Hot path: "what squads is this user a member of?" → /api/v1/squads/me.
-- Filtered to active by the WHERE in the service; the composite covers both.
CREATE INDEX IF NOT EXISTS squad_members_user_idx
  ON squad_members (user_id, status);

-- Down Migration --
DROP INDEX IF EXISTS squad_members_user_idx;
DROP TABLE IF EXISTS squad_members;
DROP TABLE IF EXISTS squads;
