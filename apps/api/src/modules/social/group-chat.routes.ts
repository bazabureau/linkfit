import { z } from "zod";
import { sql } from "kysely";
import { type LinkfitServer } from "../../shared/http/server.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";

/**
 * Group chat routes — a strictly additive companion to the 1:1 DM module.
 *
 * Design contract
 * ───────────────
 * 1. Direct (1:1) conversations are feature-frozen — this module never reads
 *    or writes them. It only ever touches conversations where `kind='group'`.
 * 2. A group conversation is *origin-linked* to either a game or a tournament
 *    via the partial-unique indexes added in 1700000009100. Creating a group
 *    is therefore idempotent: posting the same `{kind,target_id}` always
 *    returns the same conversation id.
 * 3. Adding a participant is restricted to the *origin owner* — the game host
 *    or the tournament-entry captain. Any participant can list participants.
 *
 * The send-message and list-messages paths fall through to the existing
 * /api/v1/conversations/:id/messages endpoint; group threads share the same
 * `messages` table, so no behaviour duplicates here.
 */

export interface GroupChatRouteDeps {
  db: DbHandle;
  jwtAccessSecret: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const GroupTargetKind = z.enum(["game", "tournament"]);

const CreateGroupRequest = z.object({
  kind: GroupTargetKind,
  target_id: z.string().uuid(),
});

const GroupConversationResponse = z.object({
  conversation_id: z.string().uuid(),
  kind: z.literal("group"),
  title: z.string(),
  game_id: z.string().uuid().nullable(),
  tournament_id: z.string().uuid().nullable(),
  participants_count: z.number().int().nonnegative(),
  created: z.boolean(),
});

const AddParticipantRequest = z.object({
  user_id: z.string().uuid(),
});

const ParticipantSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  is_owner: z.boolean(),
  joined_at: z.string().nullable(),
});

const ParticipantsListResponse = z.object({
  conversation_id: z.string().uuid(),
  kind: z.literal("group"),
  title: z.string(),
  owner_user_id: z.string().uuid().nullable(),
  items: z.array(ParticipantSchema),
});

// ─── Helpers ──────────────────────────────────────────────────────────────

interface GroupConversationRow {
  id: string;
  title: string | null;
  game_id: string | null;
  tournament_id: string | null;
  // The "owner" of a group conv is whoever can add/remove participants — the
  // game host or tournament-entry captain. We resolve it lazily because the
  // origin row may move (host transfer, captain change) over the lifetime of
  // the conversation.
}

async function fetchGroupConversation(
  db: DbHandle,
  conversationId: string,
): Promise<GroupConversationRow | null> {
  const row = await db.db
    .selectFrom("conversations")
    .select(["id", "title", "game_id", "tournament_id", "kind"])
    .where("id", "=", conversationId)
    .executeTakeFirst();
  if (!row) return null;
  if (row.kind !== "group") return null;
  return { id: row.id, title: row.title, game_id: row.game_id, tournament_id: row.tournament_id };
}

/**
 * Resolves the user_id who is allowed to mutate this group's roster:
 *  - game-linked group  → game.host_user_id
 *  - tournament-linked  → the tournament_entry captain_user_id (the squad
 *    chat lives on the entry; we pick the *first* entry whose captain is
 *    among the participants, falling back to any entry's captain if none
 *    match — see note inside)
 */
async function resolveOwnerUserId(
  db: DbHandle,
  conv: GroupConversationRow,
): Promise<string | null> {
  if (conv.game_id) {
    const game = await db.db
      .selectFrom("games")
      .select("host_user_id")
      .where("id", "=", conv.game_id)
      .executeTakeFirst();
    return game?.host_user_id ?? null;
  }
  if (conv.tournament_id) {
    // For a tournament-wide chat we treat any captain as an owner. The first
    // captain row is returned for the API shape (`owner_user_id`); the
    // authorisation check below allows ANY tournament captain to mutate.
    const captain = await db.db
      .selectFrom("tournament_entries")
      .select("captain_user_id")
      .where("tournament_id", "=", conv.tournament_id)
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    return captain?.captain_user_id ?? null;
  }
  return null;
}

