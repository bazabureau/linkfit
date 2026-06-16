-- Up Migration --
--
-- Medical / emergency profile + tournament waiver acknowledgments.
--
-- `medical_profiles` is a 1:1 sidecar to `users` that holds optional health
-- information a host may need if a player gets hurt during a game. Every
-- column is nullable — the user fills in only what they want to share, and
-- the record is created lazily by the service on first PUT.
--
-- All sensitive text fields (allergies / conditions / medications / contact
-- name / contact phone / blood type) are stored as `bytea`. When the env
-- var `MEDICAL_ENCRYPTION_KEY` is configured the medical service writes
-- AES-256-GCM ciphertext (iv || tag || data) into these columns; otherwise
-- it writes the UTF-8 bytes of the plaintext directly and the server emits
-- a one-shot `medical_unencrypted_warning` log on boot. The on-disk shape
-- is identical either way, so flipping encryption on later is a pure
-- ops-side migration (re-encrypt rows in place) — no schema change.
--
-- `share_medical_with_host` is the user-controlled opt-in flag the host
-- summary endpoint consults. It defaults to `false` so a freshly created
-- profile never leaks data — the user must explicitly enable sharing.
--
-- `tournament_waivers` is an append-only acknowledgment ledger. The PK
-- (tournament_id, user_id) makes double-signs idempotent — the route
-- upserts on conflict and the existing row stands. We store `ip` and
-- `user_agent` for evidentiary purposes only.

CREATE TABLE medical_profiles (
  user_id                 uuid         PRIMARY KEY
                                       REFERENCES users(id) ON DELETE CASCADE,
  blood_type              bytea        NULL,
  allergies               bytea        NULL,
  conditions              bytea        NULL,
  medications             bytea        NULL,
  emergency_contact_name  bytea        NULL,
  emergency_contact_phone bytea        NULL,
  share_medical_with_host boolean      NOT NULL DEFAULT false,
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX medical_profiles_share_idx
  ON medical_profiles (share_medical_with_host)
  WHERE share_medical_with_host = true;

CREATE TABLE tournament_waivers (
  tournament_id  uuid         NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id        uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signed_at      timestamptz  NOT NULL DEFAULT now(),
  ip             text         NULL,
  user_agent     text         NULL,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE INDEX tournament_waivers_user_idx
  ON tournament_waivers (user_id, signed_at DESC);

-- Down Migration --

DROP TABLE IF EXISTS tournament_waivers;
DROP TABLE IF EXISTS medical_profiles;
