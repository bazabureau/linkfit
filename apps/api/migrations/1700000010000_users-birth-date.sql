-- Up Migration --
-- Add an optional date of birth captured during registration.

ALTER TABLE users
  ADD COLUMN birth_date date NULL
    CHECK (birth_date IS NULL OR (birth_date >= '1900-01-01' AND birth_date <= CURRENT_DATE));

-- Down Migration --
ALTER TABLE users DROP COLUMN IF EXISTS birth_date;
