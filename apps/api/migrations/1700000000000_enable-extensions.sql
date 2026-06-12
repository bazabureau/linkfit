-- Up Migration --
-- Foundational Postgres extensions for the Linkfit schema.
-- pgcrypto:     gen_random_uuid() for UUID PKs.
-- citext:       case-insensitive email column.
-- cube,
-- earthdistance: "venues / games within X km" geo queries without pulling PostGIS in yet.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Down Migration --
-- earthdistance depends on cube, so drop in reverse order.
DROP EXTENSION IF EXISTS earthdistance;
DROP EXTENSION IF EXISTS cube;
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
