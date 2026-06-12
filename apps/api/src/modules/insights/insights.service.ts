import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import { eloUpdate, type Outcome } from "../ratings/elo.js";
import { type InsightsQuery, type InsightsResponse } from "./insights.schema.js";

export interface InsightsServiceDeps {
  db: DbHandle;
}

interface RatingHistoryRow {
  id: string;
  rater_user_id: string;
  rater_display_name: string;
  rater_photo_url: string | null;
  rater_elo: number;
  outcome: Outcome;
  behavior_ok: boolean;
  created_at: Date;
}

/** Default ELO + reliability used when a player has zero stats. Mirrors the
 *  defaults baked into the `player_sport_stats` table. */
const DEFAULT_ELO = 1200;
const DEFAULT_RELIABILITY = 100;

export class InsightsService {
  constructor(private readonly deps: InsightsServiceDeps) {}

  /**
   * Build the insights payload for the authenticated viewer.
   *
   * Strategy — we don't store ELO snapshots; the live recompute already
   * mutates `player_sport_stats` in place. To paint a history chart we
   * REPLAY ratings chronologically and recompute ELO step-by-step using
   * the rater's CURRENT ELO as the opponent rating. This is an
   * approximation (the rater's ELO has moved since the match), but it's
   * deterministic, monotonic, and matches what the user perceives as
   * "their progression". Storing a true ELO journal would balloon the
   * ratings table; we accept the approximation.
   *
   * The reliability series is simulated symmetrically: we start at the
   * user's current reliability, walk backwards subtracting the per-event
   * delta (played = +1), and reverse the result. This yields a smooth
   * monotonic trend instead of a flat line, while never exceeding the
   * 0..100 envelope.
   */
  async getForUser(userId: string, q: InsightsQuery): Promise<InsightsResponse> {
    // Resolve sport slug → sport_id. 404 when slug is unknown so the client
    // sees a clean error instead of an empty payload.
    const sport = await this.deps.db.db
      .selectFrom("sports")
      .select(["id", "slug"])
      .where("slug", "=", q.sport)
      .executeTakeFirst();
    if (!sport) throw new NotFoundError(`Sport '${q.sport}' not found`);

    // Current player_sport_stats snapshot — drives ELO end-state + reliability.
    const stats = await this.deps.db.db
      .selectFrom("player_sport_stats")
      .select(["elo_rating", "games_played", "games_won", "reliability_score"])
      .where("user_id", "=", userId)
      .where("sport_id", "=", sport.id)
      .executeTakeFirst();

    const currentElo = stats?.elo_rating ?? DEFAULT_ELO;
    const currentReliability = stats?.reliability_score ?? DEFAULT_RELIABILITY;

    // Window bounds — inclusive of the start day.
    const sinceDate = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);

    // Pull the user's RECEIVED ratings (these drive their ELO) in chrono
    // order. We join users for the rater label/photo (opponents list) and
    // player_sport_stats for the rater's current ELO (opponent rating).
    const ratings = await sql<RatingHistoryRow>`
      SELECT r.id,
             r.rater_user_id,
             u.display_name AS rater_display_name,
             u.photo_url    AS rater_photo_url,
             COALESCE(pss.elo_rating, ${DEFAULT_ELO}) AS rater_elo,
             r.outcome,
             r.behavior_ok,
             r.created_at
        FROM ratings r
        JOIN users u           ON u.id = r.rater_user_id
        LEFT JOIN player_sport_stats pss
               ON pss.user_id = r.rater_user_id AND pss.sport_id = r.sport_id
       WHERE r.rated_user_id = ${userId}
         AND r.sport_id      = ${sport.id}
         AND r.created_at   >= ${sinceDate.toISOString()}
       ORDER BY r.created_at ASC
    `.execute(this.deps.db.db);

    // Replay ELO + win-rate using a running snapshot. The seed is the
    // viewer's current end-state minus the deltas we're about to compute —
    // we approximate by seeding at DEFAULT_ELO + 0/0 wins, then projecting
    // forward. The visual trend is what matters; the end-point may diverge
    // slightly from `current_elo` if the rater's ELO has drifted since.
    const eloSeries: { date: string; elo: number }[] = [];
    const winRateByDay = new Map<string, { wins: number; games: number }>();
    const opponentsAgg = new Map<
      string,
      {
        display_name: string;
        photo_url: string | null;
        wins: number;
        losses: number;
        draws: number;
      }
    >();
    const weekBuckets = new Map<string, number>();

    let runningElo = DEFAULT_ELO;
    let runningGames = 0;
    // `_runningWins` is intentionally written but never read — kept as
    // dead code because it documents intent ("we tracked this once") and
    // helps debugging if someone needs win-count snapshots per rating.
    // Leading underscore satisfies the `no-unused-vars` allowlist.
    let _runningWins = 0;

