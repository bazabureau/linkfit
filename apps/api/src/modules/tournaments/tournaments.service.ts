import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type TournamentStatus } from "../../shared/db/types.js";
import {
  type MyTournamentsQuery,
  type RegisterSquadRequest,
  type TournamentsListQuery,
} from "./tournaments.schema.js";
import { FeedService } from "../feed/feed.service.js";
import { type FeedEmitter } from "../feed/feed.types.js";

export interface TournamentsServiceDeps {
  db: DbHandle;
  /**
   * Optional feed emitter — when present, a successful squad registration
   * fires a `registered_tournament` activity event. Fire-and-forget;
   * defaults to a FeedService built from `db`.
   */
  feed?: FeedEmitter | undefined;
}

export interface TournamentSummary {
  id: string;
  name: string;
  description: string | null;
  sport_id: string;
  sport_slug: string;
  venue_id: string | null;
  venue_name: string | null;
  starts_at: string;
  ends_at: string;
  registration_deadline: string | null;
  max_squads: number;
  squad_size: number;
  entry_fee_minor: number;
  currency: string;
  status: TournamentStatus;
  entries_count: number;
}

export interface TournamentEntry {
  id: string;
  tournament_id: string;
  captain_user_id: string;
  captain_display_name: string;
  captain_photo_url: string | null;
  squad_name: string;
  player_ids: string[];
  player_names: string[];
  status: "pending" | "confirmed" | "withdrawn" | "disqualified";
  created_at: string;
}

export interface TournamentDetail extends TournamentSummary {
  entries: TournamentEntry[];
  my_entry: TournamentEntry | null;
  can_register: boolean;
  registration_blocked_reason: string | null;
}

const BUCKET_TO_STATUSES: Record<"upcoming" | "live" | "past", TournamentStatus[]> = {
  upcoming: ["announced", "registration_open", "registration_closed"],
  live: ["in_progress"],
  past: ["completed", "cancelled"],
};

interface TournamentRow {
  id: string;
  name: string;
  description: string | null;
  sport_id: string;
  sport_slug: string;
  venue_id: string | null;
  venue_name: string | null;
  starts_at: Date;
  ends_at: Date;
  registration_deadline: Date | null;
  max_squads: number;
  squad_size: number;
  entry_fee_minor: number;
  currency: string;
  status: TournamentStatus;
  entries_count: string;
}

function rowToSummary(row: TournamentRow): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sport_id: row.sport_id,
    sport_slug: row.sport_slug,
    venue_id: row.venue_id,
    venue_name: row.venue_name,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
    registration_deadline: row.registration_deadline?.toISOString() ?? null,
    max_squads: row.max_squads,
    squad_size: row.squad_size,
    entry_fee_minor: row.entry_fee_minor,
    currency: row.currency,
    status: row.status,
    entries_count: Number(row.entries_count),
  };
}

export class TournamentsService {
  private readonly feed: FeedEmitter;

  constructor(private readonly deps: TournamentsServiceDeps) {
    this.feed = deps.feed ?? new FeedService({ db: deps.db });
  }

  async list(query: TournamentsListQuery): Promise<TournamentSummary[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    // Filter by explicit status OR by logical bucket. If both are supplied
    // they intersect — `status` takes precedence and the bucket is a no-op.
    let statusFilter: TournamentStatus[] | null = null;
    if (query.status) {
      statusFilter = [query.status];
    } else if (query.bucket) {
      statusFilter = BUCKET_TO_STATUSES[query.bucket];
    }

    // Note: the tournaments schema has no `organizer_user_id` column, so
    // there is no per-row author to apply the bidirectional `user_blocks`
    // filter against. If/when an organizer column is added, mirror the
    // pattern from games.repository / feed.service here.
    const result = await sql<TournamentRow>`
      SELECT t.id,
             t.name,
             t.description,
             t.sport_id,
             s.slug AS sport_slug,
             t.venue_id,
             v.name AS venue_name,
             t.starts_at,
             t.ends_at,
             t.registration_deadline,
             t.max_squads,
             t.squad_size,
             t.entry_fee_minor,
             t.currency,
             t.status,
             (SELECT count(*) FROM tournament_entries te
               WHERE te.tournament_id = t.id
                 AND te.status IN ('pending','confirmed'))::text AS entries_count
        FROM tournaments t
        JOIN sports s ON s.id = t.sport_id
        LEFT JOIN venues v ON v.id = t.venue_id
       WHERE 1=1
         ${query.sport ? sql`AND s.slug = ${query.sport}` : sql``}
         ${
           statusFilter
             ? sql`AND t.status = ANY(${statusFilter}::tournament_status[])`
             : sql``
         }
       ORDER BY t.starts_at ASC
       LIMIT ${limit} OFFSET ${offset}
    `.execute(this.deps.db.db);

    return result.rows.map(rowToSummary);
  }

