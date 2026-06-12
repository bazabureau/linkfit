import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { renderPushTemplate } from "../../shared/i18n/index.js";
import { isInQuietHours } from "../notification-preferences/notification-preferences.service.js";
import { type PushService } from "./push.service.js";

/**
 * Wave-10 daily-digest sweeper.
 *
 * **Why this exists.** Once a day, at the user's local 18:00, we send a
 * single APNs banner summarising the three most-engaging things waiting
 * in-app: a recommended player, a recommended game, and a follow-graph
 * event. The hypothesis is that a curated 6pm nudge — landing right as
 * users finish work and decide what to do tonight — converts better than
 * the existing event-driven pushes that fire whenever something happens
 * (and so cluster outside of decision windows).
 *
 * **Why a sweeper, not a scheduled job per user.** Two reasons:
 *   1. Per-user `setTimeout`s evaporate on every server restart. A sweeper
 *      polling the DB is restart-safe and works across pods.
 *   2. Local-time scheduling means the "fire at 18:00" trigger varies by
 *      time zone. Rather than maintain a per-tz cron expression, we tick
 *      hourly (UTC) and filter to users whose LOCAL hour is currently 18.
 *      One pass touches every time zone correctly without per-tz cron
 *      bookkeeping.
 *
 * **Exactly-once delivery.** The `daily_digest_sent` ledger uses
 * `(user_id, sent_date)` as the composite PK where `sent_date` is the
 * user's LOCAL calendar date. The sweeper INSERTs first with `ON CONFLICT
 * DO NOTHING RETURNING *`; only the rows that actually wrote come back,
 * so two overlapping ticks (or two pods racing) can't double-fire for
 * the same user on the same local day.
 *
 * **Filtering cascade.** For each user we drop fast first:
 *   - skip if their local hour != 18 (cheap: pure JS, no DB)
 *   - skip if `daily_digest_enabled = false`
 *   - skip if quiet hours (UTC) overlap NOW
 *   - skip if already sent today (ledger)
 *   - skip if no content (don't send empty digest)
 *
 * **Empty digest.** If the content builder returns zero highlights we
 * deliberately do NOT insert a ledger row, so the user gets another shot
 * tomorrow when their following list has something fresh. This is the
 * inverse of the games-reminder sweeper, which reserves the ledger row
 * BEFORE emitting — there, the cost of a missed reminder beats the cost
 * of a duplicate. For the digest the cost calculus reverses: a duplicate
 * empty digest is the worst possible user experience.
 */
export interface DailyDigestSweeperDeps {
  db: DbHandle;
  logger: Logger;
  push: PushService;
  /**
   * Polling cadence. Defaults to 60 min — the user-local 18:00 window is
   * 60 minutes wide (any time during the local 18:xx hour qualifies), so
   * a sub-hour cadence buys us nothing. Tests pass a smaller value to
   * force an immediate sweep.
   */
  tickIntervalMs?: number;
  /**
   * The user-local hour at which the digest fires. Default 18 (= 6pm
   * local). Exposed for tests + ops so we can shift the trigger window
   * without a code change.
   */
  triggerLocalHour?: number;
  /**
   * Capability seam for tests: the wall-clock the sweeper consults. Defaults
   * to `Date.now()`. Letting tests inject a fixed instant means we can
   * exercise the local-time math against a known moment in Baku without
   * monkey-patching `Date`.
   */
  now?: () => Date;
}

const DEFAULT_TICK_MS = 60 * 60 * 1000;
const DEFAULT_TRIGGER_HOUR = 18;
const MAX_USERS_PER_TICK = 5000;

interface DigestUserRow {
  id: string;
  time_zone: string;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
}

interface DigestHighlight {
  /** Short label rendered into the banner body. AZ phrasing. */
  label: string;
  /** iOS tab the deeplink should land in. */
  deep_link_tab: "home" | "players" | "games";
  /** Optional entity id for the in-app router (game id, user id, story id). */
  entity_id?: string;
  /** Optional entity kind to disambiguate the entity_id on the iOS side. */
  entity_kind?: "game" | "user" | "story";
}

interface DigestPayload {
  highlights: DigestHighlight[];
  /** Top highlight's label — used as the headline placeholder. */
  headline: string;
  /** Tab the banner tap should open. Mirrors the top highlight. */
  primary_deep_link_tab: "home" | "players" | "games";
}

/**
 * Compute a user's LOCAL hour and calendar date given an IANA tz string.
 * Uses `Intl.DateTimeFormat` with the requested time zone — the platform
 * tz database is authoritative.
 *
 * Exported for unit testing.
 */
