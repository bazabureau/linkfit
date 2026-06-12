import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import {
  type UserAchievementItem,
  type UserAchievementsResponse,
} from "./achievements.schema.js";

export interface AchievementsServiceDeps {
  db: DbHandle;
}

/**
 * Criteria DSL — the service is the only place that interprets these.
 * Adding a new badge means inserting a row + (only if it's a new TYPE) a
 * branch in `evaluateCriterion` / `progressForCriterion`.
 */
type Criterion =
  | { type: "games_played"; value: number; sport: string }
  | { type: "elo_min"; value: number; sport: string }
  | { type: "win_streak"; value: number; sport: string }
  | {
      type: "reliability_min";
      value: number;
      min_games: number;
      sport: string;
    }
  | { type: "tournament_finalist" }
  | { type: "no_show_free_month" }
  | { type: "ratings_given"; value: number };

interface AchievementRow {
  slug: string;
  name: string;
  description: string;
  icon_name: string;
  criteria: Record<string, unknown>;
}

interface PlayerStats {
  elo_rating: number;
  games_played: number;
  games_won: number;
  reliability_score: number;
}

const NO_SHOW_FREE_WINDOW_DAYS = 30;

export class AchievementsService {
  constructor(private readonly deps: AchievementsServiceDeps) {}

  /**
   * Evaluate every catalog badge for the given user, inserting unlocks for
   * any whose criterion is now satisfied. Idempotent — `ON CONFLICT DO
   * NOTHING` keeps re-runs cheap. Returns the set of slugs unlocked DURING
   * this call (i.e. newly granted).
   *
   * Call this:
   *   - after a rating batch processes (ELO / games_played changed)
   *   - after a game completes
   *   - after a tournament transitions to `completed`
   */
  async evaluateForUser(userId: string): Promise<string[]> {
    const catalog = await this.loadCatalog();
    if (catalog.length === 0) return [];

    const alreadyUnlocked = await this.deps.db.db
      .selectFrom("user_achievements")
      .select("achievement_slug")
      .where("user_id", "=", userId)
      .execute();
    const alreadySet = new Set(alreadyUnlocked.map((r) => r.achievement_slug));

    const ctx = await this.loadEvaluationContext(userId);
    const newlyUnlocked: string[] = [];

    for (const row of catalog) {
      if (alreadySet.has(row.slug)) continue;
      const crit = this.parseCriterion(row.criteria);
      if (!crit) continue;
      const unlocked = await this.evaluateCriterion(userId, crit, ctx);
      if (!unlocked) continue;

      // Idempotent insert — concurrent calls are safe.
      const inserted = await this.deps.db.db
        .insertInto("user_achievements")
        .values({ user_id: userId, achievement_slug: row.slug })
        .onConflict((oc) => oc.columns(["user_id", "achievement_slug"]).doNothing())
        .returning("achievement_slug")
        .executeTakeFirst();
      if (inserted) newlyUnlocked.push(row.slug);
    }
    return newlyUnlocked;
  }

  /**
   * Read endpoint payload: every catalog badge tagged with unlocked/locked
   * state + a structured `progress` payload toward each locked criterion.
   *
   * Returns 404 if the user doesn't exist (so the public endpoint can lean
   * on existence semantics without a separate pre-check).
   */
  async listForUser(userId: string): Promise<UserAchievementsResponse> {
    const user = await this.deps.db.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!user) throw new NotFoundError("User not found");

    const catalog = await this.loadCatalog();
    const unlocks = await this.deps.db.db
      .selectFrom("user_achievements")
      .select(["achievement_slug", "unlocked_at"])
      .where("user_id", "=", userId)
      .execute();
    const unlockMap = new Map(
      unlocks.map((u) => [u.achievement_slug, u.unlocked_at]),
    );

    const ctx = await this.loadEvaluationContext(userId);