  /**
   * Tournaments the given user has an active (non-withdrawn) entry in.
   * Optional `bucket` filter narrows by tournament lifecycle status.
   *
   * Sorted so upcoming / live appear first (starts_at ASC), then past
   * tournaments by descending start date — same ordering iOS uses for
   * "my games" so the screens feel consistent.
   */
  async listForUser(
    userId: string,
    query: MyTournamentsQuery,
  ): Promise<TournamentSummary[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const statusFilter: TournamentStatus[] | null = query.bucket
      ? BUCKET_TO_STATUSES[query.bucket]
      : null;

    const result = await sql<TournamentRow>`
      SELECT t.id,
             t.name,
             t.description,
             t.sport_id,
             s.slug AS sport_slug,
             t.venue_id,
             v.name AS venue_name,
             t.starts_at,
             t.ends_at,
             t.registration_deadline,
             t.max_squads,
             t.squad_size,
             t.entry_fee_minor,
             t.currency,
             t.status,
             (SELECT count(*) FROM tournament_entries te2
               WHERE te2.tournament_id = t.id
                 AND te2.status IN ('pending','confirmed'))::text AS entries_count
        FROM tournaments t
        JOIN sports s ON s.id = t.sport_id
        LEFT JOIN venues v ON v.id = t.venue_id
       WHERE EXISTS (
               SELECT 1 FROM tournament_entries te
                WHERE te.tournament_id = t.id
                  AND te.captain_user_id = ${userId}
                  AND te.status <> 'withdrawn'
             )
         ${
           statusFilter
             ? sql`AND t.status = ANY(${statusFilter}::tournament_status[])`
             : sql``
         }
       ORDER BY
         CASE WHEN t.status IN ('completed','cancelled') THEN 1 ELSE 0 END ASC,
         CASE WHEN t.status IN ('completed','cancelled') THEN t.starts_at END DESC,
         t.starts_at ASC
       LIMIT ${limit} OFFSET ${offset}
    `.execute(this.deps.db.db);

    return result.rows.map(rowToSummary);
  }

  async detail(id: string, viewerUserId: string | null): Promise<TournamentDetail> {
    const rows = await sql<TournamentRow>`
      SELECT t.id,
             t.name,
             t.description,
             t.sport_id,
             s.slug AS sport_slug,
             t.venue_id,
             v.name AS venue_name,
             t.starts_at,
             t.ends_at,
             t.registration_deadline,
             t.max_squads,
             t.squad_size,
             t.entry_fee_minor,
             t.currency,
             t.status,
             (SELECT count(*) FROM tournament_entries te
               WHERE te.tournament_id = t.id
                 AND te.status IN ('pending','confirmed'))::text AS entries_count
        FROM tournaments t
        JOIN sports s ON s.id = t.sport_id
        LEFT JOIN venues v ON v.id = t.venue_id
       WHERE t.id = ${id}
       LIMIT 1
    `.execute(this.deps.db.db);

    const tournamentRow = rows.rows[0];
    if (!tournamentRow) throw new NotFoundError("Tournament not found");
    const summary = rowToSummary(tournamentRow);

    const entries = await this.listEntries(id);
    const myEntry =
      viewerUserId === null
        ? null
        : entries.find(
            (e) => e.captain_user_id === viewerUserId && e.status !== "withdrawn",
          ) ?? null;

    const { canRegister, reason } = this.computeRegistration(summary, myEntry);

    return {
      ...summary,
      entries,
      my_entry: myEntry,
      can_register: canRegister,
      registration_blocked_reason: reason,
    };
  }

