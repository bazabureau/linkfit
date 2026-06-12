import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type PushService } from "../push/push.service.js";
import { squadsRepository } from "./squads.repository.js";
import {
  type CreateSquadRequest,
  type SquadDetail,
  type SquadGameItem,
  type SquadSummary,
  type UpdateSquadRequest,
} from "./squads.schema.js";

export interface SquadsServiceDeps {
  db: DbHandle;
  /**
   * Optional push fan-out. When set, invites trigger a `squad.invite`
   * push to the invitee's registered devices. Tests that don't care
   * about push omit this so the service stays self-contained.
   */
  push?: PushService | undefined;
  logger: Logger;
}

export class SquadsService {
  constructor(private readonly deps: SquadsServiceDeps) {}

  /**
   * Create a squad. The caller becomes the owner with an active membership.
   * Both inserts run inside the same transaction — partial state (a squad
   * row with no owner membership) would orphan ownership semantics.
   */
  async create(ownerUserId: string, req: CreateSquadRequest): Promise<SquadDetail> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const id = await squadsRepository.insert(tx, {
        owner_id: ownerUserId,
        name: req.name.trim(),
        description: req.description ?? null,
        photo_url: req.photo_url ?? null,
        max_size: req.max_size,
      });
      await squadsRepository.insertOwnerMembership(tx, id, ownerUserId);

