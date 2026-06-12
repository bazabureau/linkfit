import { sql } from "kysely";
import { type Executor } from "../../shared/db/withTransaction.js";
import { type SquadMemberRole, type SquadMemberStatus } from "../../shared/db/types.js";
import {
  type SquadDetail,
  type SquadGameItem,
  type SquadMemberOut,
  type SquadSummary,
} from "./squads.schema.js";

export interface SquadInsertParams {
  owner_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  max_size: number;
}

export interface SquadUpdatePatch {
  name?: string;
  description?: string | null;
  photo_url?: string | null;
}

interface SquadRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  max_size: number;
  created_at: Date;
  member_count: string;
}

interface MemberRow {
  user_id: string;
  display_name: string;
  photo_url: string | null;
  role: SquadMemberRole;
  status: SquadMemberStatus;
  joined_at: Date;
}

function rowToSummary(r: SquadRow): SquadSummary {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    description: r.description,
    photo_url: r.photo_url,
    max_size: r.max_size,
    member_count: Number(r.member_count),
    created_at: r.created_at.toISOString(),
  };
}

function rowToMember(r: MemberRow): SquadMemberOut {
  return {
    user_id: r.user_id,
    display_name: r.display_name,
    photo_url: r.photo_url,
    role: r.role,
    status: r.status,
    joined_at: r.joined_at.toISOString(),
  };
}

/**
 * Repository — pure DB queries, no error mapping or business logic. The
 * service layer composes these inside `withTransaction` and turns return
 * values into typed AppErrors. Every function takes an `Executor` so the
 * same code path runs inside or outside a transaction.
 */