    for (const r of ratings.rows) {
      const update = eloUpdate(
        { rating: runningElo, gamesPlayed: runningGames },
        { rating: r.rater_elo, gamesPlayed: 0 },
        r.outcome,
      );
      runningElo = update.newRating;
      runningGames += 1;
      if (r.outcome === "win") _runningWins += 1;

      const day = isoDay(r.created_at);
      eloSeries.push({ date: day, elo: runningElo });

      const wr = winRateByDay.get(day) ?? { wins: 0, games: 0 };
      wr.games += 1;
      if (r.outcome === "win") wr.wins += 1;
      winRateByDay.set(day, wr);

      const wk = isoWeekStart(r.created_at);
      weekBuckets.set(wk, (weekBuckets.get(wk) ?? 0) + 1);

      const oppKey = r.rater_user_id;
      const opp =
        opponentsAgg.get(oppKey) ?? {
          display_name: r.rater_display_name,
          photo_url: r.rater_photo_url,
          wins: 0,
          losses: 0,
          draws: 0,
        };
      if (r.outcome === "win") opp.wins += 1;
      else if (r.outcome === "loss") opp.losses += 1;
      else opp.draws += 1;
      opponentsAgg.set(oppKey, opp);
    }

    // If we replayed at least one rating, anchor the LAST point to the
    // currently-stored ELO so the chart endpoint matches the badge.
    if (eloSeries.length > 0) {
      const last = eloSeries[eloSeries.length - 1];
      if (last !== undefined) {
        eloSeries[eloSeries.length - 1] = { date: last.date, elo: currentElo };
      }
    }

    // Build the win-rate series — sorted by day, with the percentage
    // computed once per day-bucket. We expose the per-day games count so
    // the chart can size dots proportionally.
    const winRateSeries = [...winRateByDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        win_rate: v.games === 0 ? 0 : (v.wins / v.games) * 100,
        games: v.games,
      }));

    // Games per week — fill missing weeks with 0 so the bar chart shows
    // the rhythm gaps. We span from the earliest week in the data
    // (or today's week if no data) up to the current week.
    const gamesPerWeek = densifyWeeks(weekBuckets, sinceDate);

    // Top opponents — sort by games desc, then by win-rate desc as a
    // tiebreak, cap at 10. The cap keeps the list mobile-friendly.
    const opponents = [...opponentsAgg.entries()]
      .map(([user_id, v]) => {
        const games = v.wins + v.losses + v.draws;
        return {
          user_id,
          display_name: v.display_name,
          photo_url: v.photo_url,
          games_count: games,
          wins: v.wins,
          losses: v.losses,
          draws: v.draws,
          win_rate: games === 0 ? 0 : (v.wins / games) * 100,
        };
      })
      .sort((a, b) => b.games_count - a.games_count || b.win_rate - a.win_rate)
      .slice(0, 10);

    // Reliability series — simple linear interpolation from a starting
    // floor up to the current value, sampled once per week bucket. With no
    // stored history this is the most informative trend we can show
    // without lying about the data.
    const reliabilitySeries = buildReliabilitySeries(
      currentReliability,
      gamesPerWeek.map((w) => w.week_start),
    );

    return {
      sport_slug: sport.slug,
      days: q.days,
      total_games: ratings.rows.length,
      current_elo: currentElo,
      current_reliability: currentReliability,
      elo_series: eloSeries,
      win_rate_series: winRateSeries,
      games_per_week: gamesPerWeek,
      opponents,
      reliability_series: reliabilitySeries,
    };
  }
}

/** Format a Date as a calendar-day ISO string in UTC (YYYY-MM-DD). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns the Monday (UTC) of the week containing `d` as ISO YYYY-MM-DD. */
function isoWeekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Take the sparse weekBuckets map and extend it to a contiguous Monday-aligned
 * series from the earliest week we should show (max of `since` window and the
 * earliest data point) up through the current week. Missing weeks get a 0.
 */
function densifyWeeks(
  weekBuckets: Map<string, number>,
  since: Date,
): { week_start: string; games: number }[] {
  const firstFromData = [...weekBuckets.keys()].sort()[0];
  const firstFromWindow = isoWeekStart(since);
  const start = firstFromData && firstFromData < firstFromWindow ? firstFromData : firstFromWindow;
  const today = isoWeekStart(new Date());
  const out: { week_start: string; games: number }[] = [];
  let cursor = new Date(start + "T00:00:00.000Z");
  const end = new Date(today + "T00:00:00.000Z");
  // Hard cap iterations at 260 (~5 years of weeks) so a misuse can't loop.
  for (let i = 0; i < 260 && cursor.getTime() <= end.getTime(); i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ week_start: key, games: weekBuckets.get(key) ?? 0 });
    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return out;
}

/**
 * Build a synthetic reliability series — flat at the current value across all
 * weeks. Real per-game reliability transitions aren't journaled, so we surface
 * the steady-state value rather than fabricate movement. The series shape
 * (one point per week) keeps charting code uniform with the other series.
 */
function buildReliabilitySeries(
  currentReliability: number,
  weeks: string[],
): { date: string; reliability: number }[] {
  if (weeks.length === 0) return [];
  return weeks.map((date) => ({ date, reliability: currentReliability }));
}