    const items: UserAchievementItem[] = [];
    for (const row of catalog) {
      const crit = this.parseCriterion(row.criteria);
      const unlockedAt = unlockMap.get(row.slug);
      const isUnlocked = unlockedAt !== undefined;
      const progress = crit && !isUnlocked ? this.progressForCriterion(crit, ctx) : null;

      items.push({
        slug: row.slug,
        name: row.name,
        description: row.description,
        icon_name: row.icon_name,
        unlocked: isUnlocked,
        unlocked_at: unlockedAt ? unlockedAt.toISOString() : null,
        progress,
      });
    }

    return {
      items,
      unlocked_count: unlockMap.size,
      total_count: catalog.length,
    };
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private async loadCatalog(): Promise<AchievementRow[]> {
    return this.deps.db.db
      .selectFrom("achievements")
      .select(["slug", "name", "description", "icon_name", "criteria"])
      .orderBy("created_at", "asc")
      .execute();
  }

  /** Narrow the raw jsonb to one of our known shapes. */
  private parseCriterion(raw: Record<string, unknown>): Criterion | null {
    const type = typeof raw.type === "string" ? raw.type : null;
    switch (type) {
      case "games_played":
      case "elo_min":
      case "win_streak":
        if (typeof raw.value === "number" && typeof raw.sport === "string") {
          return {
            type: type,
            value: raw.value,
            sport: raw.sport,
          };
        }
        return null;
      case "reliability_min":
        if (
          typeof raw.value === "number" &&
          typeof raw.min_games === "number" &&
          typeof raw.sport === "string"
        ) {
          return {
            type: "reliability_min",
            value: raw.value,
            min_games: raw.min_games,
            sport: raw.sport,
          };
        }
        return null;
      case "ratings_given":
        if (typeof raw.value === "number") {
          return { type: "ratings_given", value: raw.value };
        }
        return null;
      case "tournament_finalist":
        return { type: "tournament_finalist" };
      case "no_show_free_month":
        return { type: "no_show_free_month" };
      default:
        return null;
    }
  }

  /**
   * Pre-fetch everything we might need to evaluate the catalog so we don't
   * hammer the DB once per badge. Most badges share the per-sport stats
   * row; recent ratings & no-show counts are pulled with a single query
   * each.
   */
  private async loadEvaluationContext(userId: string): Promise<EvalContext> {
    const statsRows = await sql<{ sport_slug: string } & PlayerStats>`
      SELECT s.slug AS sport_slug,
             pss.elo_rating, pss.games_played, pss.games_won,
             pss.reliability_score
        FROM player_sport_stats pss
        JOIN sports s ON s.id = pss.sport_id
       WHERE pss.user_id = ${userId}
    `.execute(this.deps.db.db);
    const statsBySport = new Map<string, PlayerStats>();
    for (const r of statsRows.rows) {
      statsBySport.set(r.sport_slug, {
        elo_rating: r.elo_rating,
        games_played: r.games_played,
        games_won: r.games_won,
        reliability_score: r.reliability_score,
      });
    }

    const ratingsGiven = await this.deps.db.db
      .selectFrom("ratings")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("rater_user_id", "=", userId)
      .executeTakeFirst();

    return {
      statsBySport,
      ratingsGiven: Number(ratingsGiven?.c ?? 0),
    };
  }

  /**
   * Returns true iff the criterion is met right now. Some criteria require
   * one extra DB hit (win_streak / tournament_finalist / no_show_free_month)
   * because they look at lists, not the aggregated stats row.
   */
  private async evaluateCriterion(
    userId: string,
    crit: Criterion,
    ctx: EvalContext,
  ): Promise<boolean> {
    switch (crit.type) {
      case "games_played": {
        const s = ctx.statsBySport.get(crit.sport);
        return s !== undefined && s.games_played >= crit.value;
      }
      case "elo_min": {
        const s = ctx.statsBySport.get(crit.sport);
        return s !== undefined && s.elo_rating >= crit.value;
      }
      case "reliability_min": {
        const s = ctx.statsBySport.get(crit.sport);
        return (
          s !== undefined &&
          s.games_played >= crit.min_games &&
          s.reliability_score >= crit.value
        );
      }
      case "ratings_given":
        return ctx.ratingsGiven >= crit.value;
      case "win_streak":
        return this.hasWinStreak(userId, crit.value, crit.sport);
      case "tournament_finalist":
        return this.hasTournamentFinalist(userId);
      case "no_show_free_month":
        return this.hasNoShowFreeMonth(userId);
    }
  }

