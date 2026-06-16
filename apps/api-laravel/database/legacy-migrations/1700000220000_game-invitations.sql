-- Up Migration --

-- Game invitations -------------------------------------------------------
-- Lets a host invite a specific player to a game. The invitee sees a
-- pending row, can accept (joining via GamesService.tryJoin) or decline.
-- A pending invite for the same (game, invitee) cannot be created twice;
-- the partial UNIQUE index below allows re-inviting only after the prior
-- invite has been declined/expired/accepted (i.e. is no longer pending).

CREATE TYPE game_invitation_status AS ENUM (
  'pending',
  'accepted',
  'declined',
  'expired'
);

CREATE TABLE game_invitations (
  id               uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          uuid                    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  inviter_user_id  uuid                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id  uuid                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           game_invitation_status  NOT NULL DEFAULT 'pending',
  created_at       timestamptz             NOT NULL DEFAULT now(),
  responded_at     timestamptz             NULL,

  -- An invitee can't be themselves the inviter.
  CONSTRAINT game_invitations_distinct_parties CHECK (inviter_user_id <> invitee_user_id)
);

-- Only one PENDING invite per (game, invitee). Declined/expired/accepted
-- rows stay as history; re-invites become possible after the prior
-- decision is recorded.
CREATE UNIQUE INDEX game_invitations_pending_uq
  ON game_invitations (game_id, invitee_user_id)
  WHERE status = 'pending';

-- Lookup "my pending invites" — by invitee, ordered by recency.
CREATE INDEX game_invitations_invitee_pending_idx
  ON game_invitations (invitee_user_id, created_at DESC)
  WHERE status = 'pending';

-- Used by the expire-sweep cron to find pendings whose game already started.
CREATE INDEX game_invitations_game_pending_idx
  ON game_invitations (game_id)
  WHERE status = 'pending';

-- Down Migration ----------------------------------------------------------
DROP INDEX IF EXISTS game_invitations_game_pending_idx;
DROP INDEX IF EXISTS game_invitations_invitee_pending_idx;
DROP INDEX IF EXISTS game_invitations_pending_uq;
DROP TABLE IF EXISTS game_invitations;
DROP TYPE  IF EXISTS game_invitation_status;