  async register(
    tournamentId: string,
    captainUserId: string,
    body: RegisterSquadRequest,
  ): Promise<TournamentEntry> {
    // Captured inside the tx so we can emit the activity feed event AFTER
    // commit without re-querying the tournament row. Empty string until
    // populated by the trx so the post-commit emit can no-op on early throw
    // (which can't happen because the trx throws first — but defense in
    // depth costs nothing).
    let tournamentName = "";

    // Inside a transaction so the capacity check and insert see a consistent
    // view of `tournament_entries`. SERIALIZABLE would be safer; READ COMMITTED
    // + UNIQUE(tournament_id, captain_user_id) is enough for the captain-side
    // race, and we re-check capacity after insert as a belt-and-braces guard.
    const entry = await this.deps.db.db.transaction().execute(async (trx) => {
      const tournament = await trx
        .selectFrom("tournaments")
        .selectAll()
        .where("id", "=", tournamentId)
        .executeTakeFirst();
      if (!tournament) throw new NotFoundError("Tournament not found");
      tournamentName = tournament.name;

      if (tournament.status === "completed" || tournament.status === "cancelled") {
        throw new ConflictError("Tournament is not accepting registrations");
      }
      if (
        tournament.status === "registration_closed" ||
        tournament.status === "in_progress"
      ) {
        throw new ConflictError("Registration is closed");
      }

      if (
        tournament.registration_deadline &&
        tournament.registration_deadline.getTime() < Date.now()
      ) {
        throw new ConflictError("Registration deadline has passed");
      }

      // Captain cannot be in their own player_ids list — they're already the
      // captain. Also dedupe to defend against client-side double-adds.
      const dedupedPlayers = Array.from(new Set(body.player_ids)).filter(
        (id) => id !== captainUserId,
      );

      const totalSquadSize = dedupedPlayers.length + 1; // +1 for captain
      if (totalSquadSize > tournament.squad_size) {
        throw new ValidationError(
          `Squad too large: max ${String(tournament.squad_size)} players including captain`,
        );
      }
      if (totalSquadSize < 1) {
        throw new ValidationError("Squad must include at least the captain");
      }

      // All supplied players must exist (and be non-deleted). One round-trip.
      if (dedupedPlayers.length > 0) {
        const found = await trx
          .selectFrom("users")
          .select("id")
          .where("id", "in", dedupedPlayers)
          .where("deleted_at", "is", null)
          .execute();
        if (found.length !== dedupedPlayers.length) {
          throw new ValidationError("One or more invited players were not found");
        }
      }

      // Active capacity check (excludes withdrawn).
      const capacity = await sql<{ c: string }>`
        SELECT count(*)::text AS c FROM tournament_entries
         WHERE tournament_id = ${tournamentId}
           AND status IN ('pending','confirmed')
      `.execute(trx);
      const activeCount = Number(capacity.rows[0]?.c ?? "0");
      if (activeCount >= tournament.max_squads) {
        throw new ConflictError("Tournament is full");
      }

      // The (tournament_id, captain_user_id) UNIQUE catches the "captain
      // already registered" race; surface it as 409.
      let inserted;
      try {
        inserted = await trx
          .insertInto("tournament_entries")
          .values({
            tournament_id: tournamentId,
            captain_user_id: captainUserId,
            squad_name: body.squad_name.trim(),
            player_ids: dedupedPlayers,
          })
          .returning(["id", "tournament_id", "captain_user_id", "squad_name", "player_ids", "status", "created_at"])
          .executeTakeFirstOrThrow();
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23505") {
          throw new ConflictError("You already registered a squad for this tournament");
        }
        throw err;
      }

      const captain = await trx
        .selectFrom("users")
        .select(["id", "display_name", "photo_url"])
        .where("id", "=", captainUserId)
        .executeTakeFirstOrThrow();

      const playerNameRows =
        dedupedPlayers.length === 0
          ? []
          : await trx
              .selectFrom("users")
              .select(["id", "display_name"])
              .where("id", "in", dedupedPlayers)
              .execute();
      const nameById = new Map(playerNameRows.map((p) => [p.id, p.display_name]));
      const playerNames = dedupedPlayers.map((id) => nameById.get(id) ?? "Unknown");

      return {
        id: inserted.id,
        tournament_id: inserted.tournament_id,
        captain_user_id: inserted.captain_user_id,
        captain_display_name: captain.display_name,
        captain_photo_url: captain.photo_url,
        squad_name: inserted.squad_name,
        player_ids: inserted.player_ids,
        player_names: playerNames,
        status: inserted.status as TournamentEntry["status"],
        created_at: inserted.created_at.toISOString(),
      };
    });

