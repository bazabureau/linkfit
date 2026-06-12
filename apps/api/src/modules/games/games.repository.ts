import { sql } from "kysely";
import { type Executor } from "../../shared/db/withTransaction.js";
import { type GameStatus, type GameVisibility } from "../../shared/db/types.js";
import { type GameDetail, type GameSummary, type Participant } from "./games.types.js";

export interface GameInsertParams {
  sport_id: string;
  court_id: string | null;
  host_user_id: string;
  lat: number;
  lng: number;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  skill_min_elo: number | null;
  skill_max_elo: number | null;
  visibility: GameVisibility;
  notes: string | null;
}

export interface GamesSearchParams {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sportSlug?: string;
  from?: Date;
  to?: Date;
  cursorStartsAt?: Date;
  cursorId?: string;
  limit: number;
  /**
   * When the caller is authenticated, exclude games hosted by anyone the
   * viewer has blocked OR who has blocked the viewer. Bidirectional —
   * matches the semantics documented in the `user_blocks` migration. Left
   * undefined for anonymous calls so the public games list stays
   * deterministic for everyone.
   */
  viewerUserId?: string;
}

interface SummaryRow {
  id: string;
  sport_id: string;
  sport_slug: string;
  host_user_id: string;
  host_display_name: string;
  court_id: string | null;
  venue_name: string | null;
  venue_photo_url: string | null;
  lat: string;
  lng: string;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  participants_count: string;
  status: GameStatus;
  visibility: GameVisibility;
  skill_min_elo: number | null;
  skill_max_elo: number | null;
  distance_m: string | null;
}

function rowToSummary(r: SummaryRow): GameSummary {
  return {
    id: r.id,
    sport_id: r.sport_id,
    sport_slug: r.sport_slug,
    host_user_id: r.host_user_id,
    host_display_name: r.host_display_name,
    court_id: r.court_id,
    venue_name: r.venue_name,
    venue_photo_url: r.venue_photo_url ?? null,
    lat: Number(r.lat),
    lng: Number(r.lng),
    starts_at: r.starts_at.toISOString(),
    duration_minutes: r.duration_minutes,
    capacity: r.capacity,
    participants_count: Number(r.participants_count),
    status: r.status,
    visibility: r.visibility,
    skill_min_elo: r.skill_min_elo,
    skill_max_elo: r.skill_max_elo,
    distance_km: r.distance_m === null ? null : Math.round(Number(r.distance_m) / 10) / 100,
  };
}

