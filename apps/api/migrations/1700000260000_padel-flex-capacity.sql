-- Loosen padel's player-count bounds so hosts can create non-standard
-- games (singles, rotation, with substitutes).
--
-- Original seed had min=4, max=4 — the rigid official doubles format.
-- That was correct for "what an official padel match looks like" but
-- wrong for what casual players actually want to host:
--
--   - 2 players: singles friendly
--   - 3 players: looking for the 4th
--   - 4 players: standard doubles (default)
--   - 5 players: doubles + 1 substitute
--   - 6 players: rotation game / kings & queens
--
-- The iOS create-game flow honours these bounds via the capacity
-- stepper. min==max produced a frozen stepper, so users reported
-- "squad size can't be changed" — exactly the bug we're fixing here.
--
-- 4 remains the default because that's still the most common case;
-- only the *bounds* change.

UPDATE sports
SET min_players = 2, max_players = 6
WHERE slug = 'padel';
