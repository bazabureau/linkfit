import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  type SuggestedFollowItem,
  type SuggestedFollowsResponse,
} from "./schema.js";
import { skillLevelFromElo } from "../../shared/skill/skillLevel.js";

export interface SuggestedFollowsServiceDeps {
  db: DbHandle;
}

/**
 * Hard cap on the carousel size. Twenty is chosen to match the iOS
 * PlayersView design — beyond ~20 cards the horizontal scroll loses
 * affordance and tail-end candidates have very low signal anyway.
 */
const SUGGESTION_LIMIT = 20;

interface SuggestedFollowRow {
  user_id: string;
  display_name: string;
  photo_url: string | null;
  primary_elo: number | null;
  shared_games_count: string; // pg COUNT(...) lands as bigint -> string
}

/**
 * SuggestedFollowsService — ranks users the viewer should consider
 * following, prioritized by the number of confirmed games they've played
 * together (most-recently played wins ties via `last_seen_at`).
 *
 * v1 ranking pipeline (single SQL round-trip):
 *
 *   1. Resolve viewer's confirmed `game_participants` -> set of game_ids.
 *   2. Self-join `game_participants` on those game_ids to find OTHER users.
 *   3. GROUP BY other.user_id, COUNT(DISTINCT game_id) as shared_games_count.
 *   4. Exclude users the viewer ALREADY follows.
 *   5. Exclude bidirectional blocks (either direction).
 *   6. Exclude soft-deleted users.
 *   7. Enrich with `primary_elo` from `player_sport_stats` — the candidate's
 *      ELO on the sport they've played most (ties broken by sport_id ASC for
 *      stability, mirroring `MatchmakingService.recommendPlayers`).
 *   8. ORDER BY shared_games_count DESC, last_seen_at DESC NULLS LAST,
 *      display_name ASC. Stable across requests.
 *
 * The whole thing is one query so the iOS carousel renders in a single
 * round-trip. The ranking is deterministic — given the same DB state a
 * second call returns the same rows in the same order.
 */
export class SuggestedFollowsService {
  constructor(private readonly deps: SuggestedFollowsServiceDeps) {}

  async listForViewer(viewerUserId: string): Promise<SuggestedFollowsResponse> {
    const rows = await sql<SuggestedFollowRow>`
      WITH viewer_games AS (
        -- Games the viewer is a confirmed participant in. We pin to
        -- 'confirmed' so a cancelled/no_show row doesn't pollute the
        -- shared-history signal — those rows represent intent, not actual
        -- co-play.
        SELECT game_id
          FROM game_participants
         WHERE user_id = ${viewerUserId}::uuid
           AND status = 'confirmed'
      ),
      shared AS (
        -- OTHER confirmed participants on those same games. COUNT(DISTINCT
        -- game_id) protects against any future schema change that allows
        -- duplicate participant rows per game.
        SELECT gp.user_id,
               COUNT(DISTINCT gp.game_id) AS shared_games_count
          FROM game_participants gp
          JOIN viewer_games vg ON vg.game_id = gp.game_id
         WHERE gp.user_id <> ${viewerUserId}::uuid
           AND gp.status = 'confirmed'
         GROUP BY gp.user_id
      ),
      primary_stats AS (
        -- Per-user primary-sport ELO: the row with the most games_played,
        -- ties broken by sport_id ASC so the choice is stable. Mirrors the
        -- pattern in MatchmakingService.recommendPlayers.
        SELECT user_id,
               elo_rating,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id
                 ORDER BY games_played DESC, sport_id ASC
               ) AS rn
          FROM player_sport_stats
      )
      SELECT u.id AS user_id,
             u.display_name,
             u.photo_url,
             (SELECT elo_rating FROM primary_stats ps
               WHERE ps.user_id = u.id AND ps.rn = 1) AS primary_elo,
             s.shared_games_count::text AS shared_games_count
        FROM shared s
        JOIN users u ON u.id = s.user_id
       WHERE u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM follows f
            WHERE f.follower_user_id = ${viewerUserId}::uuid
              AND f.followed_user_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_user_id = ${viewerUserId}::uuid AND ub.blocked_user_id = u.id)
               OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ${viewerUserId}::uuid)
         )
       ORDER BY s.shared_games_count DESC,
                u.last_seen_at DESC NULLS LAST,
                u.display_name ASC
       LIMIT ${SUGGESTION_LIMIT}
    `.execute(this.deps.db.db);

    const items: SuggestedFollowItem[] = rows.rows.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      photo_url: r.photo_url,
      primary_elo: r.primary_elo,
      // `null` primary_elo falls through to `"beginner"` — see
      // `skillLevelFromElo`. Keeping `skill_level` non-null on this surface
      // because the iOS suggestion card always renders the chip.
      skill_level: skillLevelFromElo(r.primary_elo),
      // bigint -> number. The Postgres COUNT lands as a string by default;
      // we know it fits in a JS number because we LIMIT 20 well-shy of any
      // overflow risk and the value is the count of games shared with one
      // other user (bounded by viewer's total game history).
      shared_games_count: Number(r.shared_games_count),
      reason: "played_together" as const,
    }));

    return { items };
  }
}