/**
 * True if `userId` is allowed to add/remove participants in this group conv.
 * For game-linked groups: only the host.
 * For tournament-linked groups: any captain of any squad in that tournament.
 */
async function userIsOwner(
  db: DbHandle,
  conv: GroupConversationRow,
  userId: string,
): Promise<boolean> {
  if (conv.game_id) {
    const game = await db.db
      .selectFrom("games")
      .select("host_user_id")
      .where("id", "=", conv.game_id)
      .executeTakeFirst();
    return game?.host_user_id === userId;
  }
  if (conv.tournament_id) {
    const captain = await db.db
      .selectFrom("tournament_entries")
      .select("captain_user_id")
      .where("tournament_id", "=", conv.tournament_id)
      .where("captain_user_id", "=", userId)
      .executeTakeFirst();
    return !!captain;
  }
  return false;
}

async function ensureParticipant(
  db: DbHandle,
  conversationId: string,
  userId: string,
): Promise<void> {
  const row = await db.db
    .selectFrom("conversation_participants")
    .select("user_id")
    .where("conversation_id", "=", conversationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!row) throw new ForbiddenError("Not a participant in this conversation");
}

// ─── Routes ───────────────────────────────────────────────────────────────

export function registerGroupChatRoutes(app: LinkfitServer, deps: GroupChatRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  /**
   * POST /api/v1/conversations/group
   *
   * Idempotent: creates the group conversation for the given origin
   * (`game` or `tournament`) if it doesn't exist yet, otherwise returns the
   * existing one. The caller is auto-added as a participant on creation —
   * we also self-heal on get, so a host who left and rejoined doesn't end
   * up shut out of their own thread.
   *
   * Auth rules:
   *  - For a game: the caller must be the host OR a confirmed participant.
   *  - For a tournament: the caller must be a captain of one of the
   *    registered squads (we don't have a `players-in-squad` lookup
   *    standardized, so captains are the only authoritative roster
   *    members).
   */
  app.post(
    "/api/v1/conversations/group",
    {
      preHandler: authenticate,
      schema: {
        body: CreateGroupRequest,
        response: {
          200: GroupConversationResponse,
          400: ErrorEnvelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope,
        },
        tags: ["group-chat"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const { kind, target_id } = req.body;

      if (kind === "game") {
        const game = await deps.db.db
          .selectFrom("games")
          .select(["id", "host_user_id"])
          .where("id", "=", target_id)
          .executeTakeFirst();
        if (!game) throw new NotFoundError("Game not found");

        const isHost = game.host_user_id === userId;
        let isMember = isHost;
        if (!isMember) {
          const part = await deps.db.db
            .selectFrom("game_participants")
            .select("user_id")
            .where("game_id", "=", target_id)
            .where("user_id", "=", userId)
            .where("status", "=", "confirmed")
            .executeTakeFirst();
          isMember = !!part;
        }
        if (!isMember) {
          throw new ForbiddenError("Join the game before opening its group chat");
        }

        const existing = await deps.db.db
          .selectFrom("conversations")
          .select(["id", "title", "game_id", "tournament_id"])
          .where("game_id", "=", target_id)
          .where("kind", "=", "group")
          .executeTakeFirst();

        if (existing) {
          // Self-heal: idempotently add the caller as a participant if they
          // were dropped (e.g. left then rejoined the game).
          await deps.db.db
            .insertInto("conversation_participants")
            .values({ conversation_id: existing.id, user_id: userId })
            .onConflict((oc) => oc.columns(["conversation_id", "user_id"]).doNothing())
            .execute();
          const count = await countParticipants(deps.db, existing.id);
          return reply.status(200).send({
            conversation_id: existing.id,
            kind: "group" as const,
            title: existing.title ?? defaultGameTitle(),
            game_id: existing.game_id,
            tournament_id: existing.tournament_id,
            participants_count: count,
            created: false,
          });
        }

        const title = defaultGameTitle();
        const conv = await withTransaction(deps.db.db, async (tx) => {
          const ins = await tx
            .insertInto("conversations")
            .values({ kind: "group", title, game_id: target_id })
            .returning(["id", "title", "game_id", "tournament_id"])
            .executeTakeFirstOrThrow();
          await tx
            .insertInto("conversation_participants")
            .values({ conversation_id: ins.id, user_id: userId })
            .execute();
          // Pre-seed the host as a member too if the caller wasn't the host —
          // gives the thread an authoritative owner from day one.
          if (game.host_user_id !== userId) {
            await tx
              .insertInto("conversation_participants")
              .values({ conversation_id: ins.id, user_id: game.host_user_id })
              .onConflict((oc) => oc.columns(["conversation_id", "user_id"]).doNothing())
              .execute();
          }
          return ins;
        });
        const count = await countParticipants(deps.db, conv.id);
        return reply.status(200).send({
          conversation_id: conv.id,
          kind: "group" as const,
          title: conv.title ?? title,
          game_id: conv.game_id,
          tournament_id: conv.tournament_id,
          participants_count: count,
          created: true,
        });
      }

      // kind === "tournament"
      const tournament = await deps.db.db
        .selectFrom("tournaments")
        .select(["id", "name"])
        .where("id", "=", target_id)
        .executeTakeFirst();
      if (!tournament) throw new NotFoundError("Tournament not found");

      const captain = await deps.db.db
        .selectFrom("tournament_entries")
        .select("captain_user_id")
        .where("tournament_id", "=", target_id)
        .where("captain_user_id", "=", userId)
        .executeTakeFirst();
      if (!captain) {
        throw new ForbiddenError("Only registered captains can open the tournament group chat");
      }

      const existing = await deps.db.db
        .selectFrom("conversations")
        .select(["id", "title", "game_id", "tournament_id"])
        .where("tournament_id", "=", target_id)
        .where("kind", "=", "group")
        .executeTakeFirst();

      if (existing) {
        await deps.db.db
          .insertInto("conversation_participants")
          .values({ conversation_id: existing.id, user_id: userId })
          .onConflict((oc) => oc.columns(["conversation_id", "user_id"]).doNothing())
          .execute();
        const count = await countParticipants(deps.db, existing.id);
        return reply.status(200).send({
          conversation_id: existing.id,
          kind: "group" as const,
          title: existing.title ?? tournament.name,
          game_id: existing.game_id,
          tournament_id: existing.tournament_id,
          participants_count: count,
          created: false,
        });
      }

      const title = tournament.name;
      const conv = await withTransaction(deps.db.db, async (tx) => {
        const ins = await tx
          .insertInto("conversations")
          .values({ kind: "group", title, tournament_id: target_id })
          .returning(["id", "title", "game_id", "tournament_id"])
          .executeTakeFirstOrThrow();
        await tx
          .insertInto("conversation_participants")
          .values({ conversation_id: ins.id, user_id: userId })
          .execute();
        return ins;
      });
      const count = await countParticipants(deps.db, conv.id);
      return reply.status(200).send({
        conversation_id: conv.id,
        kind: "group" as const,
        title: conv.title ?? title,
        game_id: conv.game_id,
        tournament_id: conv.tournament_id,
        participants_count: count,
        created: true,
      });
    },
  );

  /**
   * POST /api/v1/conversations/:id/participants
   *
   * Host (for game groups) or any captain (for tournament groups) adds a
   * single participant. Idempotent — re-adding a member is a 200 noop
   * rather than a conflict, mirroring how mobile clients tend to retry.
   */
  app.post(
    "/api/v1/conversations/:id/participants",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: AddParticipantRequest,
        response: {
          200: z.object({ added: z.boolean(), participants_count: z.number().int().nonnegative() }),
          400: ErrorEnvelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 409: ErrorEnvelope,
        },
        tags: ["group-chat"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const conv = await fetchGroupConversation(deps.db, req.params.id);
      if (!conv) throw new NotFoundError("Group conversation not found");

      if (!(await userIsOwner(deps.db, conv, userId))) {
        throw new ForbiddenError("Only the host or a captain can add participants");
      }

      const target = await deps.db.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", req.body.user_id)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!target) throw new NotFoundError("User not found");

      if (target.id === userId) {
        // The owner is already in the conv (creation path adds them) — no-op.
        const count = await countParticipants(deps.db, conv.id);
        return reply.status(200).send({ added: false, participants_count: count });
      }

      const before = await deps.db.db
        .selectFrom("conversation_participants")
        .select("user_id")
        .where("conversation_id", "=", conv.id)
        .where("user_id", "=", target.id)
        .executeTakeFirst();
      if (before) {
        const count = await countParticipants(deps.db, conv.id);
        return reply.status(200).send({ added: false, participants_count: count });
      }

      try {
        await deps.db.db
          .insertInto("conversation_participants")
          .values({ conversation_id: conv.id, user_id: target.id })
          .execute();
      } catch (err) {
        // FK to users(id) — if the user disappears between SELECT and INSERT,
        // surface a clean 409 instead of a 500.
        throw new ConflictError("Could not add participant: " + (err instanceof Error ? err.message : "unknown"));
      }
      const count = await countParticipants(deps.db, conv.id);
      return reply.status(200).send({ added: true, participants_count: count });
    },
  );

  /**
   * GET /api/v1/conversations/:id/participants
   *
   * Lists the roster. Available to any participant.
   */
  app.get(
    "/api/v1/conversations/:id/participants",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: ParticipantsListResponse,
          401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope,
        },
        tags: ["group-chat"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const conv = await fetchGroupConversation(deps.db, req.params.id);
      if (!conv) throw new NotFoundError("Group conversation not found");

      await ensureParticipant(deps.db, conv.id, userId);
      const ownerId = await resolveOwnerUserId(deps.db, conv);

      const rows = await sql<{
        user_id: string;
        display_name: string;
        photo_url: string | null;
        joined_at: Date | null;
      }>`
        SELECT cp.user_id      AS user_id,
               u.display_name  AS display_name,
               u.photo_url     AS photo_url,
               cp.last_read_at AS joined_at
          FROM conversation_participants cp
          JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = ${conv.id}
           AND u.deleted_at IS NULL
         ORDER BY u.display_name ASC
      `.execute(deps.db.db);

      return reply.status(200).send({
        conversation_id: conv.id,
        kind: "group" as const,
        title: conv.title ?? defaultGameTitle(),
        owner_user_id: ownerId,
        items: rows.rows.map((r) => ({
          user_id: r.user_id,
          display_name: r.display_name,
          photo_url: r.photo_url,
          is_owner: r.user_id === ownerId,
          joined_at: r.joined_at?.toISOString() ?? null,
        })),
      });
    },
  );

  /**
   * DELETE /api/v1/conversations/:id/participants/:userId
   *
   * Owner-only kick. Not in the headline requirements but the iOS sheet
   * needs it for the "remove" button — keeping it here next to add keeps
   * the surface coherent.
   */
  app.delete(
    "/api/v1/conversations/:id/participants/:userId",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
        response: {
          204: z.object({}).strict(),
          401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 400: ErrorEnvelope,
        },
        tags: ["group-chat"],
      },
    },
    async (req, reply) => {
      const actorId = requireUserId(req);
      const conv = await fetchGroupConversation(deps.db, req.params.id);
      if (!conv) throw new NotFoundError("Group conversation not found");

      if (!(await userIsOwner(deps.db, conv, actorId))) {
        throw new ForbiddenError("Only the host or a captain can remove participants");
      }
      const ownerId = await resolveOwnerUserId(deps.db, conv);
      if (req.params.userId === ownerId) {
        throw new ValidationError("Cannot remove the conversation owner");
      }
      await deps.db.db
        .deleteFrom("conversation_participants")
        .where("conversation_id", "=", conv.id)
        .where("user_id", "=", req.params.userId)
        .execute();
      return reply.status(204).send({});
    },
  );
}

// ─── Tiny helpers kept module-private ────────────────────────────────────

async function countParticipants(db: DbHandle, conversationId: string): Promise<number> {
  const result = await sql<{ c: string }>`
    SELECT count(*)::text AS c
      FROM conversation_participants
     WHERE conversation_id = ${conversationId}
  `.execute(db.db);
  return Number(result.rows[0]?.c ?? "0");
}

function defaultGameTitle(): string {
  // Title is just a human label — the iOS layer can override at render time
  // using the game's venue + starts_at, but the server still wants a string.
  return "Game chat";
}
