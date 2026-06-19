import { sql, type Updateable } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  type CourtTable,
  type GameTable,
  type TournamentTable,
  type VenueTable,
} from "../../shared/db/types.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { normalizeAzPhoneOrNull } from "../../shared/phone/phone.js";
import {
  type AdminBookingStatusValue,
  type AdminBookingsListQuery,
  type AdminGameCancelRequest,
  type AdminGameUpdateRequest,
  type AdminGamesListQuery,
  type AdminTournamentsListQuery,
  type AdminUsersListQuery,
  type AuditListQuery,
  type CreateCourtRequest,
  type CreateTournamentRequest,
  type CreateVenueRequest,
  type SetRoleRequest,
  type UpdateCourtRequest,
  type UpdateTournamentRequest,
  type UpdateVenueRequest,
} from "./admin.schema.js";
import {
  type AdminBookingsPage,
  type AdminCourtOut,
  type AdminGameDetail,
  type AdminGameRow,
  type AdminGamesPage,
  type AdminServiceDeps,
  type AdminStats,
  type AdminTournamentEntryOut,
  type AdminTournamentEntryStatus,
  type AdminTournamentOut,
  type AdminTournamentsPage,
  type AdminTournamentStatus,
  type AdminUsersPage,
  type AdminVenueOut,
  type AuditRowOut,
} from "./admin.types.js";

// ─────────────── cursor helpers (admin games keyset pagination) ───────────────

interface GamesCursorPayload {
  starts_at: string;
  id: string;
}

