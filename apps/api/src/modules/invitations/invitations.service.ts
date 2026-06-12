import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type GamesService } from "../games/games.service.js";
import { gamesRepository } from "../games/games.repository.js";
import { type NotificationsService } from "../social/notifications.service.js";
import {
  type GameInvitationStatus,
  type GameStatus,
  type GameVisibility,
} from "../../shared/db/types.js";
import {
  type InvitationGamePreview,
  type InvitationOut,
} from "./invitations.schema.js";

export interface InvitationsServiceDeps {
  db: DbHandle;
  games: GamesService;
  notifications: NotificationsService;
}

/** Internal row shape returned by the joined-fetch query below. */
interface InvitationRow {
  id: string;
  game_id: string;
  inviter_user_id: string;
  inviter_display_name: string;
  inviter_photo_url: string | null;
  invitee_user_id: string;
  status: GameInvitationStatus;
  created_at: Date;
  responded_at: Date | null;

  preview_id: string;
  preview_sport_id: string;
  preview_sport_slug: string;
  preview_host_user_id: string;
  preview_host_display_name: string;
  preview_court_id: string | null;
  preview_venue_name: string | null;
  preview_lat: string;
  preview_lng: string;
  preview_starts_at: Date;
  preview_duration_minutes: number;
  preview_capacity: number;
  preview_participants_count: string;
  preview_status: GameStatus;
  preview_visibility: GameVisibility;
}

function rowToOut(row: InvitationRow): InvitationOut {
  const game: InvitationGamePreview = {
    id: row.preview_id,
    sport_id: row.preview_sport_id,
    sport_slug: row.preview_sport_slug,
    host_user_id: row.preview_host_user_id,
    host_display_name: row.preview_host_display_name,
    court_id: row.preview_court_id,
    venue_name: row.preview_venue_name,
    lat: Number(row.preview_lat),
    lng: Number(row.preview_lng),
    starts_at: row.preview_starts_at.toISOString(),
    duration_minutes: row.preview_duration_minutes,
    capacity: row.preview_capacity,
    participants_count: Number(row.preview_participants_count),
    status: row.preview_status,
    visibility: row.preview_visibility,
  };
  return {
    id: row.id,
    game_id: row.game_id,
    inviter_user_id: row.inviter_user_id,
    inviter_display_name: row.inviter_display_name,
    inviter_photo_url: row.inviter_photo_url,
    invitee_user_id: row.invitee_user_id,
    status: row.status,
    created_at: row.created_at.toISOString(),
    responded_at: row.responded_at?.toISOString() ?? null,
    game,
  };
}

/** Build the SELECT list used by every read of an invitation row. */
const SELECT_INVITATION = sql`
    SELECT inv.id,
           inv.game_id,
           inv.inviter_user_id,
           iu.display_name AS inviter_display_name,
           iu.photo_url    AS inviter_photo_url,
           inv.invitee_user_id,
           inv.status,
           inv.created_at,
           inv.responded_at,
           g.id            AS preview_id,
           g.sport_id      AS preview_sport_id,
           s.slug          AS preview_sport_slug,
           g.host_user_id  AS preview_host_user_id,
           hu.display_name AS preview_host_display_name,
           g.court_id      AS preview_court_id,
           v.name          AS preview_venue_name,
           g.lat           AS preview_lat,
           g.lng           AS preview_lng,
           g.starts_at     AS preview_starts_at,
           g.duration_minutes AS preview_duration_minutes,
           g.capacity      AS preview_capacity,
           (SELECT count(*) FROM game_participants gp
              WHERE gp.game_id = g.id AND gp.status = 'confirmed')::text
                            AS preview_participants_count,
           g.status        AS preview_status,
           g.visibility    AS preview_visibility
      FROM game_invitations inv
      JOIN games  g  ON g.id  = inv.game_id
      JOIN sports s  ON s.id  = g.sport_id
      JOIN users  iu ON iu.id = inv.inviter_user_id
      JOIN users  hu ON hu.id = g.host_user_id
      LEFT JOIN courts c ON c.id = g.court_id
      LEFT JOIN venues v ON v.id = c.venue_id
`;

export class InvitationsService {
  constructor(private readonly deps: InvitationsServiceDeps) {}

