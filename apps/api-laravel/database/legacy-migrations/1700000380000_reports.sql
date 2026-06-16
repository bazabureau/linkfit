-- Up Migration --
-- Reports module (Wave-10): expand `report_target_kind` so user-submitted
-- complaints can target the two surfaces that landed in W9 — stories and
-- feed_comments. Previously the enum was {user, game, message}, which was
-- enough for v1 (profile, game-detail, chat) but App Store review and the
-- broader UGC surface require an explicit path to report a Story you saw
-- and a Comment that crosses the line. Locked iOS contract uses the
-- symbols `story` and `feed_comment`.
--
-- Why a separate migration rather than editing 1700000009000:
--   - 1700000009000 has already run in production. node-pg-migrate is
--     forward-only. The only safe path is ALTER TYPE ... ADD VALUE on top.
--   - ADD VALUE is fast (catalog-only update on PG 12+) and idempotent
--     when guarded by `IF NOT EXISTS` so re-runs are no-ops.
--
-- We do NOT change the `report_reason` or `report_status` enums in this
-- wave. The locked contract names them differently (`reason_code`,
-- `received|reviewing|actioned|dismissed`) but the existing enums already
-- ship the same set of semantics under stable column names that iOS, the
-- admin queue, the reports.test.ts suite, and the audit_log all depend on.
-- A rename here would force every consumer to rev in lockstep with no
-- functional gain. The wire-level field names map cleanly already.

ALTER TYPE report_target_kind ADD VALUE IF NOT EXISTS 'story';
ALTER TYPE report_target_kind ADD VALUE IF NOT EXISTS 'feed_comment';

-- Down Migration --
-- PostgreSQL does not support DROP VALUE on an enum without a full type
-- rebuild that would lock the reports table. Down is intentionally a no-op
-- — the two enum values become inert if iOS stops emitting them. Rolling
-- back the up migration also doesn't touch existing data because no
-- production rows can have used the new values until the new code is live.
SELECT 1;