      const detail = await squadsRepository.findById(tx, id);
      if (!detail) throw new NotFoundError("Squad vanished after creation");
      return detail;
    });
  }

  /** Squads the user is an active member of. Returns summaries (no member list). */
  async listForUser(userId: string): Promise<SquadSummary[]> {
    return squadsRepository.listForUser(this.deps.db.db, userId);
  }

  /**
   * Detail view. We don't gate visibility here — squad detail is readable by
   * anyone with the id today. The /me list is the privacy surface; once a
   * caller has a squad id (e.g. via an invite push) they can fetch it.
   */
  async getDetail(squadId: string): Promise<SquadDetail> {
    const detail = await squadsRepository.findById(this.deps.db.db, squadId);
    if (!detail) throw new NotFoundError("Squad not found");
    return detail;
  }

  async update(
    squadId: string,
    userId: string,
    patch: UpdateSquadRequest,
  ): Promise<SquadDetail> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const summary = await squadsRepository.findSummaryById(tx, squadId);
      if (!summary) throw new NotFoundError("Squad not found");
      if (summary.owner_id !== userId) {
        throw new ForbiddenError("Only the owner can modify this squad");
      }
      const patchParams: {
        name?: string;
        description?: string | null;
        photo_url?: string | null;
      } = {};
      if (patch.name !== undefined) patchParams.name = patch.name.trim();
      if (patch.description !== undefined) patchParams.description = patch.description;
      if (patch.photo_url !== undefined) patchParams.photo_url = patch.photo_url;
      await squadsRepository.update(tx, squadId, patchParams);
      const detail = await squadsRepository.findById(tx, squadId);
      if (!detail) throw new NotFoundError("Squad not found");
      return detail;
    });
  }

  /**
   * Invite a user to the squad. Constraints:
   *
   * - caller must be an active member of the squad (any role)
   * - the invitee must not be in a block relationship (either direction)
   *   with the caller
   * - the invitee must not already have a row (pending or active)
   * - active member count + pending invites must stay <= max_size
   *
   * On success we synchronously persist the pending membership and fire-
   * and-forget a `squad.invite` push to the invitee. Push failure never
   * rolls back the invite — the invitee will still see the squad in their
   * "Invites" surface on next app open.
   */
  async invite(squadId: string, inviterId: string, inviteeId: string): Promise<void> {
    if (inviterId === inviteeId) {
      throw new ValidationError("Cannot invite yourself");
    }

    const inviterName = await withTransaction(this.deps.db.db, async (tx) => {
      const summary = await squadsRepository.findSummaryById(tx, squadId);
      if (!summary) throw new NotFoundError("Squad not found");

      const inviterMembership = await squadsRepository.findMembership(
        tx,
        squadId,
        inviterId,
      );
      if (inviterMembership?.status !== "active") {
        throw new ForbiddenError("Only squad members can invite");
      }

      // Block check (bidirectional). Done after the auth check so we don't
      // leak whether the blocker is in the squad.
      const blocked = await squadsRepository.areMutuallyBlocked(tx, inviterId, inviteeId);
      if (blocked) {
        // Surfaced as 404 to avoid leaking the block direction — the
        // inviter sees the invitee as "unreachable" rather than "blocked".
        throw new NotFoundError("Invitee not reachable");
      }

      // Invitee must exist (and not be soft-deleted).
      const invitee = await tx
        .selectFrom("users")
        .select(["id", "display_name"])
        .where("id", "=", inviteeId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!invitee) throw new NotFoundError("Invitee not found");

      // Duplicate row?
      const existing = await squadsRepository.findMembership(tx, squadId, inviteeId);
      if (existing) {
        if (existing.status === "active") {
          throw new ConflictError("User is already a squad member");
        }
        throw new ConflictError("User already has a pending invite");
      }

      // Capacity gate. Count active + pending so a squad can't be flooded
      // with pending invites that all accept and bust the cap.
      const totalRows = await tx
        .selectFrom("squad_members")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("squad_id", "=", squadId)
        .executeTakeFirstOrThrow();
      if (Number(totalRows.c) >= summary.max_size) {
        throw new PreconditionFailedError("Squad is at capacity");
      }

      await squadsRepository.insertPendingInvite(tx, squadId, inviteeId);

      // Look up the inviter's display name for the push payload. Read
      // happens inside the tx so we don't issue a second round-trip on
      // the hot-path after commit.
      const inviter = await tx
        .selectFrom("users")
        .select(["display_name"])
        .where("id", "=", inviterId)
        .executeTakeFirstOrThrow();
      return inviter.display_name;
    });

    // Fire-and-forget push outside the tx. We deliberately don't await —
    // a slow APNs round-trip should never block the inviter's response.
    // Errors are swallowed and logged so a busted transport can't bubble
    // back into the request hot-path.
    if (this.deps.push) {
      void this.deps.push
        .deliverToUser(inviteeId, {
          type: "system",
          title: "Squad invite",
          body: `${inviterName} invited you to a squad`,
          data: {
            event: "squad.invite",
            squad_id: squadId,
            inviter_name: inviterName,
          },
        })
        .catch((err: unknown) => {
          this.deps.logger.warn(
            { err, squadId, inviteeId },
            "squads.invite_push_failed",
          );
        });
    }
  }

  /**
   * Accept a pending invite. Must be the invitee; only flips pending → active.
   * If the row is already active we treat it as idempotent (no error). If
   * there's no row at all we 404.
   */
  async accept(squadId: string, userId: string): Promise<void> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const membership = await squadsRepository.findMembership(tx, squadId, userId);
      if (!membership) throw new NotFoundError("No invite found for this squad");
      if (membership.status === "active") return; // idempotent
      const ok = await squadsRepository.activateMembership(tx, squadId, userId);
      if (!ok) {
        // Lost the race with another transaction. The membership exists but
        // isn't pending — treat as success since the user's intent (be in
        // the squad) is satisfied.
        return;
      }
    });
  }

  /**
   * Leave a squad. Three cases:
   *
   *   1. Member (non-owner) leaving: delete their row.
   *   2. Owner leaving with no other active members: 422. The owner has to
   *      DELETE the squad instead — leaving an empty squad in the DB is
   *      a footgun for the rest of the system.
   *   3. Owner leaving with >=1 other active member: transfer ownership to
   *      the oldest active member (by `joined_at`), then delete the
   *      caller's row.
   *
   * All three branches run inside the same transaction so an ownership
   * transfer can't half-apply.
   */
  async leave(squadId: string, userId: string): Promise<void> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const summary = await squadsRepository.findSummaryById(tx, squadId);
      if (!summary) throw new NotFoundError("Squad not found");
      const membership = await squadsRepository.findMembership(tx, squadId, userId);
      if (membership?.status !== "active") {
        throw new PreconditionFailedError("You are not an active member of this squad");
      }

      if (membership.role === "owner") {
        const successor = await squadsRepository.findOldestActiveExcept(
          tx,
          squadId,
          userId,
        );
        if (!successor) {
          throw new PreconditionFailedError(
            "Owner cannot leave a squad with no other members — delete the squad instead",
          );
        }
        await squadsRepository.setOwner(tx, squadId, successor);
        // The leaving owner becomes a regular member just before deletion
        // so the row history reads cleanly if we ever audit it.
        await squadsRepository.demoteToMember(tx, squadId, userId);
      }

      await squadsRepository.deleteMembership(tx, squadId, userId);
    });
  }

  /**
   * Delete a squad. Owner-only. Cascades to squad_members via the FK.
   */
  async delete(squadId: string, userId: string): Promise<void> {
    return withTransaction(this.deps.db.db, async (tx) => {
      const summary = await squadsRepository.findSummaryById(tx, squadId);
      if (!summary) throw new NotFoundError("Squad not found");
      if (summary.owner_id !== userId) {
        throw new ForbiddenError("Only the owner can delete this squad");
      }
      await squadsRepository.delete(tx, squadId);
    });
  }

  /**
   * Upcoming games where 2+ active squad members are confirmed participants.
   * The caller must be an active member of the squad (this surfaces the
   * squad's plans to its own members; we don't want anyone with the id to
   * scrape members' game schedules).
   */
  async listGames(
    squadId: string,
    userId: string,
    since: Date,
  ): Promise<SquadGameItem[]> {
    const summary = await squadsRepository.findSummaryById(this.deps.db.db, squadId);
    if (!summary) throw new NotFoundError("Squad not found");
    const membership = await squadsRepository.findMembership(
      this.deps.db.db,
      squadId,
      userId,
    );
    if (membership?.status !== "active") {
      throw new ForbiddenError("Only squad members can see squad games");
    }
    return squadsRepository.upcomingGames(this.deps.db.db, squadId, since);
  }
}
