-- Up Migration --
--
-- Announcements (Wave-10). Admin-curated, time-windowed broadcasts the iOS
-- client surfaces as a slim dismissible banner at the very top of HomeView.
--
-- Two tables:
--
--   * announcements              — the curated copy. AZ/EN/RU title + body +
--                                  CTA label (all three locales required for
--                                  title; the rest are optional). `cta_url`
--                                  is either a `linkfit://` custom-scheme
--                                  deep-link or an external `https://` URL
--                                  the client routes through the existing
--                                  URLDeepLinkRouter. `starts_at`/`ends_at`
--                                  define the active window; rows outside
--                                  the window are filtered server-side.
--                                  `audience` lets ops scope a broadcast to
--                                  a single locale ('az'/'en'/'ru'); 'all'
--                                  reaches everyone. `priority` (smaller =
--                                  higher priority) breaks ties when several
--                                  rows are active simultaneously — only the
--                                  top-priority one is returned per request.
--
--   * user_dismissed_announcements — per-user dismissal ledger so a banner
--                                    the user closed never re-shows. Composite
--                                    PK on (user_id, announcement_id) so
--                                    DELETE on either parent cascades and the
--                                    POST dismiss is naturally idempotent.

CREATE TABLE IF NOT EXISTS announcements (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title_az            text         NOT NULL,
  title_en            text         NOT NULL,
  title_ru            text         NOT NULL,
  body_az             text         NULL,
  body_en             text         NULL,
  body_ru             text         NULL,
  cta_label_az        text         NULL,
  cta_label_en        text         NULL,
  cta_label_ru        text         NULL,
  cta_url             text         NULL,
  starts_at           timestamptz  NOT NULL DEFAULT NOW(),
  ends_at             timestamptz  NULL,
  audience            text         NOT NULL DEFAULT 'all'
                                   CHECK (audience IN ('all','az','en','ru')),
  priority            integer      NOT NULL DEFAULT 100,
  created_at          timestamptz  NOT NULL DEFAULT NOW(),
  created_by_user_id  uuid         NULL REFERENCES users(id) ON DELETE SET NULL
);

-- Composite index over (priority, ends_at, starts_at) — Postgres rejects
-- partial-index predicates that call `NOW()` (STABLE, not IMMUTABLE), so we
-- index the full table and let the planner filter on `ends_at IS NULL OR
-- ends_at > NOW()` at query time. With <100 active announcements ever, the
-- planner cost difference vs a partial is negligible.
CREATE INDEX IF NOT EXISTS announcements_active_idx
  ON announcements (priority ASC, ends_at, starts_at DESC);

CREATE TABLE IF NOT EXISTS user_dismissed_announcements (
  user_id          uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcement_id  uuid         NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  dismissed_at     timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, announcement_id)
);

-- Lookup index for the "what has this user dismissed?" anti-join used by the
-- GET fetch. The PK already covers (user_id, announcement_id) in that order,
-- so a separate index isn't needed — Postgres uses the PK btree directly.

-- Down Migration --
DROP TABLE IF EXISTS user_dismissed_announcements;
DROP INDEX IF EXISTS announcements_active_idx;
DROP TABLE IF EXISTS announcements;
