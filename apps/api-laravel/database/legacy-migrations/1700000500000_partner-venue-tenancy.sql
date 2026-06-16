-- Up Migration --
ALTER TABLE users 
  ADD COLUMN venue_id uuid NULL REFERENCES venues(id) ON DELETE SET NULL;

CREATE INDEX users_venue_id_idx ON users (venue_id) WHERE venue_id IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_admin_role_check;
ALTER TABLE users ADD CONSTRAINT users_admin_role_check CHECK (admin_role IS NULL OR admin_role IN ('admin', 'moderator', 'partner'));

-- Down Migration --
ALTER TABLE users DROP COLUMN IF EXISTS venue_id;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_admin_role_check;
ALTER TABLE users ADD CONSTRAINT users_admin_role_check CHECK (admin_role IS NULL OR admin_role IN ('admin', 'moderator'));