    // Fire-and-forget activity feed emit post-commit. Same `sourceKey`
    // shape as the polling worker (`te:<entry_id>`) so duplicate emits
    // from the worker's later sweep are dropped by the partial unique
    // index in `feed_events`.
    void this.feed
      .emit({
        actorUserId: captainUserId,
        type: "registered_tournament",
        payload: {
          tournament_id: entry.tournament_id,
          tournament_name: tournamentName,
          squad_name: entry.squad_name,
        },
        sourceKey: `te:${entry.id}`,
      })
      .catch(() => {
        /* swallow — feed emission must never break tournament register */
      });

    return entry;
  }

  async withdraw(
    tournamentId: string,
    entryId: string,
    actorUserId: string,
  ): Promise<void> {
    const entry = await this.deps.db.db
      .selectFrom("tournament_entries")
      .selectAll()
      .where("id", "=", entryId)
      .where("tournament_id", "=", tournamentId)
      .executeTakeFirst();
    if (!entry) throw new NotFoundError("Squad not found");
    if (entry.captain_user_id !== actorUserId) {
      throw new ForbiddenError("Only the captain can withdraw the squad");
    }
    if (entry.status === "withdrawn") {
      // Idempotent — withdrawing twice yields the same end state.
      return;
    }

    const tournament = await this.deps.db.db
      .selectFrom("tournaments")
      .select(["status"])
      .where("id", "=", tournamentId)
      .executeTakeFirstOrThrow();
    if (tournament.status === "in_progress" || tournament.status === "completed") {
      throw new ConflictError("Cannot withdraw after the tournament starts");
    }

    await this.deps.db.db
      .updateTable("tournament_entries")
      .set({ status: "withdrawn" })
      .where("id", "=", entryId)
      .execute();
  }

  // ─── Internals ────────────────────────────────────────────────────

  private async listEntries(tournamentId: string): Promise<TournamentEntry[]> {
    const rows = await sql<{
      id: string;
      tournament_id: string;
      captain_user_id: string;
      captain_display_name: string;
      captain_photo_url: string | null;
      squad_name: string;
      player_ids: string[];
      status: "pending" | "confirmed" | "withdrawn" | "disqualified";
      created_at: Date;
    }>`
      SELECT te.id,
             te.tournament_id,
             te.captain_user_id,
             u.display_name AS captain_display_name,
             u.photo_url    AS captain_photo_url,
             te.squad_name,
             te.player_ids,
             te.status,
             te.created_at
        FROM tournament_entries te
        JOIN users u ON u.id = te.captain_user_id
       WHERE te.tournament_id = ${tournamentId}
         AND te.status <> 'withdrawn'
       ORDER BY te.created_at ASC
    `.execute(this.deps.db.db);

    if (rows.rows.length === 0) return [];

    // Collect all player ids referenced across squads, fetch their names in
    // one round-trip, then attach. Single users with duplicate references
    // collapse via the Set.
    const allPlayerIds = new Set<string>();
    for (const r of rows.rows) {
      for (const pid of r.player_ids) allPlayerIds.add(pid);
    }
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

  private computeRegistration(
    summary: TournamentSummary,
    myEntry: TournamentEntry | null,
  ): { canRegister: boolean; reason: string | null } {
    if (myEntry) {
      return { canRegister: false, reason: "already_registered" };
    }
    if (summary.status === "completed" || summary.status === "cancelled") {
      return { canRegister: false, reason: summary.status };
    }
    if (summary.status === "registration_closed" || summary.status === "in_progress") {
      return { canRegister: false, reason: "registration_closed" };
    }
    if (
      summary.registration_deadline &&
      new Date(summary.registration_deadline).getTime() < Date.now()
    ) {
      return { canRegister: false, reason: "deadline_passed" };
    }
    if (summary.entries_count >= summary.max_squads) {
      return { canRegister: false, reason: "full" };
    }
    return { canRegister: true, reason: null };
  }

  // Exposed for tests / future scheduler — flips status based on date windows.
  // Kept tiny and pure so the unit test can poke it directly.
  static computeStatusForTime(
    starts_at: Date,
    ends_at: Date,
    now: Date,
    currentStatus: TournamentStatus,
  ): TournamentStatus {
    if (currentStatus === "cancelled") return "cancelled";
    if (now >= ends_at) return "completed";
    if (now >= starts_at) return "in_progress";
    return currentStatus;
  }
}