export const gamesRepository = {
  async insert(db: Executor, params: GameInsertParams): Promise<string> {
    const row = await db
      .insertInto("games")
      .values({
        sport_id: params.sport_id,
        court_id: params.court_id,
        host_user_id: params.host_user_id,
        lat: params.lat.toString(),
        lng: params.lng.toString(),
        starts_at: params.starts_at,
        duration_minutes: params.duration_minutes,
        capacity: params.capacity,
        skill_min_elo: params.skill_min_elo,
        skill_max_elo: params.skill_max_elo,
        visibility: params.visibility,
        notes: params.notes,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  },

  async search(db: Executor, params: GamesSearchParams): Promise<GameSummary[]> {
    const {
      lat,
      lng,
      radiusKm,
      sportSlug,
      from,
      to,
      cursorStartsAt,
      cursorId,
      limit,
      viewerUserId,
    } = params;
    const hasGeo = lat !== undefined && lng !== undefined && radiusKm !== undefined;

    const result = await sql<SummaryRow>`
      SELECT
        g.id,
        g.sport_id,
        s.slug AS sport_slug,
        g.host_user_id,
        u.display_name AS host_display_name,
        g.court_id,
        v.name AS venue_name,
        v.photo_url AS venue_photo_url,
        g.lat,
        g.lng,
        g.starts_at,
        g.duration_minutes,
        g.capacity,
        (SELECT count(*) FROM game_participants gp
           WHERE gp.game_id = g.id AND gp.status = 'confirmed')::text AS participants_count,
        g.status,
        g.visibility,
        g.skill_min_elo,
        g.skill_max_elo,
        ${
          hasGeo
            ? sql`earth_distance(
                    ll_to_earth(${lat}::float8, ${lng}::float8),
                    ll_to_earth(g.lat::float8, g.lng::float8)
                  )::text`
            : sql`NULL::text`
        } AS distance_m
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users  u ON u.id = g.host_user_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE g.status IN ('open', 'full')
         AND g.visibility = 'public'
         AND g.deleted_at IS NULL
         AND u.deleted_at IS NULL
         ${
           hasGeo
             ? sql`AND (
                     (
                       earth_box(
                         ll_to_earth(${lat}::float8, ${lng}::float8),
                         ${radiusKm * 1000}
                       ) @> ll_to_earth(g.lat::float8, g.lng::float8)
                       AND earth_distance(
                             ll_to_earth(${lat}::float8, ${lng}::float8),
                             ll_to_earth(g.lat::float8, g.lng::float8)
                           ) <= ${radiusKm * 1000}
                     )
                     ${
                       viewerUserId !== undefined
                         ? sql`OR g.host_user_id = ${viewerUserId}::uuid`
                         : sql``
                     }
                   )`
             : sql``
         }
         ${sportSlug !== undefined ? sql`AND s.slug = ${sportSlug}` : sql``}
         ${from !== undefined ? sql`AND g.starts_at >= ${from}` : sql``}
         ${to !== undefined ? sql`AND g.starts_at <= ${to}` : sql``}
         ${
           cursorStartsAt !== undefined && cursorId !== undefined
             ? sql`AND (g.starts_at, g.id) > (${cursorStartsAt}, ${cursorId}::uuid)`
             : sql``
         }
         ${
           viewerUserId !== undefined
             ? sql`AND NOT EXISTS (
                     SELECT 1 FROM user_blocks ub
                      WHERE (ub.blocker_user_id = ${viewerUserId} AND ub.blocked_user_id = g.host_user_id)
                         OR (ub.blocker_user_id = g.host_user_id AND ub.blocked_user_id = ${viewerUserId})
                   )`
             : sql``
         }
       ORDER BY g.starts_at ASC, g.id ASC
       LIMIT ${limit + 1}
    `.execute(db);

    return result.rows.slice(0, limit).map(rowToSummary);
  },

  async findById(db: Executor, id: string): Promise<GameDetail | null> {
    const result = await sql<SummaryRow & { notes: string | null; created_at: Date }>`
      SELECT
        g.id, g.sport_id, s.slug AS sport_slug, g.host_user_id,
        u.display_name AS host_display_name, g.court_id, v.name AS venue_name,
        v.photo_url AS venue_photo_url,
        g.lat, g.lng, g.starts_at, g.duration_minutes, g.capacity,
        (SELECT count(*) FROM game_participants gp
           WHERE gp.game_id = g.id AND gp.status = 'confirmed')::text AS participants_count,
        g.status, g.visibility, g.skill_min_elo, g.skill_max_elo,
        NULL::text AS distance_m,
        g.notes, g.created_at
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users  u ON u.id = g.host_user_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE g.id = ${id}
         AND g.deleted_at IS NULL
    `.execute(db);
    const row = result.rows[0];
    if (!row) return null;

    const partResult = await db
      .selectFrom("game_participants as gp")
      .innerJoin("users as u", "u.id", "gp.user_id")
      .select([
        "gp.user_id as user_id",
        "u.display_name as display_name",
        "u.photo_url as photo_url",
        "gp.status as status",
        "gp.joined_at as joined_at",
      ])
      .where("gp.game_id", "=", id)
      .orderBy("gp.joined_at")
      .execute();
    const participants: Participant[] = partResult.map((p) => ({
      user_id: p.user_id,
      display_name: p.display_name,
      photo_url: p.photo_url,
      status: p.status,
      joined_at: p.joined_at.toISOString(),
    }));

    return {
      ...rowToSummary(row),
      notes: row.notes,
      created_at: row.created_at.toISOString(),
      participants,
    };
  },

  /**
   * Atomic join: succeeds only if (a) the game is still 'open' and not started,
   * AND (b) there's room. Returns true on success, false on capacity-exhausted
   * or game-not-joinable. Uses a single INSERT ... SELECT guarded by a count,
   * which is correct under SERIALIZABLE — Postgres will retry conflicting
   * txs. With READ COMMITTED (default) we additionally lock the game row.
   */
  async tryJoin(db: Executor, gameId: string, userId: string): Promise<"joined" | "full" | "not_joinable" | "already_in"> {
    // 1. Lock the game row.
    const lock = await sql<{
      id: string;
      capacity: number;
      starts_at: Date;
      status: GameStatus;
    }>`
      SELECT id, capacity, starts_at, status
        FROM games
       WHERE id = ${gameId}
       FOR UPDATE
    `.execute(db);
    const game = lock.rows[0];
    if (!game) return "not_joinable";
    if (game.status !== "open") return game.status === "full" ? "full" : "not_joinable";
    if (game.starts_at.getTime() <= Date.now()) return "not_joinable";

    // 2. Existing participant?
    const existing = await db
      .selectFrom("game_participants")
      .select(["status"])
      .where("game_id", "=", gameId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (existing?.status === "confirmed") return "already_in";

    // 3. Capacity check (only confirmed seats count).
    const count = await db
      .selectFrom("game_participants")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("game_id", "=", gameId)
      .where("status", "=", "confirmed")
      .executeTakeFirstOrThrow();
    if (Number(count.c) >= game.capacity) return "full";

    // 4. Insert or revive.
    if (existing) {
      await db
        .updateTable("game_participants")
        .set({ status: "confirmed", status_changed_at: new Date() })
        .where("game_id", "=", gameId)
        .where("user_id", "=", userId)
        .execute();
    } else {
      await db
        .insertInto("game_participants")
        .values({ game_id: gameId, user_id: userId, status: "confirmed" })
        .execute();
    }

    // 5. Flip to 'full' if we just filled the last seat.
    if (Number(count.c) + 1 >= game.capacity) {
      await db
        .updateTable("games")
        .set({ status: "full" })
        .where("id", "=", gameId)
        .execute();
    }

    return "joined";
  },

  async leave(db: Executor, gameId: string, userId: string): Promise<boolean> {
    const lock = await sql<{ status: GameStatus; starts_at: Date }>`
      SELECT status, starts_at FROM games WHERE id = ${gameId} FOR UPDATE
    `.execute(db);
    const game = lock.rows[0];
    if (!game) return false;

    const result = await db
      .updateTable("game_participants")
      .set({ status: "cancelled", status_changed_at: new Date() })
      .where("game_id", "=", gameId)
      .where("user_id", "=", userId)
      .where("status", "=", "confirmed")
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) return false;

    // Re-open the game if it was 'full'.
    if (game.status === "full") {
      await db.updateTable("games").set({ status: "open" }).where("id", "=", gameId).execute();
    }
    return true;
  },

  async markNoShow(db: Executor, gameId: string, hostId: string, targetId: string): Promise<"ok" | "not_host" | "not_started" | "not_participant"> {
    const game = await db
      .selectFrom("games")
      .select(["host_user_id", "starts_at"])
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) return "not_host";
    if (game.host_user_id !== hostId) return "not_host";
    if (game.starts_at.getTime() > Date.now()) return "not_started";

    const result = await db
      .updateTable("game_participants")
      .set({ status: "no_show", status_changed_at: new Date() })
      .where("game_id", "=", gameId)
      .where("user_id", "=", targetId)
      .where("status", "=", "confirmed")
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0 ? "ok" : "not_participant";
  },

  async update(
    db: Executor,
    gameId: string,
    hostId: string,
    patch: {
      starts_at?: Date;
      duration_minutes?: number;
      skill_min_elo?: number | null;
      skill_max_elo?: number | null;
      notes?: string | null;
      cancel?: boolean;
    },
  ): Promise<"ok" | "not_host" | "not_found"> {
    const game = await db
      .selectFrom("games")
      .select(["host_user_id", "status"])
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) return "not_found";
    if (game.host_user_id !== hostId) return "not_host";

    const set: Partial<{
      starts_at: Date;
      duration_minutes: number;
      skill_min_elo: number | null;
      skill_max_elo: number | null;
      notes: string | null;
      status: GameStatus;
    }> = {};
    if (patch.starts_at !== undefined) set.starts_at = patch.starts_at;
    if (patch.duration_minutes !== undefined) set.duration_minutes = patch.duration_minutes;
    if (patch.skill_min_elo !== undefined) set.skill_min_elo = patch.skill_min_elo;
    if (patch.skill_max_elo !== undefined) set.skill_max_elo = patch.skill_max_elo;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.cancel === true) set.status = "cancelled";
    if (Object.keys(set).length === 0) return "ok";

    await db.updateTable("games").set(set).where("id", "=", gameId).execute();
    return "ok";
  },

  /**
   * Soft-delete a game initiated by the host. Sets `deleted_at = now()`
   * which removes the row from every public read path (each repository
   * filters `deleted_at IS NULL`), but keeps it in the DB so participant /
   * rating / booking history still resolves. Only the host can soft-delete
   * their own game; admins use a separate path that's already wired into
   * `/api/v1/admin/games/:id`.
   *
   * Returns "ok" on success, "not_found" if the row doesn't exist or was
   * already soft-deleted (idempotent from the host's perspective), and
   * "not_host" if a non-host caller tries to delete.
   */
  async softDelete(
    db: Executor,
    gameId: string,
    hostId: string,
  ): Promise<"ok" | "not_host" | "not_found"> {
    const game = await db
      .selectFrom("games")
      .select(["host_user_id", "deleted_at"])
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) return "not_found";
    if (game.deleted_at !== null) return "not_found";
    if (game.host_user_id !== hostId) return "not_host";

    await db
      .updateTable("games")
      .set({ deleted_at: new Date() })
      .where("id", "=", gameId)
      .execute();
    return "ok";
  },
};
