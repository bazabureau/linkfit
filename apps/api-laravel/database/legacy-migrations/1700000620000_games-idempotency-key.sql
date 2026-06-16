-- Up Migration --
-- Client-supplied idempotency key for game creation. The iOS client mints a
-- UUID per create attempt and reuses it on retry (network blip, app
-- backgrounded mid-request) so a double-tap or a retried POST can never mint
-- two identical games. Mirrors the `bookings.idempotency_key` pattern, but
-- nullable — existing clients that don't send a key keep working unchanged.
ALTER TABLE games ADD COLUMN idempotency_key uuid NULL;

-- Scoped per host: two different users may coincidentally reuse a key
-- without colliding, while a retry from the same host is squashed. Partial
-- index keeps the legacy NULL rows (and clients that omit the key) free.
CREATE UNIQUE INDEX games_host_idempotency_key_uidx
  ON games (host_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Down Migration --
DROP INDEX IF EXISTS games_host_idempotency_key_uidx;
ALTER TABLE games DROP COLUMN IF EXISTS idempotency_key;
