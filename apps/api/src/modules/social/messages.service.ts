import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type NotificationsService } from "./notifications.service.js";
import { type MessageAttachmentType } from "../../shared/db/types.js";
import { type RealtimeBus } from "../realtime/realtime.bus.js";

export interface MessagesServiceDeps {
  db: DbHandle;
  notifications: NotificationsService;
  /** Optional realtime bus. When set, every successful `send()` publishes
   *  a `message` event to the other participant's SSE subscribers, so
   *  live chat works without the iOS client polling. The notification
   *  emit above ALSO publishes a `notification` event — the iOS client
   *  uses `kind` to discriminate (message → push into chat thread vs.
   *  notification → bump badge). */
  realtime?: RealtimeBus | undefined;
}

export interface ConversationSummary {
  id: string;
  other_user_id: string;
  other_display_name: string;
  other_photo_url: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  unread: boolean;
}

export interface MessageOut {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  body: string;
  attachment_url: string | null;
  attachment_type: MessageAttachmentType | null;
  created_at: string;
}

export interface ConversationThread {
  conversation_id: string;
  other_user_id: string;
  other_display_name: string;
  other_last_read_at: string | null;
  messages: MessageOut[];
}

export interface SendMessageInput {
  body?: string | undefined;
  attachment_url?: string | undefined;
  attachment_type?: MessageAttachmentType | undefined;
}

export class MessagesService {
  constructor(private readonly deps: MessagesServiceDeps) {}

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const result = await sql<{
      id: string;
      other_user_id: string;
      other_display_name: string;
      other_photo_url: string | null;
      last_message_body: string | null;
      last_message_at: Date | null;
      last_read_at: Date | null;
    }>`
      SELECT c.id,
             other.user_id AS other_user_id,
             ou.display_name AS other_display_name,
             ou.photo_url    AS other_photo_url,
             (SELECT body FROM messages m
               WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC LIMIT 1) AS last_message_body,
             c.last_message_at,
             me.last_read_at
        FROM conversations c
        JOIN conversation_participants me
          ON me.conversation_id = c.id AND me.user_id = ${userId}
        JOIN conversation_participants other
          ON other.conversation_id = c.id AND other.user_id <> ${userId}
        JOIN users ou ON ou.id = other.user_id
       WHERE ou.deleted_at IS NULL
         AND me.left_at IS NULL
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT 100
    `.execute(this.deps.db.db);