export const squadsRepository = {
  async insert(db: Executor, params: SquadInsertParams): Promise<string> {
    const row = await db
      .insertInto("squads")
      .values({
        owner_id: params.owner_id,
        name: params.name,
        description: params.description,
        photo_url: params.photo_url,
        max_size: params.max_size,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  },

  async insertOwnerMembership(db: Executor, squadId: string, userId: string): Promise<void> {
    await db
      .insertInto("squad_members")
      .values({
        squad_id: squadId,
        user_id: userId,
        role: "owner",
        status: "active",
      })
      .execute();
  },

  async insertPendingInvite(db: Executor, squadId: string, userId: string): Promise<void> {
    await db
      .insertInto("squad_members")
      .values({
        squad_id: squadId,
        user_id: userId,
        role: "member",
        status: "pending",
      })
      .execute();
  },

  async findById(db: Executor, id: string): Promise<SquadDetail | null> {
    const result = await sql<SquadRow>`
      SELECT s.id,
             s.owner_id,
             s.name,
             s.description,
             s.photo_url,
             s.max_size,
             s.created_at,
             (SELECT count(*) FROM squad_members sm
               WHERE sm.squad_id = s.id AND sm.status = 'active')::text AS member_count
        FROM squads s
       WHERE s.id = ${id}
    `.execute(db);
    const row = result.rows[0];
    if (!row) return null;

    const members = await this.listMembers(db, id);
    return { ...rowToSummary(row), members };
  },

  async findSummaryById(db: Executor, id: string): Promise<SquadSummary | null> {
    const result = await sql<SquadRow>`
      SELECT s.id,
             s.owner_id,
             s.name,
             s.description,
             s.photo_url,
             s.max_size,
             s.created_at,
             (SELECT count(*) FROM squad_members sm
               WHERE sm.squad_id = s.id AND sm.status = 'active')::text AS member_count
        FROM squads s
       WHERE s.id = ${id}
    `.execute(db);
    const row = result.rows[0];
    return row ? rowToSummary(row) : null;
  },

  async listMembers(db: Executor, squadId: string): Promise<SquadMemberOut[]> {
    const result = await db
      .selectFrom("squad_members as sm")
      .innerJoin("users as u", "u.id", "sm.user_id")
      .select([
        "sm.user_id as user_id",
        "u.display_name as display_name",
        "u.photo_url as photo_url",
        "sm.role as role",
        "sm.status as status",
        "sm.joined_at as joined_at",
      ])
      .where("sm.squad_id", "=", squadId)
      .orderBy("sm.joined_at", "asc")
      .execute();
    return result.map((r) => rowToMember(r));
  },

  /** Squads the user is an active member of, newest-first. */
  async listForUser(db: Executor, userId: string): Promise<SquadSummary[]> {
    const result = await sql<SquadRow>`
      SELECT s.id,
             s.owner_id,
             s.name,
             s.description,
             s.photo_url,
             s.max_size,
             s.created_at,
             (SELECT count(*) FROM squad_members sm2
               WHERE sm2.squad_id = s.id AND sm2.status = 'active')::text AS member_count
        FROM squads s
        JOIN squad_members sm ON sm.squad_id = s.id
       WHERE sm.user_id = ${userId}
         AND sm.status = 'active'
       ORDER BY s.created_at DESC
    `.execute(db);
    return result.rows.map(rowToSummary);
  },

  async findMembership(
    db: Executor,
    squadId: string,
    userId: string,
  ): Promise<{ role: SquadMemberRole; status: SquadMemberStatus } | null> {
    const row = await db
      .selectFrom("squad_members")
      .select(["role", "status"])
      .where("squad_id", "=", squadId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row ?? null;
  },

  async countActiveMembers(db: Executor, squadId: string): Promise<number> {
    const row = await db
      .selectFrom("squad_members")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("squad_id", "=", squadId)
      .where("status", "=", "active")
      .executeTakeFirstOrThrow();
    return Number(row.c);
  },

  /**
   * Flip a pending invite to active. Returns true iff a row transitioned —
   * idempotent re-accepts are caller-visible (false return) so the service
   * can decide whether to treat the second accept as a no-op or an error.
   */
  async activateMembership(
    db: Executor,
    squadId: string,
    userId: string,
  ): Promise<boolean> {
    const res = await db
      .updateTable("squad_members")
      .set({ status: "active" })
      .where("squad_id", "=", squadId)
      .where("user_id", "=", userId)
      .where("status", "=", "pending")
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  },

  async deleteMembership(
    db: Executor,
    squadId: string,
    userId: string,
  ): Promise<boolean> {
    const res = await db
      .deleteFrom("squad_members")
      .where("squad_id", "=", squadId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  },

  /**
   * Find the oldest active member of the squad excluding the named user.
   * Used to pick a new owner when the current owner leaves.
   */
  async findOldestActiveExcept(
    db: Executor,
    squadId: string,
    excludeUserId: string,
  ): Promise<string | null> {
    const row = await db
      .selectFrom("squad_members")
      .select(["user_id"])
      .where("squad_id", "=", squadId)
      .where("status", "=", "active")
      .where("user_id", "<>", excludeUserId)
      .orderBy("joined_at", "asc")
      .executeTakeFirst();
    return row?.user_id ?? null;
  },

  async setOwner(db: Executor, squadId: string, userId: string): Promise<void> {
    await db
      .updateTable("squads")
      .set({ owner_id: userId })
      .where("id", "=", squadId)
      .execute();
    await db
      .updateTable("squad_members")
      .set({ role: "owner" })
      .where("squad_id", "=", squadId)
      .where("user_id", "=", userId)
      .execute();
  },

  async demoteToMember(db: Executor, squadId: string, userId: string): Promise<void> {
    await db
      .updateTable("squad_members")
      .set({ role: "member" })
      .where("squad_id", "=", squadId)
      .where("user_id", "=", userId)
      .execute();
  },

  async update(
    db: Executor,
    squadId: string,
    patch: SquadUpdatePatch,
  ): Promise<void> {
    const set: Partial<{
      name: string;
      description: string | null;
      photo_url: string | null;
    }> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.photo_url !== undefined) set.photo_url = patch.photo_url;
    if (Object.keys(set).length === 0) return;
    await db.updateTable("squads").set(set).where("id", "=", squadId).execute();
  },

  async delete(db: Executor, squadId: string): Promise<void> {
    // ON DELETE CASCADE on squad_members.squad_id cleans up memberships.
    await db.deleteFrom("squads").where("id", "=", squadId).execute();
  },

  /**
   * Bidirectional block check — true iff `a` has blocked `b` OR vice versa.
   * Mirrors the semantics enforced everywhere else in the app (games list
   * filter, follows, invitations). One round-trip; we read at most one
   * blocks row regardless of direction.
   */
  async areMutuallyBlocked(db: Executor, a: string, b: string): Promise<boolean> {
    const row = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM user_blocks
         WHERE (blocker_user_id = ${a} AND blocked_user_id = ${b})
            OR (blocker_user_id = ${b} AND blocked_user_id = ${a})
      ) AS exists
    `.execute(db);
    return row.rows[0]?.exists === true;
  },

  /**
   * Future upcoming games where at least two distinct *active* members of
   * this squad are confirmed participants. The "two players makes a game"
   * threshold is deliberate: padel doubles needs four, but two squad
   * mates booking the court together is the dominant pattern and the one
   * the iOS surface wants to highlight.
   *
   * `since` defaults to NOW(); callers can pass a future cutoff to slide
   * the lookback window forward.
   */
  async upcomingGames(
    db: Executor,
    squadId: string,
    since: Date,
  ): Promise<SquadGameItem[]> {
    const result = await sql<{
      id: string;
      sport_slug: string;
      host_user_id: string;
      host_display_name: string;
      venue_name: string | null;
      starts_at: Date;
      duration_minutes: number;
      status: "open" | "full" | "cancelled" | "completed";
      squad_members_attending: string;
    }>`
      WITH active_members AS (
        SELECT user_id FROM squad_members
         WHERE squad_id = ${squadId} AND status = 'active'
      )
      SELECT g.id,
             s.slug AS sport_slug,
             g.host_user_id,
             u.display_name AS host_display_name,
             v.name AS venue_name,
             g.starts_at,
             g.duration_minutes,
             g.status,
             COUNT(DISTINCT gp.user_id)::text AS squad_members_attending
        FROM games g
        JOIN sports s ON s.id = g.sport_id
        JOIN users  u ON u.id = g.host_user_id
        JOIN game_participants gp ON gp.game_id = g.id
                                  AND gp.status = 'confirmed'
                                  AND gp.user_id IN (SELECT user_id FROM active_members)
        LEFT JOIN courts c ON c.id = g.court_id
        LEFT JOIN venues v ON v.id = c.venue_id
       WHERE g.starts_at > ${since}
         AND g.deleted_at IS NULL
       GROUP BY g.id, s.slug, g.host_user_id, u.display_name, v.name,
                g.starts_at, g.duration_minutes, g.status
      HAVING COUNT(DISTINCT gp.user_id) >= 2
       ORDER BY g.starts_at ASC
       LIMIT 50
    `.execute(db);
    return result.rows.map((r) => ({
      id: r.id,
      sport_slug: r.sport_slug,
      host_user_id: r.host_user_id,
      host_display_name: r.host_display_name,
      venue_name: r.venue_name,
      starts_at: r.starts_at.toISOString(),
      duration_minutes: r.duration_minutes,
      status: r.status,
      squad_members_attending: Number(r.squad_members_attending),
    }));
  },
};
