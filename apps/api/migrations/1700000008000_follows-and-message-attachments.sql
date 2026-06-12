-- Up Migration --

-- Follows -----------------------------------------------------------------
-- Asymmetric (no reciprocity required). A user can follow many; many can
-- follow them. Self-follow is forbidden via CHECK constraint.
CREATE TABLE follows (
  follower_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, followed_user_id),
  CONSTRAINT follows_no_self CHECK (follower_user_id <> followed_user_id)
);
CREATE INDEX follows_followed_idx ON follows (followed_user_id, created_at DESC);
CREATE INDEX follows_follower_idx ON follows (follower_user_id, created_at DESC);

-- Message attachments -----------------------------------------------------
-- A message can carry one image attachment. Storing the URL means we can
-- later swap the underlying storage (S3, CDN, etc.) without schema changes.
ALTER TABLE messages
  ADD COLUMN attachment_url  text  NULL,
  ADD COLUMN attachment_type text  NULL  CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'voice')),
  ADD COLUMN attachment_meta jsonb NULL,
  -- Either text body OR attachment must be present.
  ADD CONSTRAINT messages_has_content_chk
    CHECK (char_length(body) > 0 OR attachment_url IS NOT NULL);

-- Down Migration ----------------------------------------------------------
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_has_content_chk,
  DROP COLUMN IF EXISTS attachment_meta,
  DROP COLUMN IF EXISTS attachment_type,
  DROP COLUMN IF EXISTS attachment_url;

DROP INDEX IF EXISTS follows_follower_idx;
DROP INDEX IF EXISTS follows_followed_idx;
DROP TABLE IF EXISTS follows;