    return result.rows.map((r) => ({
      id: r.id,
      other_user_id: r.other_user_id,
      other_display_name: r.other_display_name,
      other_photo_url: r.other_photo_url,
      last_message_body: r.last_message_body,
      last_message_at: r.last_message_at?.toISOString() ?? null,
      unread:
        r.last_message_at !== null &&
        (r.last_read_at === null || r.last_read_at < r.last_message_at),
    }));
  }

  async getOrCreateWith(userId: string, otherUserId: string): Promise<string> {
    if (userId === otherUserId) {
      throw new ValidationError("Cannot start a conversation with yourself");
    }
    const other = await this.deps.db.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", otherUserId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!other) throw new NotFoundError("User not found");

    // Find an existing pair-conversation that has EXACTLY the two participants.
    // The join purposely IGNORES `left_at` so that re-DMing someone after we
    // left the thread resurrects the same conversation (set `me.left_at =
    // NULL` below) instead of minting a fresh one — avoids the PK collision
    // on (conversation_id, user_id) and keeps the message history continuous.
    const existing = await sql<{ id: string }>`
      SELECT c.id
        FROM conversations c
        JOIN conversation_participants me
          ON me.conversation_id = c.id AND me.user_id = ${userId}
        JOIN conversation_participants other
          ON other.conversation_id = c.id AND other.user_id = ${otherUserId}
        LEFT JOIN conversation_participants extra
          ON extra.conversation_id = c.id
         AND extra.user_id NOT IN (${userId}, ${otherUserId})
       WHERE extra.user_id IS NULL
       LIMIT 1
    `.execute(this.deps.db.db);
    if (existing.rows[0]) {
      // Resurrect the caller's seat if they had previously left. No-op when
      // they were already active.
      await this.deps.db.db
        .updateTable("conversation_participants")
        .set({ left_at: null })
        .where("conversation_id", "=", existing.rows[0].id)
        .where("user_id", "=", userId)
        .where("left_at", "is not", null)
        .execute();
      return existing.rows[0].id;
    }

    return withTransaction(this.deps.db.db, async (tx) => {
      const conv = await tx
        .insertInto("conversations")
        .defaultValues()
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("conversation_participants")
        .values([
          { conversation_id: conv.id, user_id: userId },
          { conversation_id: conv.id, user_id: otherUserId },
        ])
        .execute();
      return conv.id;
    });
  }

  async getThread(userId: string, conversationId: string): Promise<ConversationThread> {
    // A user who has left the thread (left_at IS NOT NULL) is treated as a
    // non-participant for read access — their inbox no longer surfaces it
    // and re-opening must go through getOrCreateWith which resurrects them.
    const participant = await this.deps.db.db
      .selectFrom("conversation_participants")
      .selectAll()
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .where("left_at", "is", null)
      .executeTakeFirst();
    if (!participant) throw new ForbiddenError("Not a participant in this conversation");

    const conv = await this.deps.db.db
      .selectFrom("conversations")
      .select(["kind", "title", "game_id", "tournament_id"])
      .where("id", "=", conversationId)
      .executeTakeFirst();
    if (!conv) throw new NotFoundError("Conversation not found");

    const otherRow = await this.deps.db.db
      .selectFrom("conversation_participants as cp")
      .innerJoin("users as u", "u.id", "cp.user_id")
      .select(["u.id as id", "u.display_name as display_name", "cp.last_read_at as last_read_at"])
      .where("cp.conversation_id", "=", conversationId)
      .where("cp.user_id", "<>", userId)
      .executeTakeFirst();

    if (!otherRow && conv.kind !== "group" && !conv.game_id && !conv.tournament_id) {
      throw new NotFoundError("Conversation participant missing");
    }

    const messages = await this.deps.db.db
      .selectFrom("messages")
      .selectAll()
      .where("conversation_id", "=", conversationId)
      .orderBy("created_at", "asc")
      .limit(200)
      .execute();

    // Mark this thread as read for me.
    await this.deps.db.db
      .updateTable("conversation_participants")
      .set({ last_read_at: new Date() })
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .execute();

    return {
      conversation_id: conversationId,
      other_user_id: otherRow?.id ?? conversationId,
      other_display_name: otherRow?.display_name ?? (conv.title ?? "Game chat"),
      other_last_read_at: otherRow?.last_read_at?.toISOString() ?? null,
      messages: messages.map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        sender_user_id: m.sender_user_id,
        body: m.body,
        attachment_url: m.attachment_url,
        attachment_type: m.attachment_type,
        created_at: m.created_at.toISOString(),
      })),
    };
  }

  async send(userId: string, conversationId: string, input: SendMessageInput): Promise<MessageOut> {
    const trimmed = (input.body ?? "").trim();
    const hasAttachment = input.attachment_url !== undefined;
    if (trimmed.length === 0 && !hasAttachment) {
      throw new ValidationError("Message must have a body or an attachment");
    }
    if (hasAttachment !== (input.attachment_type !== undefined)) {
      throw new ValidationError("attachment_url and attachment_type must be provided together");
    }

    const participant = await this.deps.db.db
      .selectFrom("conversation_participants")
      .select(["user_id"])
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .where("left_at", "is", null)
      .executeTakeFirst();
    if (!participant) throw new ForbiddenError("Not a participant in this conversation");

    const inserted = await this.deps.db.db
      .insertInto("messages")
      .values({
        conversation_id: conversationId,
        sender_user_id: userId,
        body: trimmed,
        attachment_url: input.attachment_url ?? null,
        attachment_type: input.attachment_type ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Notify all OTHER participants.
    const others = await this.deps.db.db
      .selectFrom("conversation_participants")
      .select("user_id")
      .where("conversation_id", "=", conversationId)
      .where("user_id", "<>", userId)
      .execute();
    if (others.length > 0) {
      const sender = await this.deps.db.db
        .selectFrom("users")
        .select("display_name")
        .where("id", "=", userId)
        .executeTakeFirst();
      // Attachment-only messages still warrant a notification preview.
      const preview = trimmed.length > 0
        ? trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed
        : input.attachment_type === "image" ? "📷 Photo" : "🎤 Voice message";

      await Promise.all(
        others.map(async (other) => {
          await this.deps.notifications.emit({
            userId: other.user_id,
            type: "message_received",
            title: `New message from ${sender?.display_name ?? "a player"}`,
            body: preview,
            payload: { conversation_id: conversationId },
          });

          if (this.deps.realtime) {
            this.deps.realtime.publish(other.user_id, {
              kind: "message",
              data: {
                id: inserted.id,
                conversation_id: conversationId,
                sender_user_id: userId,
                body: trimmed,
                attachment_url: inserted.attachment_url,
                attachment_type: inserted.attachment_type,
                created_at: inserted.created_at.toISOString(),
              },
            });
          }
        })
      );
    }

    return {
      id: inserted.id,
      conversation_id: inserted.conversation_id,
      sender_user_id: inserted.sender_user_id,
      body: inserted.body,
      attachment_url: inserted.attachment_url,
      attachment_type: inserted.attachment_type,
      created_at: inserted.created_at.toISOString(),
    };
  }

  /**
   * Soft-removes the caller from a conversation: sets `left_at = NOW()` on
   * their participant row so the conversation list endpoint stops returning
   * it. The other participant(s) keep their copy and their message history
   * is untouched — this is intentionally NOT a hard delete of the thread.
   *
   * - Throws ForbiddenError if the caller has no active participant row
   *   (never joined, OR already left). Surface as 403 by the route layer;
   *   we treat "already left" as forbidden rather than 404 so we don't
   *   leak whether the conversation exists at all.
   * - Idempotency is handled at the route layer via the participant check:
   *   a second leave call from the same user returns 403, which is honest
   *   ("you are no longer a participant"). If we wanted 204-idempotent we
   *   could swallow the check, but the explicit 403 is more useful to the
   *   iOS client (it can prune the row from its local cache on first
   *   success and never call again).
   */
  async leave(userId: string, conversationId: string): Promise<void> {
    const participant = await this.deps.db.db
      .selectFrom("conversation_participants")
      .select(["user_id"])
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .where("left_at", "is", null)
      .executeTakeFirst();
    if (!participant) throw new ForbiddenError("Not a participant in this conversation");

    await this.deps.db.db
      .updateTable("conversation_participants")
      .set({ left_at: new Date() })
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .where("left_at", "is", null)
      .execute();
  }

  async markRead(userId: string, conversationId: string): Promise<void> {
    const participant = await this.deps.db.db
      .selectFrom("conversation_participants")
      .select(["user_id"])
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!participant) throw new ForbiddenError("Not a participant in this conversation");

    const now = new Date();
    await this.deps.db.db
      .updateTable("conversation_participants")
      .set({ last_read_at: now })
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .execute();

    // Notify other participant(s) via SSE
    const others = await this.deps.db.db
      .selectFrom("conversation_participants")
      .select("user_id")
      .where("conversation_id", "=", conversationId)
      .where("user_id", "<>", userId)
      .execute();

    const realtime = this.deps.realtime;
    if (realtime && others.length > 0) {
      const nowStr = now.toISOString();
      others.forEach((other) => {
        realtime.publish(other.user_id, {
          kind: "read_receipt",
          data: {
            conversation_id: conversationId,
            user_id: userId,
            last_read_at: nowStr,
          },
        });
      });
    }
  }

  async sendTypingStatus(userId: string, conversationId: string, isTyping: boolean): Promise<void> {
    const participant = await this.deps.db.db
      .selectFrom("conversation_participants")
      .select(["user_id"])
      .where("conversation_id", "=", conversationId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!participant) throw new ForbiddenError("Not a participant in this conversation");

    const others = await this.deps.db.db
      .selectFrom("conversation_participants")
      .select("user_id")
      .where("conversation_id", "=", conversationId)
      .where("user_id", "<>", userId)
      .execute();

    const realtime = this.deps.realtime;
    if (realtime && others.length > 0) {
      others.forEach((other) => {
        realtime.publish(other.user_id, {
          kind: "typing",
          data: {
            conversation_id: conversationId,
            user_id: userId,
            is_typing: isTyping,
          },
        });
      });
    }
  }
}
