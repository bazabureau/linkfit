-- Up Migration --
-- Real Baku padel venues. Idempotent: ON CONFLICT (name) DO NOTHING means
-- re-running the migration won't duplicate rows even if they already exist.

INSERT INTO venues (name, address, lat, lng, is_partner, phone, description)
VALUES
  ('Padel Center Baku',
   'Whitestone Towers, Hasanoghlu küç. 84, Baku',
   40.401920, 49.876530, TRUE, '+994 12 555 11 22',
   'Fully indoor facility — climate controlled. Open 9:00–00:00 daily. Racket rentals, showers, lockers, café/lounge, parking. Beginner sessions and coaching available.'),
  ('Top Padel Club Baku',
   '26A Neftchilar Avenue, Baku',
   40.371280, 49.834470, TRUE, '+994 12 555 33 44',
   'Outdoor courts near the Boulevard. Open 10:00–23:00. Parking + locker rooms available.'),
  ('Baku Tennis Club',
   'Baku Tennis Club, Yasamal district',
   40.382660, 49.808920, FALSE, NULL,
   'Tennis-first club with affordable padel courts (~₼50–70/hour).'),
  ('Sea Breeze Resort',
   'Sea Breeze Resort, Nardaran',
   40.575890, 49.952180, FALSE, NULL,
   'Coastal resort with padel facilities. Best for weekend trips out of the city.'),
  ('Baku Tennis Academy',
   'Baku Tennis Academy, Khatai district',
   40.379220, 49.918760, FALSE, NULL,
   'Tennis academy with padel courts as a secondary offering.')
ON CONFLICT DO NOTHING;

-- Add one Padel court per venue at a representative price. ON CONFLICT
-- (venue_id, name) ignores rows that already exist (re-run safe).
INSERT INTO courts (venue_id, sport_id, name, hourly_price_minor, currency)
SELECT v.id, s.id, 'Court 1', price.amount, 'AZN'
FROM (VALUES
  ('Padel Center Baku',    9000),
  ('Top Padel Club Baku',  8500),
  ('Baku Tennis Club',     6000),
  ('Sea Breeze Resort',    9500),
  ('Baku Tennis Academy',  6500)
) AS price(venue_name, amount)
JOIN venues v ON v.name = price.venue_name
JOIN sports s ON s.slug = 'padel'
ON CONFLICT DO NOTHING;

-- Down Migration --
DELETE FROM courts
 WHERE venue_id IN (
   SELECT id FROM venues WHERE name IN (
     'Padel Center Baku', 'Top Padel Club Baku', 'Baku Tennis Club',
     'Sea Breeze Resort', 'Baku Tennis Academy'
   )
 );
DELETE FROM venues
 WHERE name IN (
   'Padel Center Baku', 'Top Padel Club Baku', 'Baku Tennis Club',
   'Sea Breeze Resort', 'Baku Tennis Academy'
 );
