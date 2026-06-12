import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import { type PlayersListQuery } from "./social.schema.js";
import {
  type SkillLevel,
  skillLevelFromElo,
} from "../../shared/skill/skillLevel.js";

export interface SocialServiceDeps {
  db: DbHandle;
}

// ─── Rankings ──────────────────────────────────────────────────────────

export interface RankingItem {
  rank: number;
  user_id: string;
  display_name: string;
  photo_url: string | null;
  elo_rating: number;
  /** Derived from `elo_rating` — see `shared/skill/skillLevel.ts`. */
  skill_level: SkillLevel;
  games_played: number;
  games_won: number;
  reliability_score: number;
}

export interface RankingsPayload {
  sport_slug: string;
  items: RankingItem[];
}

// ─── Players ───────────────────────────────────────────────────────────

export interface PlayerSummary {
  id: string;
  display_name: string;
  photo_url: string | null;
  primary_sport: string | null;
  primary_elo: number | null;
  /**
   * Word-based label derived from `primary_elo`. `null` when `primary_elo`
   * is `null` (no recorded stats yet) — null keeps the "skill chip" hidden
   * on the iOS list rather than misleadingly stamping a "beginner" badge
   * on every brand-new account in the directory.
   */
  primary_skill_level: SkillLevel | null;
  reliability_score: number | null;
  distance_km: number | null;
  followers_count: number;
  is_followed_by_me: boolean;
  /**
   * ISO-8601 timestamp of the last time the user authenticated. Refreshed by
   * the auth guard on a 60s-debounced cadence. NULL for accounts that have
   * never been seen since the column was introduced (test fixtures, etc.).
   * The iOS UI maps this to "Active now" / "5m ago" / "Active yesterday".
   */
  last_seen_at: string | null;
}

// Tournaments live in their own module — see src/modules/tournaments.

export class SocialService {
  constructor(private readonly deps: SocialServiceDeps) {}

  // ─── Rankings ─────────────────────────────────────────────────────

  async rankings(sportSlug: string, limit = 50): Promise<RankingsPayload> {
    const sport = await this.deps.db.db
      .selectFrom("sports")
      .select("id")
      .where("slug", "=", sportSlug)
      .executeTakeFirst();
    if (!sport) throw new NotFoundError(`Unknown sport: ${sportSlug}`);

    // Require at least 5 games played to be ranked — keeps provisional-noise
    // out of the leaderboard.
    const result = await sql<{
      user_id: string;
      display_name: string;
      photo_url: string | null;
      elo_rating: number;
      games_played: number;
      games_won: number;
      reliability_score: number;
      rn: string;
    }>`
      SELECT u.id           AS user_id,
             u.display_name AS display_name,
             u.photo_url    AS photo_url,
             pss.elo_rating,
             pss.games_played,
             pss.games_won,
             pss.reliability_score,
             ROW_NUMBER() OVER (ORDER BY pss.elo_rating DESC, pss.games_played DESC, u.created_at ASC)::text AS rn
        FROM player_sport_stats pss
        JOIN users u ON u.id = pss.user_id
       WHERE pss.sport_id = ${sport.id}
         AND pss.games_played >= 5
         AND u.deleted_at IS NULL
       ORDER BY pss.elo_rating DESC, pss.games_played DESC, u.created_at ASC
       LIMIT ${limit}
    `.execute(this.deps.db.db);

    return {
      sport_slug: sportSlug,
      items: result.rows.map((r) => ({
        rank: Number(r.rn),
        user_id: r.user_id,
        display_name: r.display_name,
        photo_url: r.photo_url,
        elo_rating: r.elo_rating,
        skill_level: skillLevelFromElo(r.elo_rating),
        games_played: r.games_played,
        games_won: r.games_won,
        reliability_score: r.reliability_score,
      })),
    };
  }

  // ─── Players directory ────────────────────────────────────────────