  /**
   * Map a criterion to a {current,target,unit} triple so the iOS detail
   * sheet can render a progress bar without baking in the DSL.
   */
  private progressForCriterion(
    crit: Criterion,
    ctx: EvalContext,
  ): { current: number; target: number; unit: string } {
    switch (crit.type) {
      case "games_played": {
        const s = ctx.statsBySport.get(crit.sport);
        return { current: s?.games_played ?? 0, target: crit.value, unit: "games" };
      }
      case "elo_min": {
        const s = ctx.statsBySport.get(crit.sport);
        return { current: s?.elo_rating ?? 0, target: crit.value, unit: "elo" };
      }
      case "win_streak":
        return { current: 0, target: crit.value, unit: "wins" };
      case "reliability_min": {
        const s = ctx.statsBySport.get(crit.sport);
        return {
          current: s?.reliability_score ?? 0,
          target: crit.value,
          unit: "percent",
        };
      }
      case "ratings_given":
        return { current: ctx.ratingsGiven, target: crit.value, unit: "ratings" };
      case "tournament_finalist":
        return { current: 0, target: 1, unit: "finals" };
      case "no_show_free_month":
        return { current: 0, target: NO_SHOW_FREE_WINDOW_DAYS, unit: "days" };
    }
  }

  /** Last N processed ratings of this user, win iff outcome='win'. */
  private async hasWinStreak(
    userId: string,
    streakLen: number,
    sportSlug: string,
  ): Promise<boolean> {
    const rows = await sql<{ outcome: string }>`
      SELECT r.outcome
        FROM ratings r
        JOIN sports s ON s.id = r.sport_id
       WHERE r.rated_user_id = ${userId}
         AND r.processed_at IS NOT NULL
         AND s.slug = ${sportSlug}
       ORDER BY r.processed_at DESC, r.id DESC
       LIMIT ${streakLen}
    `.execute(this.deps.db.db);
    if (rows.rows.length < streakLen) return false;
    return rows.rows.every((r) => r.outcome === "win");
  }

  /**
   * "Finalist" = roster (captain or player_ids) of any tournament_entry in
   * a COMPLETED tournament where status='confirmed'. We don't model brackets
   * yet, so for now "confirmed entry of a completed tournament" is the
   * pragmatic stand-in — refine when bracket data lands.
   */
  private async hasTournamentFinalist(userId: string): Promise<boolean> {
    const row = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
          FROM tournament_entries te
          JOIN tournaments t ON t.id = te.tournament_id
         WHERE t.status = 'completed'
           AND te.status = 'confirmed'
           AND (te.captain_user_id = ${userId}
                OR ${userId}::uuid = ANY (te.player_ids))
      ) AS "exists"
    `.execute(this.deps.db.db);
    return row.rows[0]?.exists === true;
  }

  /**
   * Played at least one game in the trailing 30 days AND had ZERO `no_show`
   * participation rows in that window. We look at `status_changed_at` on
   * `game_participants` to bound recency.
   */
  private async hasNoShowFreeMonth(userId: string): Promise<boolean> {
    const row = await sql<{
      played: string;
      no_shows: string;
    }>`
      SELECT
        COUNT(*) FILTER (WHERE gp.status = 'played')   AS played,
        COUNT(*) FILTER (WHERE gp.status = 'no_show')  AS no_shows
        FROM game_participants gp
       WHERE gp.user_id = ${userId}
         AND gp.status_changed_at >= now() - interval '${sql.raw(String(NO_SHOW_FREE_WINDOW_DAYS))} days'
    `.execute(this.deps.db.db);
    const r = row.rows[0];
    if (!r) return false;
    return Number(r.played) >= 1 && Number(r.no_shows) === 0;
  }
}

interface EvalContext {
  statsBySport: Map<string, PlayerStats>;
  ratingsGiven: number;
}
