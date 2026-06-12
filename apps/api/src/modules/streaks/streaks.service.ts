import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import {
  type StreaksResponse,
  type StreaksWeek,
} from "./streaks.schema.js";

export interface StreaksServiceDeps {
  db: DbHandle;
}

/** Trailing window the iOS heatmap is sized for. */
const HEATMAP_WEEKS = 26;
/** Statuses that count as a "real" participation for streak purposes. */
const ACTIVE_STATUSES = ["confirmed", "played"] as const;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

interface GameWeekRow {
  starts_at: Date;
}

/**
 * Computes per-user weekly play streaks from existing data — no new tables,
 * no caching. The query is bounded by the `HEATMAP_WEEKS` window for the
 * heatmap and a wider unbounded scan for `longest_streak_weeks` (so a player
 * who hit a 30-week streak years ago doesn't lose the badge once the window
 * scrolls past it).
 *
 * "Confirmed" or "played" participation in any game whose `starts_at` falls
 * inside an ISO week marks that week active. Cancelled / no_show rows don't
 * count — those weren't real plays.
 */
export class StreaksService {
  constructor(private readonly deps: StreaksServiceDeps) {}

  async computeForUser(userId: string): Promise<StreaksResponse> {
    // 404 path mirrors achievements/insights: clients lean on existence
    // semantics, and a deleted user shouldn't leak a default payload.
    const user = await this.deps.db.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!user) throw new NotFoundError("User not found");

    // Pull every active participation EVER for this user. We only fetch
    // `starts_at` — we don't care about the game itself, just its week.
    // The list scales with games played, not games on the platform; for any
    // realistic user this is small (≤ a few thousand rows).
    const rows = await sql<GameWeekRow>`
      SELECT g.starts_at
        FROM game_participants gp
        JOIN games g ON g.id = gp.game_id
       WHERE gp.user_id = ${userId}
         AND gp.status IN (${sql.join(ACTIVE_STATUSES.map((s) => sql.lit(s)))})
       ORDER BY g.starts_at ASC
    `.execute(this.deps.db.db);

    // Bucket into ISO weeks (Monday-anchored, UTC). Counts dedupe naturally
    // because each (game_id, user_id) pair is a unique row in
    // `game_participants`.
    const weekCounts = new Map<string, number>();
    for (const r of rows.rows) {
      const key = isoWeekStart(r.starts_at);
      weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
    }

    const currentWeek = isoWeekStart(new Date());
    const trailingWeeks = buildTrailingWeeks(currentWeek, HEATMAP_WEEKS, weekCounts);

    return {
      current_streak_weeks: computeCurrentStreak(currentWeek, weekCounts),
      longest_streak_weeks: computeLongestStreak(weekCounts),
      weeks: trailingWeeks,
    };
  }
}

/**
 * Build a contiguous trailing window of weeks ending at `currentWeek`,
 * oldest → newest. Each cell gets the (possibly zero) count from
 * `weekCounts`. Stable ordering means iOS can drop a Grid without sorting.
 */
function buildTrailingWeeks(
  currentWeek: string,
  size: number,
  weekCounts: Map<string, number>,
): StreaksWeek[] {
  const end = new Date(currentWeek + "T00:00:00.000Z");
  const out: StreaksWeek[] = [];
  for (let i = size - 1; i >= 0; i -= 1) {
    const cursor = new Date(end.getTime() - i * MS_PER_WEEK);
    const key = cursor.toISOString().slice(0, 10);
    out.push({ week_start: key, games_count: weekCounts.get(key) ?? 0 });
  }
  return out;
}

/**
 * Current-streak rule: walk backwards from this week. If this week has
 * activity, count it; otherwise allow a single missed week as a "grace"
 * (the player still has time to play this week). Any second consecutive
 * inactive week breaks the streak.
 */
function computeCurrentStreak(
  currentWeek: string,
  weekCounts: Map<string, number>,
): number {
  let cursor = new Date(currentWeek + "T00:00:00.000Z").getTime();
  const thisActive = (weekCounts.get(currentWeek) ?? 0) > 0;

  // The streak we report stops at the LAST active week, not at the current
  // week. So we shift the cursor back to the most recent active week first.
  if (!thisActive) {
    cursor -= MS_PER_WEEK;
    const prevKey = new Date(cursor).toISOString().slice(0, 10);
    if ((weekCounts.get(prevKey) ?? 0) === 0) {
      // Two-week gap → streak is dead.
      return 0;
    }
  }

  let streak = 0;
  while (cursor > 0) {
    const key = new Date(cursor).toISOString().slice(0, 10);
    if ((weekCounts.get(key) ?? 0) === 0) break;
    streak += 1;
    cursor -= MS_PER_WEEK;
    // Hard cap so a misuse can't loop forever (>10 years of weeks).
    if (streak > 520) break;
  }
  return streak;
}

/**
 * Longest historic streak across the entire activity set. Sort the active
 * week keys, walk in order, count contiguous Monday-to-Monday adjacency.
 */
function computeLongestStreak(weekCounts: Map<string, number>): number {
  const activeKeys = [...weekCounts.entries()]
    .filter(([, c]) => c > 0)
    .map(([k]) => k)
    .sort();
  if (activeKeys.length === 0) return 0;

  let longest = 1;
  let current = 1;
  for (let i = 1; i < activeKeys.length; i += 1) {
    const prevKey = activeKeys[i - 1];
    const curKey = activeKeys[i];
    if (prevKey === undefined || curKey === undefined) continue;
    const prev = new Date(`${prevKey}T00:00:00.000Z`).getTime();
    const cur = new Date(`${curKey}T00:00:00.000Z`).getTime();
    if (cur - prev === MS_PER_WEEK) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

/** Monday (UTC) of the week containing `d` as ISO `YYYY-MM-DD`. */
function isoWeekStart(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