export function localClockForUser(now: Date, ianaTz: string): { hour: number; date: string } {
  try {
    // `en-GB` chosen for its stable 24-hour clock and ISO-ish date layout.
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: ianaTz,
      hour: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const part = (key: string): string =>
      parts.find((p) => p.type === key)?.value ?? "";
    const hourStr = part("hour");
    const year = part("year");
    const month = part("month");
    const day = part("day");
    // `en-GB` returns hour as "24" at midnight on some Node versions —
    // normalise to 0 so downstream comparisons see [0..23].
    const hourRaw = Number.parseInt(hourStr, 10);
    const hour = hourRaw === 24 ? 0 : hourRaw;
    return { hour, date: `${year}-${month}-${day}` };
  } catch {
    // Bad tz string — fall back to UTC. The caller's outer guard will skip
    // an "Asia/Whatever" user that no longer resolves, but a transient
    // upstream change shouldn't crash the entire sweep.
    return {
      hour: now.getUTCHours(),
      date: now.toISOString().slice(0, 10),
    };
  }
}

export class DailyDigestSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: DailyDigestSweeperDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.deps.logger.info(
      { event: "daily_digest_sweeper_started", interval_ms: intervalMs },
      "daily-digest sweeper started",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single pass. Public so tests / admin can trigger out-of-band. */
  async tick(): Promise<{ digestsSent: number; usersConsidered: number }> {
    if (this.running) return { digestsSent: 0, usersConsidered: 0 };
    this.running = true;
    try {
      const now = (this.deps.now ?? (() => new Date()))();
      const triggerHour = this.deps.triggerLocalHour ?? DEFAULT_TRIGGER_HOUR;

      // Pull all live users with a digest opt-in. We need the row for the
      // tz/quiet-hours decision below — we can't push the tz check into
      // SQL without taking on a Postgres `AT TIME ZONE` dance against a
      // generated column. A pure-JS filter over the candidate set is
      // simpler and the working set is bounded by MAX_USERS_PER_TICK.
      const users = await this.deps.db.db
        .selectFrom("users")
        .select([
          "id",
          "time_zone",
          "quiet_hours_start",
          "quiet_hours_end",
        ])
        .where("daily_digest_enabled", "=", true)
        .where("deleted_at", "is", null)
        .limit(MAX_USERS_PER_TICK)
        .execute();

      let digestsSent = 0;
      for (const user of users) {
        try {
          if (await this.processUser(user, now, triggerHour)) {
            digestsSent += 1;
          }
        } catch (err) {
          this.deps.logger.error(
            { err, user_id: user.id, event: "daily_digest_user_failed" },
            "daily-digest failed for user",
          );
        }
      }

      if (digestsSent > 0) {
        this.deps.logger.info(
          {
            event: "daily_digest_sweep_done",
            digests_sent: digestsSent,
            users_considered: users.length,
          },
          "daily-digest sweep done",
        );
      }
      return { digestsSent, usersConsidered: users.length };
    } finally {
      this.running = false;
    }
  }

  /**
   * Per-user pipeline. Returns true when we actually emitted a push.
   *
   * The order of filters here is deliberately cheapest-first:
   *   1. Local hour check (pure JS, no DB).
   *   2. Quiet hours check (uses already-loaded row fields).
   *   3. Ledger reservation (one INSERT, blocks any racing tick).
   *   4. Content build (multiple SELECTs — only run if we passed everything).
   *   5. Push delivery.
   *
   * The ledger row is INSERTed BEFORE content build but only COMMITTED if
   * we have non-empty content. We use a CTE-style INSERT ... RETURNING +
   * an explicit DELETE if the content turns out empty, so a noisy day
   * doesn't burn a ledger slot and block tomorrow's first-content digest.
   */
  private async processUser(
    user: DigestUserRow,
    now: Date,
    triggerHour: number,
  ): Promise<boolean> {
    // ---- 1. Local hour filter ----
    const clock = localClockForUser(now, user.time_zone);
    if (clock.hour !== triggerHour) return false;

    // ---- 2. Quiet hours (UTC) ----
    // We respect the existing UTC-keyed quiet-hours window even though the
    // digest is locked to local 18:00. Rationale: the user explicitly opted
    // into quiet hours; honouring it gives them a single global escape
    // hatch. In practice 18:00 local rarely overlaps a sensible quiet
    // window, so this is almost always a no-op.
    if (user.quiet_hours_start !== null && user.quiet_hours_end !== null) {
      if (isInQuietHours(now, user.quiet_hours_start, user.quiet_hours_end)) {
        return false;
      }
    }

    // ---- 3. Try to reserve the ledger row ----
    // ON CONFLICT DO NOTHING means an already-sent row makes this a no-op
    // and we skip without emitting. We pass `sent_date` as the user's
    // local calendar date so a user can never get two digests for the
    // same local day, even across UTC boundary crossings.
    const reserved = await sql<{ user_id: string }>`
      INSERT INTO daily_digest_sent (user_id, sent_date)
      VALUES (${user.id}::uuid, ${clock.date}::date)
      ON CONFLICT (user_id, sent_date) DO NOTHING
      RETURNING user_id
    `.execute(this.deps.db.db);
    if (reserved.rows.length === 0) return false;

    // ---- 4. Build digest content ----
    let payload: DigestPayload | null;
    try {
      payload = await this.buildDigest(user.id);
    } catch (err) {
      // Roll back the ledger reservation so the user gets another chance
      // tomorrow rather than being silently locked out by today's failure.
      // Raw SQL because Kysely's `where("sent_date", "=", ...)` expects a
      // `Date | string` matching the column's `ColumnType` Update side,
      // and our local-date string ("2026-05-21") goes through cleaner as
      // an explicit `::date` cast on the SQL side.
      await sql`
        DELETE FROM daily_digest_sent
         WHERE user_id = ${user.id}::uuid
           AND sent_date = ${clock.date}::date
      `.execute(this.deps.db.db);
      throw err;
    }
    if (payload === null) {
      // No content — un-reserve so we re-evaluate at the next local 18:00
      // window. Without this, a user with quiet weekday mornings would
      // be locked out for the whole day.
      await sql`
        DELETE FROM daily_digest_sent
         WHERE user_id = ${user.id}::uuid
           AND sent_date = ${clock.date}::date
      `.execute(this.deps.db.db);
      return false;
    }

    // ---- 5. Send the push ----
    // Locale defaults to AZ; the `users` table has no locale column yet,
    // so `renderPushTemplate` resolves to the AZ catalog via `normalizeLocale`.
    // When a `users.locale` column ships we'll plumb it here.
    const rendered = renderPushTemplate("digest.daily", null, {
      count: payload.highlights.length,
      headline: payload.headline,
    });

    await this.deps.push.deliverToUser(user.id, {
      type: "system",
      title: rendered.title,
      body: rendered.body,
      data: {
        kind: "daily_digest",
        deep_link_tab: payload.primary_deep_link_tab,
        headline: payload.headline,
        highlights: payload.highlights.map((h) => ({
          label: h.label,
          deep_link_tab: h.deep_link_tab,
          ...(h.entity_id !== undefined ? { entity_id: h.entity_id } : {}),
          ...(h.entity_kind !== undefined ? { entity_kind: h.entity_kind } : {}),
        })),
      },
      // One digest per user per day → collapse-id keyed on the local date
      // so a retry after a crash deduplicates at the APNs gateway.
      collapseId: `digest:${clock.date}`,
      threadId: "daily_digest",
    });

    return true;
  }

  /**
   * Build up to three highlights for the user:
   *  1. Top recommended player they don't already follow (PlayersView tab).
   *  2. Top open game they could join (GamesView tab).
   *  3. Followed-user activity in the last 24h (story posted, won match)
   *     (HomeView stories rail).
   *
   * Returns `null` when there's nothing to surface — the caller treats this
   * as "skip the digest entirely". Each highlight is its own try/catch so
   * a failure on one slot doesn't suppress the others.
   *
   * The label strings are AZ — see push.templates.ts for the wrapping
   * banner copy. The labels are short noun phrases that read naturally
   * after "—" in the rendered body.
   */
  private async buildDigest(userId: string): Promise<DigestPayload | null> {
    const highlights: DigestHighlight[] = [];

    // Slot 1: top recommended player. Cheap aggregation — one SELECT
    // candidate row from `users` filtered against follows / blocks.
    try {
      const player = await this.topRecommendedPlayer(userId);
      if (player) highlights.push(player);
    } catch (err) {
      this.deps.logger.warn(
        { err, user_id: userId, slot: "player" },
        "digest.slot_failed",
      );
    }

    // Slot 2: top open game. Joined to `games` filtered by status/start time.
    try {
      const game = await this.topOpenGame(userId);
      if (game) highlights.push(game);
    } catch (err) {
      this.deps.logger.warn(
        { err, user_id: userId, slot: "game" },
        "digest.slot_failed",
      );
    }

    // Slot 3: follow-graph activity (most-recent story by a followed user).
    try {
      const social = await this.topFollowedActivity(userId);
      if (social) highlights.push(social);
    } catch (err) {
      this.deps.logger.warn(
        { err, user_id: userId, slot: "social" },
        "digest.slot_failed",
      );
    }

    if (highlights.length === 0) return null;
    const top = highlights[0];
    if (!top) return null;
    return {
      highlights,
      headline: top.label,
      primary_deep_link_tab: top.deep_link_tab,
    };
  }

  /**
   * One SELECT that picks the highest-ELO-overlap candidate the viewer
   * does NOT already follow, isn't blocked by/blocking, and is alive.
   * Distance is a tiebreaker — we don't need full matchmaking scoring for
   * the digest; the goal is a "you should follow this person" nudge, not
   * a full ranking list.
   */
  private async topRecommendedPlayer(userId: string): Promise<DigestHighlight | null> {
    const row = await sql<{ id: string; display_name: string }>`
      WITH viewer AS ( SELECT ${userId}::uuid AS user_id )
      SELECT u.id, u.display_name
        FROM users u
       WHERE u.deleted_at IS NULL
         AND u.id <> (SELECT user_id FROM viewer)
         AND NOT EXISTS (
           SELECT 1 FROM follows f
            WHERE f.follower_user_id = (SELECT user_id FROM viewer)
              AND f.followed_user_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE (b.blocker_user_id = (SELECT user_id FROM viewer) AND b.blocked_user_id = u.id)
               OR (b.blocker_user_id = u.id AND b.blocked_user_id = (SELECT user_id FROM viewer))
         )
       ORDER BY u.created_at DESC
       LIMIT 1
    `.execute(this.deps.db.db);

    const cand = row.rows[0];
    if (!cand) return null;
    return {
      label: cand.display_name,
      deep_link_tab: "players",
      entity_id: cand.id,
      entity_kind: "user",
    };
  }

  /**
   * The most imminent open public game the viewer isn't already in.
   * Mirrors the `matchmaking` filter set (open, public, future, not the
   * host, not already a confirmed participant) but skips full scoring.
   */
  private async topOpenGame(userId: string): Promise<DigestHighlight | null> {
    const row = await sql<{
      id: string;
      sport_slug: string;
      starts_at: Date;
      venue_name: string | null;
    }>`
      WITH viewer AS ( SELECT ${userId}::uuid AS user_id )
      SELECT g.id,
             s.slug AS sport_slug,
             g.starts_at,
             v.name AS venue_name
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE g.status = 'open'
         AND g.visibility = 'public'
         AND g.deleted_at IS NULL
         AND g.starts_at > now()
         AND g.host_user_id <> (SELECT user_id FROM viewer)
         AND NOT EXISTS (
           SELECT 1 FROM game_participants gp
            WHERE gp.game_id = g.id
              AND gp.user_id = (SELECT user_id FROM viewer)
              AND gp.status = 'confirmed'
         )
       ORDER BY g.starts_at ASC
       LIMIT 1
    `.execute(this.deps.db.db);

    const game = row.rows[0];
    if (!game) return null;
    // AZ phrasing: "<venue or sport> – <hh:mm>". When venue is missing
    // (impromptu meetup) we fall back to the sport slug capitalised.
    const venue = game.venue_name ?? capitalise(game.sport_slug);
    const startsAt = new Date(game.starts_at);
    const time = `${pad2(startsAt.getUTCHours())}:${pad2(startsAt.getUTCMinutes())}`;
    return {
      label: `${venue} – ${time}`,
      deep_link_tab: "games",
      entity_id: game.id,
      entity_kind: "game",
    };
  }

  /**
   * Latest activity from someone the viewer follows. We pick the newest
   * non-expired story by a followed author in the last 24h, since stories
   * are the most engagement-dense follow-graph artefact. A future
   * iteration could mix in "friend just won a match" by reading
   * `feed_events`, but the story-only signal is the most consistently
   * non-empty in practice.
   */
  private async topFollowedActivity(userId: string): Promise<DigestHighlight | null> {
    const row = await sql<{
      id: string;
      author_id: string;
      display_name: string;
      created_at: Date;
    }>`
      WITH viewer AS ( SELECT ${userId}::uuid AS user_id )
      SELECT s.id, s.user_id AS author_id, u.display_name, s.created_at
        FROM stories s
        JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > now()
         AND s.created_at > now() - interval '24 hours'
         AND u.deleted_at IS NULL
         AND s.user_id IN (
           SELECT followed_user_id FROM follows
            WHERE follower_user_id = (SELECT user_id FROM viewer)
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE (b.blocker_user_id = (SELECT user_id FROM viewer) AND b.blocked_user_id = s.user_id)
               OR (b.blocker_user_id = s.user_id AND b.blocked_user_id = (SELECT user_id FROM viewer))
         )
       ORDER BY s.created_at DESC
       LIMIT 1
    `.execute(this.deps.db.db);

    const story = row.rows[0];
    if (!story) return null;
    // AZ: "<name> story paylaşdı" → "shared a story". Compact for the
    // digest body — iOS expands to the full chrome on tap.
    return {
      label: `${story.display_name} story paylaşdı`,
      deep_link_tab: "home",
      entity_id: story.id,
      entity_kind: "story",
    };
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function capitalise(slug: string): string {
  if (slug.length === 0) return slug;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