  async players(query: PlayersListQuery, viewerUserId: string | null = null): Promise<PlayerSummary[]> {
    const limit = query.limit ?? 30;
    const hasGeo = query.lat !== undefined && query.lng !== undefined && query.radius_km !== undefined;
    const ilikeQ = query.q ? `%${query.q}%` : null;
    const followingOnly = query.following_only === true;

    // `following_only` requires an authenticated viewer; anonymous callers
    // legitimately resolve to "no follows" → empty list.
    if (followingOnly && !viewerUserId) return [];

    const result = await sql<{
      id: string;
      display_name: string;
      photo_url: string | null;
      primary_sport: string | null;
      primary_elo: number | null;
      reliability_score: number | null;
      distance_m: string | null;
      followers_count: string;
      is_followed_by_me: boolean;
      last_seen_at: Date | null;
    }>`
      WITH primary_stats AS (
        SELECT DISTINCT ON (pss.user_id)
          pss.user_id, s.slug AS slug, pss.elo_rating, pss.reliability_score
          FROM player_sport_stats pss
          JOIN sports s ON s.id = pss.sport_id
         ${query.sport ? sql`WHERE s.slug = ${query.sport}` : sql``}
         ORDER BY pss.user_id, pss.elo_rating DESC
      )
      SELECT u.id, u.display_name, u.photo_url,
             ps.slug AS primary_sport,
             ps.elo_rating AS primary_elo,
             ps.reliability_score,
             u.last_seen_at,
             ${
               hasGeo
                 ? sql`earth_distance(
                         ll_to_earth(${query.lat}::float8, ${query.lng}::float8),
                         ll_to_earth(u.home_lat::float8, u.home_lng::float8)
                       )::text`
                 : sql`NULL::text`
             } AS distance_m,
             (SELECT count(*) FROM follows f WHERE f.followed_user_id = u.id)::text
               AS followers_count,
             ${
               viewerUserId
                 ? sql`EXISTS (
                         SELECT 1 FROM follows f
                          WHERE f.follower_user_id = ${viewerUserId}
                            AND f.followed_user_id = u.id
                       )`
                 : sql`FALSE`
             } AS is_followed_by_me
        FROM users u
        LEFT JOIN primary_stats ps ON ps.user_id = u.id
       WHERE u.deleted_at IS NULL
         ${viewerUserId ? sql`AND u.id <> ${viewerUserId}` : sql``}
         ${
           viewerUserId
             ? sql`AND NOT EXISTS (
                     SELECT 1 FROM user_blocks ub
                      WHERE (ub.blocker_user_id = ${viewerUserId} AND ub.blocked_user_id = u.id)
                         OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ${viewerUserId})
                   )`
             : sql``
         }
         ${ilikeQ ? sql`AND (u.display_name ILIKE ${ilikeQ} OR u.email ILIKE ${ilikeQ})` : sql``}
         ${query.min_elo !== undefined ? sql`AND ps.elo_rating >= ${query.min_elo}` : sql``}
         ${query.max_elo !== undefined ? sql`AND ps.elo_rating <= ${query.max_elo}` : sql``}
         ${
           followingOnly && viewerUserId
             ? sql`AND EXISTS (
                     SELECT 1 FROM follows f
                      WHERE f.follower_user_id = ${viewerUserId}
                        AND f.followed_user_id = u.id
                   )`
             : sql``
         }
         ${
           hasGeo
             ? sql`AND u.home_lat IS NOT NULL AND u.home_lng IS NOT NULL
                   AND earth_box(
                         ll_to_earth(${query.lat}::float8, ${query.lng}::float8),
                         ${(query.radius_km ?? 0) * 1000}
                       ) @> ll_to_earth(u.home_lat::float8, u.home_lng::float8)`
             : sql``
         }
       ORDER BY ${
         hasGeo
           ? sql`distance_m ASC NULLS LAST`
           : sql`ps.elo_rating DESC NULLS LAST, u.created_at DESC`
       }
       LIMIT ${limit}
    `.execute(this.deps.db.db);

    return result.rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      photo_url: r.photo_url,
      primary_sport: r.primary_sport,
      primary_elo: r.primary_elo,
      // Mirror the nullability of `primary_elo` — we'd rather hide the chip
      // than stamp every fresh signup with a "beginner" badge.
      primary_skill_level: r.primary_elo === null ? null : skillLevelFromElo(r.primary_elo),
      reliability_score: r.reliability_score,
      distance_km: r.distance_m === null ? null : Math.round(Number(r.distance_m) / 10) / 100,
      followers_count: Number(r.followers_count),
      is_followed_by_me: r.is_followed_by_me,
      last_seen_at: r.last_seen_at === null ? null : r.last_seen_at.toISOString(),
    }));
  }

  // Tournaments moved to src/modules/tournaments.
}