function encodeGamesCursor(p: GamesCursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

function decodeGamesCursor(raw: string): GamesCursorPayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<GamesCursorPayload>;
    if (typeof parsed.starts_at === "string" && typeof parsed.id === "string") {
      return { starts_at: parsed.starts_at, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export class AdminService {
  constructor(private readonly deps: AdminServiceDeps) {}

  /** Exposed so the route module can build the admin guard against the same
   *  db handle without duplicating wiring. */
  get db(): DbHandle {
    return this.deps.db;
  }

  // ───────────────────────────── stats ─────────────────────────────

  async stats(): Promise<AdminStats> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const totalUsersRow = await this.deps.db.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .executeTakeFirstOrThrow();

    const recentUsersRow = await this.deps.db.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("created_at", ">=", weekAgo)
      .executeTakeFirstOrThrow();

    const gamesThisWeekRow = await this.deps.db.db
      .selectFrom("games")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("starts_at", ">=", weekAgo)
      .where("starts_at", "<", new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))
      .executeTakeFirstOrThrow();

    const completedGamesRow = await this.deps.db.db
      .selectFrom("games")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("status", "=", "completed")
      .executeTakeFirstOrThrow();

    const topVenuesResult = await sql<{
      venue_id: string;
      venue_name: string;
      game_count: string;
    }>`
      SELECT v.id AS venue_id, v.name AS venue_name, count(*)::text AS game_count
        FROM games g
        JOIN courts c ON c.id = g.court_id
        JOIN venues v ON v.id = c.venue_id
       GROUP BY v.id, v.name
       ORDER BY count(*) DESC, v.name ASC
       LIMIT 5
    `.execute(this.deps.db.db);

    const pendingReportsRow = await this.deps.db.db
      .selectFrom("reports")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();

    return {
      total_users: Number(totalUsersRow.c),
      users_last_7_days: Number(recentUsersRow.c),
      games_this_week: Number(gamesThisWeekRow.c),
      games_completed_all_time: Number(completedGamesRow.c),
      top_venues: topVenuesResult.rows.map((r) => ({
        venue_id: r.venue_id,
        venue_name: r.venue_name,
        game_count: Number(r.game_count),
      })),
      pending_reports: Number(pendingReportsRow.c),
    };
  }

  // ───────────────────────────── users ─────────────────────────────

  async listUsers(query: AdminUsersListQuery): Promise<AdminUsersPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const term = query.q?.trim();
    const likeFilter = term && term.length > 0 ? `%${term}%` : null;

    const filterClause = likeFilter
      ? sql`WHERE (u.email ILIKE ${likeFilter} OR u.display_name ILIKE ${likeFilter})`
      : sql``;

    const rowsResult = await sql<{
      id: string;
      email: string;
      display_name: string;
      admin_role: "admin" | "moderator" | null;
      deleted_at: Date | null;
      created_at: Date;
      games_played_total: string;
    }>`
      SELECT u.id, u.email::text AS email, u.display_name, u.admin_role,
             u.deleted_at, u.created_at,
             COALESCE((
               SELECT count(*)::text
                 FROM game_participants gp
                WHERE gp.user_id = u.id
                  AND gp.status IN ('played','confirmed')
             ), '0') AS games_played_total
        FROM users u
        ${filterClause}
       ORDER BY u.created_at DESC, u.id ASC
       LIMIT ${limit} OFFSET ${offset}
    `.execute(this.deps.db.db);

    const totalResult = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM users u ${filterClause}
    `.execute(this.deps.db.db);

    return {
      items: rowsResult.rows.map((r) => ({
        id: r.id,
        email: r.email,
        display_name: r.display_name,
        admin_role: r.admin_role,
        deleted_at: r.deleted_at?.toISOString() ?? null,
        created_at: r.created_at.toISOString(),
        games_played_total: Number(r.games_played_total),
      })),
      total: Number(totalResult.rows[0]?.c ?? "0"),
    };
  }

  async setUserRole(adminId: string, userId: string, req: SetRoleRequest): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const target = await tx
        .selectFrom("users")
        .select(["id", "admin_role"])
        .where("id", "=", userId)
        .executeTakeFirst();
      if (!target) throw new NotFoundError("User not found");

      await tx
        .updateTable("users")
        .set({ admin_role: req.role })
        .where("id", "=", userId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.users.set_role",
          entity: "user",
          entity_id: userId,
          metadata: { previous: target.admin_role, next: req.role },
        })
        .execute();
    });
  }

  async softDeleteUser(adminId: string, userId: string): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const target = await tx
        .selectFrom("users")
        .select(["id", "deleted_at"])
        .where("id", "=", userId)
        .executeTakeFirst();
      if (!target) throw new NotFoundError("User not found");
      if (target.deleted_at !== null) {
        throw new ConflictError("User is already deleted");
      }

      await tx
        .updateTable("users")
        .set({ deleted_at: new Date() })
        .where("id", "=", userId)
        .execute();

      // Revoke every active refresh-token session so the user is logged out
      // everywhere immediately. Without this, an in-memory access token
      // could keep working until expiry.
      await tx
        .updateTable("refresh_tokens")
        .set({ revoked_at: new Date() })
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.users.soft_delete",
          entity: "user",
          entity_id: userId,
          metadata: {},
        })
        .execute();
    });
  }

  async restoreUser(adminId: string, userId: string): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const target = await tx
        .selectFrom("users")
        .select(["id", "deleted_at"])
        .where("id", "=", userId)
        .executeTakeFirst();
      if (!target) throw new NotFoundError("User not found");
      if (target.deleted_at === null) {
        throw new ConflictError("User is not deleted");
      }

      await tx
        .updateTable("users")
        .set({ deleted_at: null })
        .where("id", "=", userId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.users.restore",
          entity: "user",
          entity_id: userId,
          metadata: {},
        })
        .execute();
    });
  }

  // ───────────────────────────── games ─────────────────────────────

  async listGames(query: AdminGamesListQuery): Promise<AdminGamesPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    // We support both `cursor` (preferred — opaque starts_at:id pair) and
    // legacy `offset` for backward compatibility. Cursor wins when both arrive.
    const cursor = query.cursor ? decodeGamesCursor(query.cursor) : null;
    const offset = cursor ? 0 : Math.max(query.offset ?? 0, 0);
    const includeDeleted = Boolean(query.include_deleted);

    const filters: ReturnType<typeof sql>[] = [];
    if (!includeDeleted) {
      filters.push(sql`g.deleted_at IS NULL`);
    }
    if (query.status) {
      filters.push(sql`g.status = ${query.status}::game_status`);
    }
    if (query.sport) {
      filters.push(sql`s.slug = ${query.sport}`);
    }
    if (query.from) {
      filters.push(sql`g.starts_at >= ${new Date(query.from)}`);
    }
    if (query.to) {
      filters.push(sql`g.starts_at <= ${new Date(query.to)}`);
    }
    if (query.q) {
      const term = `%${query.q.trim()}%`;
      filters.push(sql`(u.display_name ILIKE ${term} OR v.name ILIKE ${term})`);
    }
    if (cursor) {
      // Keyset pagination: (starts_at DESC, id ASC) — give me everything
      // strictly older than the cursor's starts_at, or same starts_at with a
      // strictly larger id.
      filters.push(sql`(
        g.starts_at < ${new Date(cursor.starts_at)}
        OR (g.starts_at = ${new Date(cursor.starts_at)} AND g.id > ${cursor.id}::uuid)
      )`);
    }

    const whereClause = filters.length
      ? sql`WHERE ${sql.join(filters, sql` AND `)}`
      : sql``;

    const rowsResult = await sql<{
      id: string;
      sport_id: string;
      sport_slug: string;
      host_user_id: string;
      host_display_name: string;
      host_photo_url: string | null;
      venue_id: string | null;
      venue_name: string | null;
      lat: string;
      lng: string;
      starts_at: Date;
      duration_minutes: number;
      capacity: number;
      participants_count: string;
      status: "open" | "full" | "cancelled" | "completed";
      visibility: "public" | "invite";
      skill_min_elo: number | null;
      skill_max_elo: number | null;
      created_at: Date;
      deleted_at: Date | null;
    }>`
      SELECT g.id, g.sport_id, s.slug AS sport_slug, g.host_user_id,
             u.display_name AS host_display_name, u.photo_url AS host_photo_url,
             c.venue_id AS venue_id, v.name AS venue_name,
             g.lat::text AS lat, g.lng::text AS lng,
             g.starts_at, g.duration_minutes, g.capacity,
             COALESCE((
               SELECT count(*)::text FROM game_participants gp
                WHERE gp.game_id = g.id AND gp.status = 'confirmed'
             ), '0') AS participants_count,
             g.status, g.visibility,
             g.skill_min_elo, g.skill_max_elo,
             g.created_at, g.deleted_at
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users  u ON u.id = g.host_user_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
        ${whereClause}
       ORDER BY g.starts_at DESC, g.id ASC
       LIMIT ${limit + 1} OFFSET ${offset}
    `.execute(this.deps.db.db);

    // Total count uses the same WHERE clause minus the cursor predicate
    // (count is always "matching rows", not "remaining after cursor").
    const countFilters = filters.filter((_, i) => !(cursor && i === filters.length - 1));
    const countWhere = countFilters.length
      ? sql`WHERE ${sql.join(countFilters, sql` AND `)}`
      : sql``;
    const totalResult = await sql<{ c: string }>`
      SELECT count(*)::text AS c
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users u ON u.id = g.host_user_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
        ${countWhere}
    `.execute(this.deps.db.db);

    const hasMore = rowsResult.rows.length > limit;
    const pageRows = hasMore ? rowsResult.rows.slice(0, limit) : rowsResult.rows;
    const items: AdminGameRow[] = pageRows.map((r) => ({
      id: r.id,
      sport_id: r.sport_id,
      sport_slug: r.sport_slug,
      host_user_id: r.host_user_id,
      host_display_name: r.host_display_name,
      host_photo_url: r.host_photo_url,
      venue_id: r.venue_id,
      venue_name: r.venue_name,
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
      created_at: r.created_at.toISOString(),
      deleted_at: r.deleted_at?.toISOString() ?? null,
    }));

    const last = items[items.length - 1];
    return {
      items,
      total: Number(totalResult.rows[0]?.c ?? "0"),
      next_cursor:
        hasMore && last ? encodeGamesCursor({ starts_at: last.starts_at, id: last.id }) : null,
    };
  }

  async getGameDetail(gameId: string): Promise<AdminGameDetail> {
    const result = await sql<{
      id: string;
      sport_id: string;
      sport_slug: string;
      host_user_id: string;
      host_display_name: string;
      host_photo_url: string | null;
      venue_id: string | null;
      venue_name: string | null;
      lat: string;
      lng: string;
      starts_at: Date;
      duration_minutes: number;
      capacity: number;
      participants_count: string;
      status: "open" | "full" | "cancelled" | "completed";
      visibility: "public" | "invite";
      skill_min_elo: number | null;
      skill_max_elo: number | null;
      notes: string | null;
      created_at: Date;
      updated_at: Date;
      deleted_at: Date | null;
    }>`
      SELECT g.id, g.sport_id, s.slug AS sport_slug, g.host_user_id,
             u.display_name AS host_display_name, u.photo_url AS host_photo_url,
             c.venue_id AS venue_id, v.name AS venue_name,
             g.lat::text AS lat, g.lng::text AS lng,
             g.starts_at, g.duration_minutes, g.capacity,
             COALESCE((
               SELECT count(*)::text FROM game_participants gp
                WHERE gp.game_id = g.id AND gp.status = 'confirmed'
             ), '0') AS participants_count,
             g.status, g.visibility, g.skill_min_elo, g.skill_max_elo,
             g.notes, g.created_at, g.updated_at, g.deleted_at
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users  u ON u.id = g.host_user_id
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE g.id = ${gameId}
    `.execute(this.deps.db.db);

    const row = result.rows[0];
    if (!row) throw new NotFoundError("Game not found");

    const participantsResult = await sql<{
      user_id: string;
      display_name: string;
      photo_url: string | null;
      status: "confirmed" | "cancelled" | "no_show" | "played";
      joined_at: Date;
      status_changed_at: Date;
    }>`
      SELECT gp.user_id, pu.display_name, pu.photo_url, gp.status,
             gp.joined_at, gp.status_changed_at
        FROM game_participants gp
        JOIN users pu ON pu.id = gp.user_id
       WHERE gp.game_id = ${gameId}
       ORDER BY gp.joined_at ASC
    `.execute(this.deps.db.db);

    const auditResult = await sql<{
      id: string;
      actor_user_id: string | null;
      actor_display_name: string | null;
      action: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>`
      SELECT a.id, a.actor_user_id, au.display_name AS actor_display_name,
             a.action, a.metadata, a.created_at
        FROM audit_log a
        LEFT JOIN users au ON au.id = a.actor_user_id
       WHERE a.entity = 'game' AND a.entity_id = ${gameId}
       ORDER BY a.created_at ASC, a.id ASC
    `.execute(this.deps.db.db);

    return {
      id: row.id,
      sport_id: row.sport_id,
      sport_slug: row.sport_slug,
      host_user_id: row.host_user_id,
      host_display_name: row.host_display_name,
      host_photo_url: row.host_photo_url,
      venue_id: row.venue_id,
      venue_name: row.venue_name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      starts_at: row.starts_at.toISOString(),
      duration_minutes: row.duration_minutes,
      capacity: row.capacity,
      participants_count: Number(row.participants_count),
      status: row.status,
      visibility: row.visibility,
      skill_min_elo: row.skill_min_elo,
      skill_max_elo: row.skill_max_elo,
      notes: row.notes,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      deleted_at: row.deleted_at?.toISOString() ?? null,
      participants: participantsResult.rows.map((p) => ({
        user_id: p.user_id,
        display_name: p.display_name,
        photo_url: p.photo_url,
        status: p.status,
        joined_at: p.joined_at.toISOString(),
        status_changed_at: p.status_changed_at.toISOString(),
      })),
      status_changes: auditResult.rows.map((a) => ({
        id: a.id,
        actor_user_id: a.actor_user_id,
        actor_display_name: a.actor_display_name,
        action: a.action,
        metadata: a.metadata,
        created_at: a.created_at.toISOString(),
      })),
    };
  }

  /**
   * Force-cancel a game on behalf of an admin, regardless of host. Confirmed
   * participants get notified so they know their plan was nuked. Idempotent —
   * cancelling an already-cancelled game is a no-op (no extra audit row).
   */
  async cancelGame(
    adminId: string,
    gameId: string,
    req: AdminGameCancelRequest = {},
  ): Promise<void> {
    const game = await this.deps.db.db
      .selectFrom("games")
      .selectAll()
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) throw new NotFoundError("Game not found");
    if (game.status === "cancelled") return;

    // Collect participants BEFORE the update so we know who to ping.
    const participants = await this.deps.db.db
      .selectFrom("game_participants")
      .select("user_id")
      .where("game_id", "=", gameId)
      .where("status", "=", "confirmed")
      .execute();

    const reason = req.reason?.trim() ?? null;

    await withTransaction(this.deps.db.db, async (tx) => {
      await tx
        .updateTable("games")
        .set({ status: "cancelled" })
        .where("id", "=", gameId)
        .execute();

      await tx
        .updateTable("game_participants")
        .set({ status: "cancelled", status_changed_at: new Date() })
        .where("game_id", "=", gameId)
        .where("status", "=", "confirmed")
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.games.cancel",
          entity: "game",
          entity_id: gameId,
          metadata: {
            previous_status: game.status,
            notified: participants.length,
            ...(reason ? { reason } : {}),
          },
        })
        .execute();
    });

    // Fan out notifications post-tx. We accept that a notification failure
    // doesn't roll back the cancellation — the cancellation is the source of
    // truth and the user can still see it on the game list.
    for (const p of participants) {
      await this.deps.notifications.emit({
        userId: p.user_id,
        type: "game_cancelled",
        title: "Game cancelled",
        body: reason ?? "An administrator cancelled a game you were in",
        payload: { game_id: gameId, by: "admin", reason: reason ?? undefined },
      });
    }
  }

  /**
   * Moderation patch: small focused updates to game fields. Status changes
   * here do NOT emit cancellation side-effects (use `cancelGame` for that);
   * the field is exposed purely for fixing data (e.g. flipping a `full` game
   * back to `open` after a participant withdrew, or bumping `capacity`).
   */
  async updateGame(
    adminId: string,
    gameId: string,
    req: AdminGameUpdateRequest,
  ): Promise<AdminGameDetail> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("games")
        .selectAll()
        .where("id", "=", gameId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Game not found");
      if (existing.deleted_at !== null) {
        throw new ConflictError("Game is deleted; restore before editing");
      }

      const patch: Updateable<GameTable> = {};
      if (req.status !== undefined) patch.status = req.status;
      if (req.capacity !== undefined) {
        if (req.capacity < (existing.capacity > 0 ? 2 : 2)) {
          throw new ValidationError("Capacity must be at least 2");
        }
        // Make sure we don't shrink capacity below confirmed participants.
        const confirmed = await tx
          .selectFrom("game_participants")
          .select((eb) => eb.fn.countAll<string>().as("c"))
          .where("game_id", "=", gameId)
          .where("status", "=", "confirmed")
          .executeTakeFirstOrThrow();
        if (Number(confirmed.c) > req.capacity) {
          throw new ConflictError(
            "Capacity is lower than the number of confirmed participants",
          );
        }
        patch.capacity = req.capacity;
      }
      if (req.notes !== undefined) patch.notes = req.notes;
      if (req.skill_min_elo !== undefined) patch.skill_min_elo = req.skill_min_elo;
      if (req.skill_max_elo !== undefined) patch.skill_max_elo = req.skill_max_elo;

      const min = req.skill_min_elo ?? existing.skill_min_elo;
      const max = req.skill_max_elo ?? existing.skill_max_elo;
      if (min !== null && max !== null && min > max) {
        throw new ValidationError("skill_min_elo cannot exceed skill_max_elo");
      }

      await tx.updateTable("games").set(patch).where("id", "=", gameId).execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.games.update",
          entity: "game",
          entity_id: gameId,
          metadata: {
            fields: Object.keys(patch),
            ...(req.status !== undefined
              ? { previous_status: existing.status, next_status: req.status }
              : {}),
          },
        })
        .execute();
    });

    return this.getGameDetail(gameId);
  }

  /**
   * Soft-delete a game by setting `deleted_at`. Only cancelled or completed
   * games can be soft-deleted — refuse otherwise to keep accidental nukes
   * out of the funnel. Re-deleting is a no-op.
   */
  async softDeleteGame(adminId: string, gameId: string): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const game = await tx
        .selectFrom("games")
        .select(["id", "status", "deleted_at"])
        .where("id", "=", gameId)
        .executeTakeFirst();
      if (!game) throw new NotFoundError("Game not found");
      if (game.deleted_at !== null) return;
      if (game.status !== "cancelled" && game.status !== "completed") {
        throw new ConflictError(
          "Only cancelled or completed games can be deleted",
        );
      }

      await tx
        .updateTable("games")
        .set({ deleted_at: new Date() })
        .where("id", "=", gameId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.games.soft_delete",
          entity: "game",
          entity_id: gameId,
          metadata: { previous_status: game.status },
        })
        .execute();
    });
  }

  // ───────────────────────────── venues ─────────────────────────────

  async createVenue(adminId: string, req: CreateVenueRequest): Promise<AdminVenueOut> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await tx
        .insertInto("venues")
        .values({
          name: req.name,
          address: req.address,
          lat: req.lat.toString(),
          lng: req.lng.toString(),
          // Normalise so two admins typing `0551234567` and `+994551234567`
          // for the same venue store the same value.
          phone: normalizeAzPhoneOrNull(req.phone),
          description: req.description ?? null,
          photo_url: req.photo_url ?? null,
          is_partner: req.is_partner,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.venues.create",
          entity: "venue",
          entity_id: row.id,
          metadata: { name: row.name },
        })
        .execute();

      return this.venueRowToOut(row);
    });
  }

  async updateVenue(
    adminId: string,
    venueId: string,
    req: UpdateVenueRequest,
  ): Promise<AdminVenueOut> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const patch: Updateable<VenueTable> = {};
      if (req.name !== undefined) patch.name = req.name;
      if (req.address !== undefined) patch.address = req.address;
      if (req.lat !== undefined) patch.lat = req.lat.toString();
      if (req.lng !== undefined) patch.lng = req.lng.toString();
      if (req.phone !== undefined) patch.phone = normalizeAzPhoneOrNull(req.phone);
      if (req.description !== undefined) patch.description = req.description;
      if (req.photo_url !== undefined) patch.photo_url = req.photo_url;
      if (req.is_partner !== undefined) patch.is_partner = req.is_partner;

      const row = await tx
        .updateTable("venues")
        .set(patch)
        .where("id", "=", venueId)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Venue not found");

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.venues.update",
          entity: "venue",
          entity_id: venueId,
          metadata: { fields: Object.keys(patch) },
        })
        .execute();

      return this.venueRowToOut(row);
    });
  }

  async deleteVenue(adminId: string, venueId: string): Promise<void> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const venue = await tx
        .selectFrom("venues")
        .select("id")
        .where("id", "=", venueId)
        .executeTakeFirst();
      if (!venue) throw new NotFoundError("Venue not found");

      // Deletion is blocked when any future game still references this
      // venue's courts. We don't want to nuke a venue out from under a
      // scheduled match.
      const conflict = await tx
        .selectFrom("games as g")
        .innerJoin("courts as c", "c.id", "g.court_id")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("c.venue_id", "=", venueId)
        .where("g.starts_at", ">", new Date())
        .where("g.status", "in", ["open", "full"])
        .executeTakeFirstOrThrow();
      if (Number(conflict.c) > 0) {
        throw new ConflictError(
          "Cannot delete venue: future games reference its courts",
        );
      }

      await tx.deleteFrom("venues").where("id", "=", venueId).execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.venues.delete",
          entity: "venue",
          entity_id: venueId,
          metadata: {},
        })
        .execute();
    });
  }

  // ───────────────────────────── tournaments ─────────────────────────────

  /**
   * Cursor-paginated tournament listing. Cursor is base64(`<created_at>|<id>`)
   * descending so newest tournaments float to the top. Filters: status
   * (exact), sport (slug), q (ILIKE on name / description).
   */
  async listTournaments(
    query: AdminTournamentsListQuery,
  ): Promise<AdminTournamentsPage> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const term = query.q?.trim();
    const likeFilter = term && term.length > 0 ? `%${term}%` : null;

    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (query.cursor) {
      try {
        const decoded = Buffer.from(query.cursor, "base64").toString("utf8");
        const [iso, id] = decoded.split("|");
        if (iso && id) {
          const d = new Date(iso);
          if (!Number.isNaN(d.getTime())) {
            cursorCreatedAt = d;
            cursorId = id;
          }
        }
      } catch {
        /* Bad cursor → ignore and start from the top. */
      }
    }

    const filters: ReturnType<typeof sql>[] = [];
    if (query.status) filters.push(sql`t.status = ${query.status}::tournament_status`);
    if (query.sport) filters.push(sql`s.slug = ${query.sport}`);
    if (likeFilter) {
      filters.push(
        sql`(t.name ILIKE ${likeFilter} OR t.description ILIKE ${likeFilter})`,
      );
    }
    if (cursorCreatedAt && cursorId) {
      filters.push(
        sql`(t.created_at, t.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)`,
      );
    }
    const whereClause = filters.length
      ? sql`WHERE ${sql.join(filters, sql` AND `)}`
      : sql``;

    const rowsResult = await sql<{
      id: string;
      name: string;
      description: string | null;
      sport_id: string;
      sport_slug: string;
      sport_name: string;
      venue_id: string | null;
      venue_name: string | null;
      starts_at: Date;
      ends_at: Date;
      registration_deadline: Date | null;
      max_squads: number;
      squad_size: number;
      entry_fee_minor: number;
      currency: string;
      status: AdminTournamentStatus;
      entries_count: string;
      created_at: Date;
    }>`
      SELECT t.id, t.name, t.description, t.sport_id,
             s.slug AS sport_slug, s.name AS sport_name,
             t.venue_id, v.name AS venue_name,
             t.starts_at, t.ends_at, t.registration_deadline,
             t.max_squads, t.squad_size, t.entry_fee_minor, t.currency,
             t.status, t.created_at,
             COALESCE((
               SELECT count(*)::text FROM tournament_entries te
                WHERE te.tournament_id = t.id
                  AND te.status IN ('pending','confirmed')
             ), '0') AS entries_count
        FROM tournaments t
        JOIN sports s ON s.id = t.sport_id
        LEFT JOIN venues v ON v.id = t.venue_id
        ${whereClause}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ${limit + 1}
    `.execute(this.deps.db.db);

    const rowsArr = rowsResult.rows;
    const hasMore = rowsArr.length > limit;
    const page = hasMore ? rowsArr.slice(0, limit) : rowsArr;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString("base64")
        : null;

    return {
      items: page.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        sport_id: r.sport_id,
        sport_slug: r.sport_slug,
        sport_name: r.sport_name,
        venue_id: r.venue_id,
        venue_name: r.venue_name,
        starts_at: r.starts_at.toISOString(),
        ends_at: r.ends_at.toISOString(),
        registration_deadline: r.registration_deadline?.toISOString() ?? null,
        max_squads: r.max_squads,
        squad_size: r.squad_size,
        entry_fee_minor: r.entry_fee_minor,
        currency: r.currency,
        status: r.status,
        entries_count: Number(r.entries_count),
        created_at: r.created_at.toISOString(),
      })),
      next_cursor: nextCursor,
    };
  }

  async createTournament(
    adminId: string,
    req: CreateTournamentRequest,
  ): Promise<AdminTournamentOut> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await tx
        .insertInto("tournaments")
        .values({
          name: req.name,
          description: req.description ?? null,
          sport_id: req.sport_id,
          venue_id: req.venue_id ?? null,
          starts_at: new Date(req.starts_at),
          ends_at: new Date(req.ends_at),
          registration_deadline:
            req.registration_deadline !== undefined && req.registration_deadline !== null
              ? new Date(req.registration_deadline)
              : null,
          max_squads: req.max_squads,
          squad_size: req.squad_size,
          entry_fee_minor: req.entry_fee_minor,
          currency: req.currency,
          ...(req.status !== undefined ? { status: req.status } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.tournaments.create",
          entity: "tournament",
          entity_id: row.id,
          metadata: { name: row.name, status: row.status },
        })
        .execute();

      return this.tournamentRowToOut(row);
    });
  }

  async updateTournament(
    adminId: string,
    tournamentId: string,
    req: UpdateTournamentRequest,
  ): Promise<AdminTournamentOut> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("tournaments")
        .select(["id", "status"])
        .where("id", "=", tournamentId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Tournament not found");

      // Tiny state-machine: terminal states are sticky. Admin can still
      // transition any non-terminal status into anything else.
      if (req.status !== undefined && req.status !== existing.status) {
        if (existing.status === "completed" && req.status !== "completed") {
          throw new ConflictError("Completed tournaments cannot change status");
        }
        if (existing.status === "cancelled" && req.status !== "cancelled") {
          throw new ConflictError("Cancelled tournaments cannot change status");
        }
      }

      const patch: Updateable<TournamentTable> = {};
      if (req.name !== undefined) patch.name = req.name;
      if (req.description !== undefined) patch.description = req.description;
      if (req.sport_id !== undefined) patch.sport_id = req.sport_id;
      if (req.venue_id !== undefined) patch.venue_id = req.venue_id;
      if (req.starts_at !== undefined) patch.starts_at = new Date(req.starts_at);
      if (req.ends_at !== undefined) patch.ends_at = new Date(req.ends_at);
      if (req.registration_deadline !== undefined) {
        patch.registration_deadline =
          req.registration_deadline !== null
            ? new Date(req.registration_deadline)
            : null;
      }
      if (req.max_squads !== undefined) patch.max_squads = req.max_squads;
      if (req.squad_size !== undefined) patch.squad_size = req.squad_size;
      if (req.entry_fee_minor !== undefined) patch.entry_fee_minor = req.entry_fee_minor;
      if (req.currency !== undefined) patch.currency = req.currency;
      if (req.status !== undefined) patch.status = req.status;

      const row = await tx
        .updateTable("tournaments")
        .set(patch)
        .where("id", "=", tournamentId)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Tournament not found");

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.tournaments.update",
          entity: "tournament",
          entity_id: tournamentId,
          metadata: { fields: Object.keys(patch) },
        })
        .execute();

      return this.tournamentRowToOut(row);
    });
  }

  /**
   * Soft-cancel: flips status to `cancelled` and writes an audit row.
   * Idempotent — cancelling an already-cancelled tournament is a no-op.
   * Completed tournaments cannot be cancelled (409).
   */
  async deleteTournament(adminId: string, tournamentId: string): Promise<void> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const tournament = await tx
        .selectFrom("tournaments")
        .select(["id", "status"])
        .where("id", "=", tournamentId)
        .executeTakeFirst();
      if (!tournament) throw new NotFoundError("Tournament not found");
      if (tournament.status === "cancelled") return;
      if (tournament.status === "completed") {
        throw new ConflictError("Cannot cancel a completed tournament");
      }

      await tx
        .updateTable("tournaments")
        .set({ status: "cancelled" })
        .where("id", "=", tournamentId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.tournaments.cancel",
          entity: "tournament",
          entity_id: tournamentId,
          metadata: { previous_status: tournament.status },
        })
        .execute();
    });
  }

  async listTournamentEntries(
    tournamentId: string,
  ): Promise<AdminTournamentEntryOut[]> {
    const t = await this.deps.db.db
      .selectFrom("tournaments")
      .select("id")
      .where("id", "=", tournamentId)
      .executeTakeFirst();
    if (!t) throw new NotFoundError("Tournament not found");

    const rows = await sql<{
      id: string;
      tournament_id: string;
      captain_user_id: string;
      captain_display_name: string;
      captain_photo_url: string | null;
      squad_name: string;
      player_ids: string[];
      status: AdminTournamentEntryStatus;
      created_at: Date;
    }>`
      SELECT te.id, te.tournament_id, te.captain_user_id,
             u.display_name AS captain_display_name,
             u.photo_url    AS captain_photo_url,
             te.squad_name, te.player_ids, te.status, te.created_at
        FROM tournament_entries te
        JOIN users u ON u.id = te.captain_user_id
       WHERE te.tournament_id = ${tournamentId}
       ORDER BY te.created_at ASC
    `.execute(this.deps.db.db);

    if (rows.rows.length === 0) return [];

    const allPlayerIds = new Set<string>();
    for (const r of rows.rows) for (const p of r.player_ids) allPlayerIds.add(p);
    const playerNameMap = new Map<string, string>();
    if (allPlayerIds.size > 0) {
      const userRows = await this.deps.db.db
        .selectFrom("users")
        .select(["id", "display_name"])
        .where("id", "in", [...allPlayerIds])
        .execute();
      for (const u of userRows) playerNameMap.set(u.id, u.display_name);
    }

    return rows.rows.map((r) => ({
      id: r.id,
      tournament_id: r.tournament_id,
      captain_user_id: r.captain_user_id,
      captain_display_name: r.captain_display_name,
      captain_photo_url: r.captain_photo_url,
      squad_name: r.squad_name,
      player_ids: r.player_ids,
      player_names: r.player_ids.map((id) => playerNameMap.get(id) ?? "Unknown"),
      status: r.status,
      created_at: r.created_at.toISOString(),
    }));
  }

  /**
   * Admin force-withdraw of a squad. Flips status to `withdrawn` and writes
   * an audit row. Captain self-withdraw lives on the public tournaments route.
   */
  async removeTournamentEntry(
    adminId: string,
    tournamentId: string,
    entryId: string,
  ): Promise<void> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const entry = await tx
        .selectFrom("tournament_entries")
        .select(["id", "tournament_id", "captain_user_id", "squad_name", "status"])
        .where("id", "=", entryId)
        .where("tournament_id", "=", tournamentId)
        .executeTakeFirst();
      if (!entry) throw new NotFoundError("Squad not found");
      if (entry.status === "withdrawn") return;

      await tx
        .updateTable("tournament_entries")
        .set({ status: "withdrawn" })
        .where("id", "=", entryId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.tournaments.remove_entry",
          entity: "tournament_entry",
          entity_id: entryId,
          metadata: {
            tournament_id: tournamentId,
            captain_user_id: entry.captain_user_id,
            squad_name: entry.squad_name,
            previous_status: entry.status,
          },
        })
        .execute();
    });
  }

  // ───────────────────────────── audit log ─────────────────────────────

  async listAudit(query: AuditListQuery): Promise<AuditRowOut[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = await sql<{
      id: string;
      actor_user_id: string | null;
      actor_display_name: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>`
      SELECT a.id, a.actor_user_id, u.display_name AS actor_display_name,
             a.action, a.entity, a.entity_id, a.metadata, a.created_at
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${limit} OFFSET ${offset}
    `.execute(this.deps.db.db);

    return rows.rows.map((r) => ({
      id: r.id,
      actor_user_id: r.actor_user_id,
      actor_display_name: r.actor_display_name,
      action: r.action,
      entity: r.entity,
      entity_id: r.entity_id,
      metadata: r.metadata,
      created_at: r.created_at.toISOString(),
    }));
  }

  // ───────────────────────────── internals ─────────────────────────────

  private venueRowToOut(row: {
    id: string;
    name: string;
    address: string;
    lat: string;
    lng: string;
    phone: string | null;
    description: string | null;
    photo_url: string | null;
    is_partner: boolean;
    created_at: Date;
  }): AdminVenueOut {
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      lat: Number(row.lat),
      lng: Number(row.lng),
      phone: row.phone,
      description: row.description,
      photo_url: row.photo_url,
      is_partner: row.is_partner,
      created_at: row.created_at.toISOString(),
    };
  }

  // ───────────────────────────── courts ─────────────────────────────

  async listCourtsForVenue(venueId: string): Promise<AdminCourtOut[]> {
    const venue = await this.deps.db.db
      .selectFrom("venues")
      .select("id")
      .where("id", "=", venueId)
      .executeTakeFirst();
    if (!venue) throw new NotFoundError("Venue not found");

    const rows = await this.deps.db.db
      .selectFrom("courts")
      .innerJoin("sports", "sports.id", "courts.sport_id")
      .select([
        "courts.id as id",
        "courts.venue_id as venue_id",
        "courts.sport_id as sport_id",
        "sports.slug as sport_slug",
        "courts.name as name",
        "courts.hourly_price_minor as hourly_price_minor",
        "courts.currency as currency",
        "courts.created_at as created_at",
      ])
      .where("courts.venue_id", "=", venueId)
      .orderBy("courts.name")
      .execute();

    return rows.map((r) => ({
      id: r.id,
      venue_id: r.venue_id,
      sport_id: r.sport_id,
      sport_slug: r.sport_slug,
      name: r.name,
      hourly_price_minor: r.hourly_price_minor,
      currency: r.currency,
      created_at: r.created_at.toISOString(),
    }));
  }

  async createCourt(
    adminId: string,
    venueId: string,
    req: CreateCourtRequest,
  ): Promise<AdminCourtOut> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const venue = await tx
        .selectFrom("venues")
        .select("id")
        .where("id", "=", venueId)
        .executeTakeFirst();
      if (!venue) throw new NotFoundError("Venue not found");

      const sport = await tx
        .selectFrom("sports")
        .select(["id", "slug"])
        .where("id", "=", req.sport_id)
        .executeTakeFirst();
      if (!sport) throw new ValidationError("Unknown sport_id");

      // Honor the (venue_id, name) UNIQUE constraint with a friendly error.
      const dupe = await tx
        .selectFrom("courts")
        .select("id")
        .where("venue_id", "=", venueId)
        .where("name", "=", req.name)
        .executeTakeFirst();
      if (dupe) throw new ConflictError("A court with that name already exists for this venue");

      const inserted = await tx
        .insertInto("courts")
        .values({
          venue_id: venueId,
          sport_id: req.sport_id,
          name: req.name,
          hourly_price_minor: req.hourly_price_minor,
          ...(req.currency ? { currency: req.currency } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.courts.create",
          entity: "court",
          entity_id: inserted.id,
          metadata: { venue_id: venueId, name: inserted.name },
        })
        .execute();

      return {
        id: inserted.id,
        venue_id: inserted.venue_id,
        sport_id: inserted.sport_id,
        sport_slug: sport.slug,
        name: inserted.name,
        hourly_price_minor: inserted.hourly_price_minor,
        currency: inserted.currency,
        created_at: inserted.created_at.toISOString(),
      };
    });
  }

  async updateCourt(
    adminId: string,
    venueId: string,
    courtId: string,
    req: UpdateCourtRequest,
  ): Promise<AdminCourtOut> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("courts")
        .selectAll()
        .where("id", "=", courtId)
        .where("venue_id", "=", venueId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Court not found");

      const patch: Updateable<CourtTable> = {};
      if (req.sport_id !== undefined) patch.sport_id = req.sport_id;
      if (req.name !== undefined) patch.name = req.name;
      if (req.hourly_price_minor !== undefined) patch.hourly_price_minor = req.hourly_price_minor;
      if (req.currency !== undefined) patch.currency = req.currency;

      if (req.sport_id !== undefined && req.sport_id !== existing.sport_id) {
        const sport = await tx
          .selectFrom("sports")
          .select("id")
          .where("id", "=", req.sport_id)
          .executeTakeFirst();
        if (!sport) throw new ValidationError("Unknown sport_id");
      }

      if (req.name !== undefined && req.name !== existing.name) {
        const dupe = await tx
          .selectFrom("courts")
          .select("id")
          .where("venue_id", "=", venueId)
          .where("name", "=", req.name)
          .executeTakeFirst();
        if (dupe) throw new ConflictError("A court with that name already exists for this venue");
      }

      const updated = await tx
        .updateTable("courts")
        .set(patch)
        .where("id", "=", courtId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const sport = await tx
        .selectFrom("sports")
        .select(["slug"])
        .where("id", "=", updated.sport_id)
        .executeTakeFirstOrThrow();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.courts.update",
          entity: "court",
          entity_id: courtId,
          metadata: { fields: Object.keys(patch) },
        })
        .execute();

      return {
        id: updated.id,
        venue_id: updated.venue_id,
        sport_id: updated.sport_id,
        sport_slug: sport.slug,
        name: updated.name,
        hourly_price_minor: updated.hourly_price_minor,
        currency: updated.currency,
        created_at: updated.created_at.toISOString(),
      };
    });
  }

  async deleteCourt(adminId: string, venueId: string, courtId: string): Promise<void> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("courts")
        .select("id")
        .where("id", "=", courtId)
        .where("venue_id", "=", venueId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Court not found");

      // Block deletion if any future open/full game references this court.
      const conflict = await tx
        .selectFrom("games")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("court_id", "=", courtId)
        .where("starts_at", ">", new Date())
        .where("status", "in", ["open", "full"])
        .executeTakeFirstOrThrow();
      if (Number(conflict.c) > 0) {
        throw new ConflictError(
          "Cannot delete court: future games reference it",
        );
      }

      await tx.deleteFrom("courts").where("id", "=", courtId).execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.courts.delete",
          entity: "court",
          entity_id: courtId,
          metadata: { venue_id: venueId },
        })
        .execute();
    });
  }

  private tournamentRowToOut(row: {
    id: string;
    name: string;
    description: string | null;
    sport_id: string;
    venue_id: string | null;
    starts_at: Date;
    ends_at: Date;
    registration_deadline: Date | null;
    max_squads: number;
    squad_size: number;
    entry_fee_minor: number;
    currency: string;
    status: AdminTournamentOut["status"];
    created_at: Date;
  }): AdminTournamentOut {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sport_id: row.sport_id,
      venue_id: row.venue_id,
      starts_at: row.starts_at.toISOString(),
      ends_at: row.ends_at.toISOString(),
      registration_deadline: row.registration_deadline?.toISOString() ?? null,
      max_squads: row.max_squads,
      squad_size: row.squad_size,
      entry_fee_minor: row.entry_fee_minor,
      currency: row.currency,
      status: row.status,
      created_at: row.created_at.toISOString(),
    };
  }

  // ───────────────────────────── bookings ─────────────────────────────

  async listBookings(query: AdminBookingsListQuery): Promise<AdminBookingsPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const filters: ReturnType<typeof sql>[] = [];

    if (query.status) {
      filters.push(sql`b.status::text = ${query.status}`);
    }
    if (query.venue_id) {
      filters.push(sql`c.venue_id = ${query.venue_id}::uuid`);
    }
    if (query.court_id) {
      filters.push(sql`b.court_id = ${query.court_id}::uuid`);
    }
    if (query.from) {
      filters.push(sql`b.starts_at >= ${new Date(query.from)}`);
    }
    if (query.to) {
      filters.push(sql`b.starts_at <= ${new Date(query.to)}`);
    }
    if (query.q) {
      const term = `%${query.q.trim()}%`;
      filters.push(sql`(u.display_name ILIKE ${term} OR u.email::text ILIKE ${term})`);
    }

    const whereClause = filters.length
      ? sql`WHERE ${sql.join(filters, sql` AND `)}`
      : sql``;

    const rowsResult = await sql<{
      id: string;
      game_id: string | null;
      court_id: string;
      court_name: string;
      user_id: string;
      booker_display_name: string;
      booker_email: string;
      venue_id: string;
      venue_name: string;
      starts_at: Date;
      duration_minutes: number;
      total_minor: number;
      currency: string;
      status: AdminBookingStatusValue;
      idempotency_key: string;
      external_ref: string | null;
      created_at: Date;
      paid_at: Date | null;
      cancelled_at: Date | null;
    }>`
      SELECT b.id, b.game_id, b.court_id, c.name AS court_name,
             b.user_id, u.display_name AS booker_display_name, u.email::text AS booker_email,
             c.venue_id, v.name AS venue_name,
             b.starts_at, b.duration_minutes, b.total_minor, b.currency,
             b.status, b.idempotency_key, b.external_ref,
             b.created_at, b.paid_at, b.cancelled_at
        FROM bookings b
        JOIN courts c ON c.id = b.court_id
        JOIN venues v ON v.id = c.venue_id
        JOIN users u ON u.id = b.user_id
        ${whereClause}
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ${limit} OFFSET ${offset}
    `.execute(this.deps.db.db);

    const totalResult = await sql<{ c: string }>`
      SELECT count(*)::text AS c
        FROM bookings b
        JOIN courts c ON c.id = b.court_id
        JOIN venues v ON v.id = c.venue_id
        JOIN users u ON u.id = b.user_id
        ${whereClause}
    `.execute(this.deps.db.db);

    return {
      items: rowsResult.rows.map((r) => ({
        id: r.id,
        game_id: r.game_id,
        court_id: r.court_id,
        court_name: r.court_name,
        user_id: r.user_id,
        booker_display_name: r.booker_display_name,
        booker_email: r.booker_email,
        venue_id: r.venue_id,
        venue_name: r.venue_name,
        starts_at: r.starts_at.toISOString(),
        duration_minutes: r.duration_minutes,
        total_minor: r.total_minor,
        currency: r.currency,
        status: r.status,
        idempotency_key: r.idempotency_key,
        external_ref: r.external_ref,
        created_at: r.created_at.toISOString(),
        paid_at: r.paid_at?.toISOString() ?? null,
        cancelled_at: r.cancelled_at?.toISOString() ?? null,
      })),
      total: Number(totalResult.rows[0]?.c ?? "0"),
    };
  }

  async adminCancelBooking(adminId: string, bookingId: string): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("bookings")
        .selectAll()
        .where("id", "=", bookingId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Booking not found");

      if (existing.status === "cancelled" || existing.status === "refunded") {
        throw new ConflictError("Booking is already cancelled or refunded");
      }

      await tx
        .updateTable("bookings")
        .set({ status: "cancelled", cancelled_at: new Date() })
        .where("id", "=", bookingId)
        .execute();

      await tx
        .updateTable("payment_splits")
        .set({ status: "failed", refunded_at: new Date() })
        .where("booking_id", "=", bookingId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.bookings.cancel",
          entity: "booking",
          entity_id: bookingId,
          metadata: { previous_status: existing.status },
        })
        .execute();
    });
  }

  async adminMarkBookingPaid(adminId: string, bookingId: string): Promise<void> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const existing = await tx
        .selectFrom("bookings")
        .selectAll()
        .where("id", "=", bookingId)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("Booking not found");

      if (existing.status === "cancelled" || existing.status === "refunded") {
        throw new ConflictError("Cannot mark a cancelled or refunded booking as paid");
      }
      if (existing.status === "paid") return;

      await tx
        .updateTable("bookings")
        .set({ status: "paid", paid_at: new Date() })
        .where("id", "=", bookingId)
        .execute();

      await tx
        .updateTable("payment_splits")
        .set({ status: "captured", paid_at: new Date() })
        .where("booking_id", "=", bookingId)
        .execute();

      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: adminId,
          action: "admin.bookings.mark_paid",
          entity: "booking",
          entity_id: bookingId,
          metadata: { previous_status: existing.status },
        })
        .execute();
    });
  }
}
