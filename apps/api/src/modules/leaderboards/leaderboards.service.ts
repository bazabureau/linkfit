import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import {
  type LeaderboardEloResponse,
  type Scope,
  type SkillFilter,
  type Period,
} from "./leaderboards.schema.js";
import { skillLevelFromElo } from "../../shared/skill/skillLevel.js";

export interface LeaderboardsServiceDeps {
  db: DbHandle;
}

export interface LeaderboardEloListQuery {
  sport: string;
  limit: number;
  offset: number;
  region?: string | undefined;
  scope?: Scope | undefined;
  skill?: SkillFilter | undefined;
  period?: Period | undefined;
}

/**
 * Minimum games before a player is eligible for the leaderboard. Three is
 * the smallest sample where the ELO has actually been buffeted by more
 * than one opponent, so we don't pollute the top of the ladder with
 * lucky-streak 1- or 2-game accounts.
 */
const MIN_GAMES_PLAYED = 3;
const CITY_SCOPE_RADIUS_KM = 50;

interface LeaderboardRow {
  user_id: string;
  display_name: string;
  photo_url: string | null;
  elo_rating: number;
  games_played: number;
  games_won: number;
}

/**
 * Map the iOS skill bucket onto its inclusive lower / exclusive upper ELO
 * bounds. Mirrors `skillLevelFromElo` exactly — keep both sides in sync.
 *
 * `"all"` returns `null` so the caller can skip the WHERE fragment.
 */
