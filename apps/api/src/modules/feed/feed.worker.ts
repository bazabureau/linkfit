import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { type FeedEmitter } from "./feed.types.js";

export interface FeedWorkerDeps {
  db: DbHandle;
  emitter: FeedEmitter;
  logger: Logger;
  /** Poll interval. Defaults to 60s; tests override with a tiny value and
   *  drive the worker via `runOnce()` directly. */
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Sources we read from. Each one has its own watermark row so a failure in
 * one source never blocks another. Keep these names stable — they're the
 * primary key of `feed_cursor`.
 */
const SOURCE_GAME_JOINS = "game_joins";
const SOURCE_RATINGS = "ratings_processed";
const SOURCE_TOURNAMENT_ENTRIES = "tournament_entries";
const SOURCE_FOLLOWS = "follows";

const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * Background fan-out worker. Polls the source tables every minute and
 * synthesizes feed_events from interesting actions:
 *
 *   - new game_participants rows → `joined_game` (host AND each joiner)
 *   - ratings with `outcome='win'` and `processed_at IS NOT NULL` → `won_match`
 *   - new tournament_entries → `registered_tournament`
 *   - new follows → `followed_user`
 *   - player_sport_stats crossing an ELO milestone (every 100 points
 *     above 1200) → `elo_milestone`
 *
 * Idempotent: each insert carries a `source_key` (e.g. `rating:<id>`) and
 * the partial unique index drops re-emissions. Watermarks are advanced
 * AFTER successful insertion so a crash mid-batch is safe to retry.
 *
 * The worker NEVER blocks the request hot-path. It's started by
 * `server.ts` after route registration and stopped on shutdown.
 */
export class FeedWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: FeedWorkerDeps) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    // Kick off after a short delay so app startup isn't slowed by the first
    // poll. setInterval, not setTimeout-recursion: we want a stable cadence.
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    // Don't keep the process alive just for the timer — once the HTTP
    // server closes the worker should be torn down too.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test seam — runs a single pass, awaits completion. */
  async runOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return; // de-dupe overlapping polls.
    this.running = true;
    try {
      await this.processGameJoins();
      await this.processRatings();
      await this.processTournamentEntries();
      await this.processFollows();
    } catch (err) {
      this.deps.logger.error({ err }, "feed.worker tick failed");
    } finally {
      this.running = false;
    }
  }

  // ── Source: game_participants ───────────────────────────────────────────

  private async processGameJoins(): Promise<void> {
    const since = await this.getWatermark(SOURCE_GAME_JOINS);

    const rows = await sql<{
      game_id: string;
      user_id: string;
      joined_at: Date;
      host_user_id: string;
      sport_slug: string;
      venue_name: string | null;
    }>`
      SELECT gp.game_id, gp.user_id, gp.joined_at,
             g.host_user_id, s.slug AS sport_slug,
             v.name AS venue_name
        FROM game_participants gp
        JOIN games g  ON g.id = gp.game_id
        JOIN sports s ON s.id = g.sport_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE gp.joined_at > ${since}
         AND gp.status = 'confirmed'
       ORDER BY gp.joined_at ASC
       LIMIT 500
    `.execute(this.deps.db.db);

    let maxWatermark = since;
    for (const r of rows.rows) {
      await this.deps.emitter.emit({
        actorUserId: r.user_id,
        type: "joined_game",
        payload: {
          game_id: r.game_id,
          sport_slug: r.sport_slug,
          venue_name: r.venue_name,
          is_host: r.user_id === r.host_user_id,
        },
        sourceKey: `gp:${r.game_id}:${r.user_id}`,
      });
      if (r.joined_at > maxWatermark) maxWatermark = r.joined_at;
    }

    if (rows.rows.length > 0) {
      await this.setWatermark(SOURCE_GAME_JOINS, maxWatermark);
    }
  }

  // ── Source: ratings (processed → won_match for the winner) ──────────────

  private async processRatings(): Promise<void> {
    const since = await this.getWatermark(SOURCE_RATINGS);

    const rows = await sql<{
      id: string;
      rated_user_id: string;
      game_id: string;
      outcome: string;
      processed_at: Date;
    }>`
      SELECT id, rated_user_id, game_id, outcome, processed_at
        FROM ratings
       WHERE processed_at IS NOT NULL
         AND processed_at > ${since}
         AND outcome = 'win'
       ORDER BY processed_at ASC
       LIMIT 500
    `.execute(this.deps.db.db);

    let maxWatermark = since;
    for (const r of rows.rows) {
      await this.deps.emitter.emit({
        actorUserId: r.rated_user_id,
        type: "won_match",
        payload: { game_id: r.game_id, rating_id: r.id },
        sourceKey: `rating:${r.id}`,
      });
      if (r.processed_at > maxWatermark) maxWatermark = r.processed_at;
    }

    if (rows.rows.length > 0) {
      await this.setWatermark(SOURCE_RATINGS, maxWatermark);

      // ELO milestones piggyback on the rating-processed signal — every time
      // a player's ELO crosses a multiple of 100 (above 1200) we emit one.
      // We fetch CURRENT stats AFTER the rating has been applied; the worker
      // doesn't store snapshots so we tolerate missing a milestone if two
      // crosses happen between polls.
      const userIds = Array.from(new Set(rows.rows.map((r) => r.rated_user_id)));
      if (userIds.length > 0) {
        const stats = await sql<{
          user_id: string;
          elo_rating: number;
          sport_slug: string;
        }>`
          SELECT pss.user_id, pss.elo_rating, s.slug AS sport_slug
            FROM player_sport_stats pss
            JOIN sports s ON s.id = pss.sport_id
           WHERE pss.user_id IN (${sql.join(userIds)})
        `.execute(this.deps.db.db);

        for (const s of stats.rows) {
          if (s.elo_rating >= 1300 && s.elo_rating % 100 === 0) {
            await this.deps.emitter.emit({
              actorUserId: s.user_id,
              type: "elo_milestone",
              payload: { sport_slug: s.sport_slug, elo_rating: s.elo_rating },
              sourceKey: `elo:${s.user_id}:${s.sport_slug}:${String(s.elo_rating)}`,
              visibility: "public",
            });
          }
        }
      }
    }
  }

  // ── Source: tournament_entries ──────────────────────────────────────────

  private async processTournamentEntries(): Promise<void> {
    const since = await this.getWatermark(SOURCE_TOURNAMENT_ENTRIES);

    const rows = await sql<{
      id: string;
      tournament_id: string;
      captain_user_id: string;
      squad_name: string;
      tournament_name: string;
      created_at: Date;
    }>`
      SELECT te.id, te.tournament_id, te.captain_user_id, te.squad_name,
             te.created_at, t.name AS tournament_name
        FROM tournament_entries te
        JOIN tournaments t ON t.id = te.tournament_id
       WHERE te.created_at > ${since}
         AND te.status IN ('pending', 'confirmed')
       ORDER BY te.created_at ASC
       LIMIT 500
    `.execute(this.deps.db.db);

    let maxWatermark = since;
    for (const r of rows.rows) {
      await this.deps.emitter.emit({
        actorUserId: r.captain_user_id,
        type: "registered_tournament",
        payload: {
          tournament_id: r.tournament_id,
          tournament_name: r.tournament_name,
          squad_name: r.squad_name,
        },
        sourceKey: `te:${r.id}`,
      });
      if (r.created_at > maxWatermark) maxWatermark = r.created_at;
    }

    if (rows.rows.length > 0) {
      await this.setWatermark(SOURCE_TOURNAMENT_ENTRIES, maxWatermark);
    }
  }

  // ── Source: follows ─────────────────────────────────────────────────────

  private async processFollows(): Promise<void> {
    const since = await this.getWatermark(SOURCE_FOLLOWS);

    const rows = await sql<{
      follower_user_id: string;
      followed_user_id: string;
      created_at: Date;
    }>`
      SELECT follower_user_id, followed_user_id, created_at
        FROM follows
       WHERE created_at > ${since}
       ORDER BY created_at ASC
       LIMIT 500
    `.execute(this.deps.db.db);

    let maxWatermark = since;
    for (const r of rows.rows) {
      await this.deps.emitter.emit({
        actorUserId: r.follower_user_id,
        type: "followed_user",
        payload: { followed_user_id: r.followed_user_id },
        sourceKey: `follow:${r.follower_user_id}:${r.followed_user_id}`,
      });
      if (r.created_at > maxWatermark) maxWatermark = r.created_at;
    }

    if (rows.rows.length > 0) {
      await this.setWatermark(SOURCE_FOLLOWS, maxWatermark);
    }
  }

  // ── Watermark helpers ───────────────────────────────────────────────────

  private async getWatermark(source: string): Promise<Date> {
    const row = await this.deps.db.db
      .selectFrom("feed_cursor")
      .select("watermark")
      .where("source", "=", source)
      .executeTakeFirst();
    return row?.watermark ?? new Date(EPOCH);
  }

  private async setWatermark(source: string, watermark: Date): Promise<void> {
    await sql`
      INSERT INTO feed_cursor (source, watermark, updated_at)
      VALUES (${source}, ${watermark.toISOString()}::timestamptz, now())
      ON CONFLICT (source) DO UPDATE
        SET watermark = EXCLUDED.watermark,
            updated_at = now()
    `.execute(this.deps.db.db);
  }
}