  /**
   * Host invites a specific player. Validates host-only, distinct parties,
   * game state, and that the invitee isn't already in the game. The
   * Postgres partial-UNIQUE index handles concurrent duplicate-insert races
   * (we surface 23505 as a 409).
   */
  async create(
    gameId: string,
    inviterUserId: string,
    inviteeUserId: string,
  ): Promise<InvitationOut> {
    if (inviterUserId === inviteeUserId) {
      throw new ValidationError("Cannot invite yourself");
    }

    return withTransaction(this.deps.db.db, async (tx) => {
      const game = await tx
        .selectFrom("games")
        .select(["id", "host_user_id", "status", "starts_at", "capacity"])
        .where("id", "=", gameId)
        .executeTakeFirst();
      if (!game) throw new NotFoundError("Game not found");
      if (game.host_user_id !== inviterUserId) {
        throw new ForbiddenError("Only the host can invite players");
      }
      if (game.status === "cancelled" || game.status === "completed") {
        throw new PreconditionFailedError("Game is not accepting invites");
      }
      if (game.starts_at.getTime() <= Date.now()) {
        throw new PreconditionFailedError("Game has already started");
      }

      const invitee = await tx
        .selectFrom("users")
        .select(["id"])
        .where("id", "=", inviteeUserId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!invitee) throw new NotFoundError("Invitee not found");

      // Already a confirmed participant? Nothing to invite.
      const alreadyIn = await tx
        .selectFrom("game_participants")
        .select("user_id")
        .where("game_id", "=", gameId)
        .where("user_id", "=", inviteeUserId)
        .where("status", "=", "confirmed")
        .executeTakeFirst();
      if (alreadyIn) {
        throw new ConflictError("Player is already in this game");
      }

      let insertedId: string;
      try {
        const inserted = await tx
          .insertInto("game_invitations")
          .values({
            game_id: gameId,
            inviter_user_id: inviterUserId,
            invitee_user_id: inviteeUserId,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        insertedId = inserted.id;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23505") {
          throw new ConflictError("This player already has a pending invite");
        }
        throw err;
      }

      const out = await this.fetchOne(insertedId);
      if (!out) throw new NotFoundError("Invitation vanished after creation");

      // Notification fan-out — outside the tx ordering doesn't matter, since
      // `emit()` opens its own transaction. We reuse the closest existing
      // notification type (`tournament_invite`) so iOS routing/icons keep
      // working without an app update; payload.kind distinguishes downstream.
      // Copy is AZ-first (Linkfit is launching in Azerbaijan). iOS renders
      // server strings as-is; localized client-side rendering can come later
      // once we ship per-user locale persistence.
      await this.deps.notifications.emit({
        userId: inviteeUserId,
        type: "tournament_invite",
        title: "Oyun dəvəti",
        body: `${out.inviter_display_name} sizi oyuna dəvət etdi`,
        payload: {
          kind: "game_invite",
          invitation_id: out.id,
          game_id: gameId,
          inviter_user_id: inviterUserId,
        },
      });

      return out;
    });
  }

  /**
   * Batch-invite — used by the post-create-game "send to followers" sheet.
   * Iterates the user_ids in-order, swallowing per-row failures (already-in,
   * already-pending, self, etc.) so the caller still gets a clean count. We
   * tolerate partial failure by design: the user picked a handful of
   * followers; surfacing "row 3 of 5 already in" would force them back
   * into the picker for no real benefit.
   *
   * Returns `{ sent, blocked }` where `sent` is the count of newly-created
   * pending invites and `blocked` is everyone else (dupes, conflicts,
   * validation failures). Notification fan-out is delegated to `create()`,
   * so each successful invite generates exactly one push.
   */
  async batchInvite(
    gameId: string,
    inviterUserId: string,
    inviteeUserIds: string[],
  ): Promise<{ sent: number; blocked: number }> {
    // Up-front host check — fails the whole call rather than burning N
    // per-row transactions to learn the caller isn't the host.
    const game = await this.deps.db.db
      .selectFrom("games")
      .select(["id", "host_user_id"])
      .where("id", "=", gameId)
      .executeTakeFirst();
    if (!game) throw new NotFoundError("Game not found");
    if (game.host_user_id !== inviterUserId) {
      throw new ForbiddenError("Only the host can invite players");
    }

    let sent = 0;
    let blocked = 0;
    // De-dupe the input first — caller-side multi-select can re-emit the
    // same id when the picker keeps stale selection state across reloads.
    const unique = Array.from(new Set(inviteeUserIds));
    for (const inviteeId of unique) {
      try {
        await this.create(gameId, inviterUserId, inviteeId);
        sent += 1;
      } catch {
        // Any per-row error (ValidationError, ConflictError, NotFoundError,
        // PreconditionFailedError) counts as blocked. We don't rethrow
        // here because the host already cleared the up-front gate; the
        // only remaining errors are per-invitee state.
        blocked += 1;
      }
    }
    return { sent, blocked };
  }

  /**
   * Return invitations for the current user. Optional `status` filter; default
   * lists all rows newest-first.
   */
  async listForUser(
    userId: string,
    status?: GameInvitationStatus,
  ): Promise<InvitationOut[]> {
    const rows = await sql<InvitationRow>`
      ${SELECT_INVITATION}
      WHERE inv.invitee_user_id = ${userId}
        ${status !== undefined ? sql`AND inv.status = ${status}::game_invitation_status` : sql``}
      ORDER BY inv.created_at DESC
      LIMIT 200
    `.execute(this.deps.db.db);
    return rows.rows.map(rowToOut);
  }

  /**
   * Accept a pending invite. Re-uses `gamesRepository.tryJoin` so we inherit
   * the canonical capacity/race protection. The invitation flip and the join
   * happen in the same transaction — if the join fails the status stays
   * `pending` and the user can retry.
   */
  async accept(
    invitationId: string,
    inviteeUserId: string,
  ): Promise<{ invitation: InvitationOut; game_id: string }> {
    const gameId = await withTransaction(this.deps.db.db, async (tx) => {
      const row = await tx
        .selectFrom("game_invitations")
        .select(["id", "game_id", "invitee_user_id", "status"])
        .where("id", "=", invitationId)
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Invitation not found");
      if (row.invitee_user_id !== inviteeUserId) {
        throw new ForbiddenError("This invitation isn't yours");
      }
      if (row.status === "accepted") {
        // Idempotent — repeating accept is harmless.
        return row.game_id;
      }
      if (row.status === "declined" || row.status === "expired") {
        throw new PreconditionFailedError(
          `Invitation has already been ${row.status}`,
        );
      }

      const outcome = await gamesRepository.tryJoin(tx, row.game_id, inviteeUserId);
      if (outcome === "full") throw new ConflictError("Game is full");
      if (outcome === "not_joinable") {
        throw new PreconditionFailedError("Game is not joinable");
      }
      // "joined" or "already_in" both transition the invite to accepted.

      await tx
        .updateTable("game_invitations")
        .set({ status: "accepted", responded_at: new Date() })
        .where("id", "=", invitationId)
        .execute();

      return row.game_id;
    });

    const inv = await this.fetchOne(invitationId);
    if (!inv) throw new NotFoundError("Invitation vanished");
    return { invitation: inv, game_id: gameId };
  }

  /**
   * Decline a pending invite. Idempotent — declining a row that's already
   * declined is a no-op. Declining accepted/expired is a 422.
   */
  async decline(
    invitationId: string,
    inviteeUserId: string,
  ): Promise<InvitationOut> {
    await withTransaction(this.deps.db.db, async (tx) => {
      const row = await tx
        .selectFrom("game_invitations")
        .select(["id", "invitee_user_id", "status"])
        .where("id", "=", invitationId)
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Invitation not found");
      if (row.invitee_user_id !== inviteeUserId) {
        throw new ForbiddenError("This invitation isn't yours");
      }
      if (row.status === "declined") return;
      if (row.status !== "pending") {
        throw new PreconditionFailedError(
          `Cannot decline a ${row.status} invitation`,
        );
      }
      await tx
        .updateTable("game_invitations")
        .set({ status: "declined", responded_at: new Date() })
        .where("id", "=", invitationId)
        .execute();
    });
    const inv = await this.fetchOne(invitationId);
    if (!inv) throw new NotFoundError("Invitation vanished");
    return inv;
  }

  /**
   * Expire pending invitations whose game already started. Called by a cron
   * job (see `expireStalePending`). Pure DB write — returns the number of
   * rows expired so the job can log it.
   */
  async expireStalePending(now: Date = new Date()): Promise<number> {
    const result = await this.deps.db.db
      .updateTable("game_invitations")
      .set({ status: "expired", responded_at: now })
      .where("status", "=", "pending")
      .where((eb) =>
        eb(
          "game_id",
          "in",
          eb.selectFrom("games").select("id").where("starts_at", "<=", now),
        ),
      )
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  private async fetchOne(invitationId: string): Promise<InvitationOut | null> {
    const result = await sql<InvitationRow>`
      ${SELECT_INVITATION}
      WHERE inv.id = ${invitationId}
      LIMIT 1
    `.execute(this.deps.db.db);
    const row = result.rows[0];
    return row ? rowToOut(row) : null;
  }
}