function skillBoundsForFilter(
  skill: SkillFilter | undefined,
): { minElo: number; maxElo: number } | null {
  switch (skill) {
    case "beginner":
      return { minElo: 0, maxElo: 1100 };
    case "intermediate":
      return { minElo: 1100, maxElo: 1400 };
    case "advanced":
      return { minElo: 1400, maxElo: 1700 };
    case "expert":
      return { minElo: 1700, maxElo: 100_000 };
    case "all":
    case undefined:
    default:
      return null;
  }
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * LeaderboardsService — read-only ranking of players per sport, ordered by
 * ELO with games_played as the tie-breaker. The route layer feeds it an
 * optional viewer id so we can drop users that the viewer has blocked or
 * that have blocked the viewer (bidirectional). Anonymous callers get the
 * unfiltered ladder.
 *
 * Region and scope filters use the data we already have:
 *   - `region` matches venue name/address from the player's confirmed games.
 *   - `scope=city` matches players with home coordinates within 50km of the
 *     signed-in viewer's home coordinates. Anonymous callers or viewers
 *     without home coordinates gracefully fall back to global.
 *
 * Skill and period filters ARE applied:
 *   - `skill` translates to an inclusive ELO range via `skillBoundsForFilter`.
 *   - `period` filters by `pss.updated_at` against `NOW() - INTERVAL`. This
 *     is an approximation: `player_sport_stats` is touched on every ELO
 *     update, so users who haven't played recently fall out of the window
 *     naturally.
 */
export class LeaderboardsService {
  constructor(private readonly deps: LeaderboardsServiceDeps) {}

  async listEloLeaderboard(
    viewerUserId: string | null,
    query: LeaderboardEloListQuery,
  ): Promise<LeaderboardEloResponse> {
    // Resolve the sport slug → id. We throw NotFound up front so an unknown
    // sport returns 404 rather than a silently-empty list, which would
    // mask client typos.
    const sport = await this.deps.db.db
      .selectFrom("sports")
      .select(["id"])
      .where("slug", "=", query.sport)
      .executeTakeFirst();
    if (!sport) throw new NotFoundError("Sport not found");

    // The same WHERE-clause fragment drives both the page query and the
    // total_count query, so both stay consistent under filter changes.
    // `users.deleted_at IS NULL` is the standard soft-delete guard the
    // rest of the codebase uses.
    const blockFilter =
      viewerUserId !== null
        ? sql`AND NOT EXISTS (
                SELECT 1 FROM user_blocks ub
                 WHERE (ub.blocker_user_id = ${viewerUserId} AND ub.blocked_user_id = pss.user_id)
                    OR (ub.blocker_user_id = pss.user_id AND ub.blocked_user_id = ${viewerUserId})
              )`
        : sql``;

    const region = query.region?.trim();
    const regionFilter =
      region !== undefined && region.length > 0
        ? sql`AND EXISTS (
                SELECT 1
                  FROM game_participants rgp
                  JOIN games rg ON rg.id = rgp.game_id
                  LEFT JOIN courts rc ON rc.id = rg.court_id
                  LEFT JOIN venues rv ON rv.id = rc.venue_id
                 WHERE rgp.user_id = pss.user_id
                   AND rgp.status = 'confirmed'
                   AND rg.sport_id = ${sport.id}
                   AND (
                     rv.name ILIKE ${`%${escapeLikePattern(region)}%`} ESCAPE '\\'
                     OR rv.address ILIKE ${`%${escapeLikePattern(region)}%`} ESCAPE '\\'
                   )
              )`
        : sql``;

    const viewerHome =
      query.scope === "city" && viewerUserId !== null
        ? await this.deps.db.db
            .selectFrom("users")
            .select(["home_lat", "home_lng"])
            .where("id", "=", viewerUserId)
            .where("deleted_at", "is", null)
            .executeTakeFirst()
        : undefined;
    const hasViewerHome =
      viewerHome?.home_lat !== null &&
      viewerHome?.home_lat !== undefined &&
      viewerHome.home_lng !== null &&
      viewerHome.home_lng !== undefined;
    const scopeFilter =
      query.scope === "city" && hasViewerHome
        ? sql`AND u.home_lat IS NOT NULL
              AND u.home_lng IS NOT NULL
              AND earth_distance(
                    ll_to_earth(${Number(viewerHome.home_lat)}::float8, ${Number(viewerHome.home_lng)}::float8),
                    ll_to_earth(u.home_lat::float8, u.home_lng::float8)
                  ) <= ${CITY_SCOPE_RADIUS_KM * 1000}`
        : sql``;

    // Skill bucket → ELO range. `[minElo, maxElo)` half-open interval keeps
    // the bucketing identical to `skillLevelFromElo`.
    const skillBounds = skillBoundsForFilter(query.skill);
    const skillFilter = skillBounds
      ? sql`AND pss.elo_rating >= ${skillBounds.minElo} AND pss.elo_rating < ${skillBounds.maxElo}`
      : sql``;

    // Period → recency window on `pss.updated_at`. `player_sport_stats` is
    // updated on every ELO recalculation, so this captures "played within
    // the last N days" with a single index hit. `"all"` (or undefined) skips
    // the filter entirely.
    const periodFilter = (() => {
      switch (query.period) {
        case "week":
          return sql`AND pss.updated_at >= NOW() - INTERVAL '7 days'`;
        case "month":
          return sql`AND pss.updated_at >= NOW() - INTERVAL '30 days'`;
        case "all":
        case undefined:
        default:
          return sql``;
      }
    })();

    const rows = await sql<LeaderboardRow>`
      SELECT pss.user_id,
             u.display_name,
             u.photo_url,
             pss.elo_rating,
             pss.games_played,
             pss.games_won
        FROM player_sport_stats pss
        JOIN users u ON u.id = pss.user_id
       WHERE pss.sport_id = ${sport.id}
         AND pss.games_played >= ${MIN_GAMES_PLAYED}
         AND u.deleted_at IS NULL
         ${blockFilter}
         ${regionFilter}
         ${scopeFilter}
         ${skillFilter}
         ${periodFilter}
       ORDER BY pss.elo_rating DESC, pss.games_played DESC, pss.user_id ASC
       LIMIT ${query.limit}
      OFFSET ${query.offset}
    `.execute(this.deps.db.db);

    // total_count reflects the same filter set so the iOS pagination math
    // matches the visible items. Cast to ::int so pg's bigint comes back as
    // a number instead of a string.
    const totalResult = await sql<{ total: number }>`
      SELECT COUNT(*)::int AS total
        FROM player_sport_stats pss
        JOIN users u ON u.id = pss.user_id
       WHERE pss.sport_id = ${sport.id}
         AND pss.games_played >= ${MIN_GAMES_PLAYED}
         AND u.deleted_at IS NULL
         ${blockFilter}
         ${regionFilter}
         ${scopeFilter}
         ${skillFilter}
         ${periodFilter}
    `.execute(this.deps.db.db);
    const totalCount = totalResult.rows[0]?.total ?? 0;

    const items = rows.rows.map((r, idx) => {
      // Win rate as a fraction in [0, 1]. Defensive on games_played === 0
      // even though the MIN_GAMES_PLAYED filter already excludes that case,
      // because the column is `Generated<number>` and we don't want a
      // future migration that changes the floor to break this code.
      const winRate =
        r.games_played > 0
          ? Math.round((r.games_won / r.games_played) * 100) / 100
          : 0;
      return {
        rank: query.offset + idx + 1,
        user_id: r.user_id,
        display_name: r.display_name,
        photo_url: r.photo_url,
        elo_rating: r.elo_rating,
        skill_level: skillLevelFromElo(r.elo_rating),
        games_played: r.games_played,
        games_won: r.games_won,
        win_rate: winRate,
      };
    });

    return { items, total_count: totalCount };
  }
}
