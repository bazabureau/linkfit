import { Buffer } from "node:buffer";
import { type Logger } from "pino";
import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors/AppError.js";
import { type RealtimeBus } from "../realtime/realtime.bus.js";
import { type NotificationsService } from "../social/notifications.service.js";
import { type CommentOut, type CommentsPage } from "./feed-comments.schema.js";

export interface FeedCommentsServiceDeps {
  db: DbHandle;
  notifications: NotificationsService;
  realtime: RealtimeBus;
  logger: Logger;
}

export interface ListQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Cursor encodes (created_at, id) of the LAST row in the previous page.
 * Same shape the feed module uses — keyset pagination over
 * (created_at DESC, id DESC) so identical timestamps stay totally ordered.
 * Opaque to the iOS client.
 */
interface CursorPayload {
  created_at: string;
  id: string;
}

function encodeCursor(c: CursorPayload): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
function decodeCursor(s: string): CursorPayload | null {
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "created_at" in parsed &&
      "id" in parsed &&
      typeof (parsed as { created_at: unknown }).created_at === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as CursorPayload;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (limit < 1) return 1;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return Math.trunc(limit);
}

/**
 * FeedCommentsService — CRUD over `feed_comments` plus the realtime +
 * notification side-effects fired from `create`.
 *
 * All SQL is hand-written with the `sql` template tag rather than going
 * through Kysely's typed query builder. That's a deliberate choice: the
 * `feed_comments` table isn't (yet) listed in the shared `Database`
 * Kysely interface — adding it would touch a file owned by another
 * agent. Raw `sql` keeps this module self-contained and still uses the
 * same parameterized-query path Kysely produces under the hood, so
 * there's no SQL-injection delta vs. the typed builder.
 *
 * Permission model:
 *   - POST: any authenticated user can comment on any event they can see.
 *     We don't replay the full feed-visibility predicate (private events
 *     would already 404 from `/feed`), but we DO drop the request if the
 *     commenter and the event's actor are in a bidirectional `user_blocks`
 *     relationship. That keeps a blocked user from harassing the actor via
 *     comments even if they somehow obtained the event id.
 *   - GET: anyone can list. We don't gate reads — comments are a community
 *     surface and the event's underlying visibility already gates whether
 *     the iOS card is renderable.
 *   - DELETE: either the comment's author OR the event's actor (so the
 *     actor can moderate their own card). Anyone else gets a 403.
 *
 * Side-effects on POST:
 *   - Publishes a `feed:comment` SSE event to the event actor (so iOS can
 *     bump the comment count + slide the new row into the bottom of the
 *     thread without a refetch). Fire-and-forget — a missing subscriber
 *     is fine, the comment is durable in DB regardless.
 *   - Emits a durable in-app notification + APNs alert to the actor IF the
 *     commenter is not the actor. Self-comments stay live-only; that would
 *     otherwise buzz the actor for their own typing.
 *   - Both side-effects are skipped when the actor has blocked the
 *     commenter or vice versa (the row insert is also blocked in that
 *     case via a NOT EXISTS guard).
 */
export class FeedCommentsService {
  constructor(private readonly deps: FeedCommentsServiceDeps) {}

  /**
   * Insert a comment and fan out side-effects.
   * Returns the persisted row (with the commenter's display_name/photo_url
   * joined in) so the iOS client doesn't need a second round-trip to
   * render the optimistic row's final form.
   */
  async create(
    commenterUserId: string,
    eventId: string,
    body: string,
  ): Promise<CommentOut> {
    // Defensive: the route already validated via Zod (1..500 after trim),
    // but if a downstream caller bypasses that we want a typed 400 here too.
    const trimmed = body.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      throw new ValidationError("Comment body must be 1..500 chars");
    }

    // Resolve the event's actor up-front so we can both (a) reject
    // commenter↔actor blocks and (b) target the SSE/push fan-out. A missing
    // event yields a typed 404 — Fastify maps that to the error envelope.
    const eventRow = await sql<{ actor_user_id: string }>`
      SELECT actor_user_id FROM feed_events WHERE id = ${eventId}::uuid
    `.execute(this.deps.db.db);
    const eventRowFirst = eventRow.rows[0];
    if (eventRowFirst === undefined) {
      throw new NotFoundError("Feed event not found");
    }
    const actorUserId = eventRowFirst.actor_user_id;

    // Bidirectional block check. We check before the INSERT so the user
    // never accidentally creates an orphaned row that the actor would
    // immediately want torn down. The NOT EXISTS form matches the rest of
    // the codebase (feed.service.list, stories-realtime, etc.).
    if (commenterUserId !== actorUserId) {
      const blocked = await sql<{ blocked: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM user_blocks ub
           WHERE (ub.blocker_user_id = ${commenterUserId}::uuid
                  AND ub.blocked_user_id = ${actorUserId}::uuid)
              OR (ub.blocker_user_id = ${actorUserId}::uuid
                  AND ub.blocked_user_id = ${commenterUserId}::uuid)
        ) AS blocked
      `.execute(this.deps.db.db);
      if (blocked.rows[0]?.blocked === true) {
        // 403, not 404 — surfacing "the event exists but you can't comment"
        // is fine. iOS already hides blocked users' cards from the feed, so
        // hitting this path in normal use would be a client bug.
        throw new ForbiddenError("You cannot comment on this event");
      }
    }

    // Insert + return joined commenter info in a single round-trip via CTE.
    const insertResult = await sql<{
      id: string;
      user_id: string;
      body: string;
      created_at: Date;
      display_name: string;
      photo_url: string | null;
    }>`
      WITH inserted AS (
        INSERT INTO feed_comments (event_id, user_id, body)
        VALUES (${eventId}::uuid, ${commenterUserId}::uuid, ${trimmed})
        RETURNING id, user_id, body, created_at
      )
      SELECT i.id, i.user_id, i.body, i.created_at, u.display_name, u.photo_url
        FROM inserted i
        JOIN users u ON u.id = i.user_id
    `.execute(this.deps.db.db);
    const row = insertResult.rows[0];
    if (row === undefined) {
      // RETURNING from an INSERT always produces a row; this is purely
      // defensive against a future schema change.
      throw new Error("INSERT into feed_comments returned no row");
    }

    const out: CommentOut = {
      id: row.id,
      user_id: row.user_id,
      user_display_name: row.display_name,
      user_avatar_url: row.photo_url,
      body: row.body,
      created_at: row.created_at.toISOString(),
    };

    // SSE fan-out to the event actor — so the iOS feed card can live-bump
    // its comment counter and (if the comments sheet is open) splice the
    // new row in. We publish even when the commenter IS the actor; that
    // way the actor's other devices see the comment they typed appear on
    // their own card without a refetch.
    this.deps.realtime.publish(actorUserId, {
      kind: "feed:comment",
      data: {
        event_id: eventId,
        comment: out,
      },
    });

    // Durable notification + APNs alert — only when the commenter is NOT
    // the actor. Self-comments don't notify because that would buzz the
    // actor's phone for their own typing. We don't fail the request on a
    // notification error; the comment row and feed SSE event are already
    // committed.
    if (commenterUserId !== actorUserId) {
      try {
        await this.deps.notifications.emit({
          userId: actorUserId,
          type: "system",
          title: row.display_name,
          body:
            trimmed.length > 120
              ? `${trimmed.slice(0, 117)}...`
              : trimmed,
          payload: {
            kind: "feed:comment",
            entity_id: eventId,
            event_id: eventId,
            comment_id: out.id,
            commenter_user_id: commenterUserId,
          },
        });
      } catch (err) {
        this.deps.logger.warn(
          { err, eventId, actorUserId, commenterUserId },
          "feed_comments.notification.failed",
        );
      }
    }

    return out;
  }

  /**
   * Keyset-paginated newest-first list. Returns up to `limit` comments
   * (default 20, max 100). `total` is the count of ALL comments for the
   * event so iOS can render "N comments" without paging.
   *
   * No visibility / block filtering here — the event's underlying
   * visibility already gates whether the iOS card is showing in the first
   * place. Spam from blocked users is the create-path's problem (we
   * reject the insert) so a fresh GET won't surface a comment that was
   * never persisted.
   */
  async list(eventId: string, query: ListQuery): Promise<CommentsPage> {
    const limit = clampLimit(query.limit);
    let cursor: CursorPayload | null = null;
    if (query.cursor !== undefined && query.cursor.length > 0) {
      cursor = decodeCursor(query.cursor);
      if (!cursor) throw new ValidationError("Invalid cursor");
    }

    // Confirm the event exists. A 404 here is cheaper than a silent
    // empty-list for "the event id you sent doesn't exist" — the iOS UI
    // can show "this post is gone" rather than "no comments yet".
    const eventRow = await sql<{ id: string }>`
      SELECT id FROM feed_events WHERE id = ${eventId}::uuid
    `.execute(this.deps.db.db);
    if (eventRow.rows[0] === undefined) {
      throw new NotFoundError("Feed event not found");
    }

    // Fetch limit+1 to detect the next page. The extra row is sliced off
    // and its cursor becomes `next_cursor`.
    const rows = await sql<{
      id: string;
      user_id: string;
      display_name: string;
      photo_url: string | null;
      body: string;
      created_at: Date;
    }>`
      SELECT c.id, c.user_id, c.body, c.created_at,
             u.display_name, u.photo_url
        FROM feed_comments c
        JOIN users u ON u.id = c.user_id
       WHERE c.event_id = ${eventId}::uuid
         AND u.deleted_at IS NULL
         ${
           cursor
             ? sql`AND (c.created_at, c.id) < (${cursor.created_at}::timestamptz, ${cursor.id}::uuid)`
             : sql``
         }
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ${limit + 1}
    `.execute(this.deps.db.db);

    const hasMore = rows.rows.length > limit;
    const trimmed = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const comments: CommentOut[] = trimmed.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      user_display_name: r.display_name,
      user_avatar_url: r.photo_url,
      body: r.body,
      created_at: r.created_at.toISOString(),
    }));

    const last = comments[comments.length - 1];
    const next_cursor =
      hasMore && last
        ? encodeCursor({ created_at: last.created_at, id: last.id })
        : null;

    // Total count — single roundtrip, plain COUNT(*). For the comment
    // volumes we expect (tens, maybe low hundreds per card) the cost is
    // negligible. If we ever hit thousands-per-card we can switch to a
    // denormalized counter on `feed_events` or a streaming sequence.
    const totalRow = await sql<{ total: string }>`
      SELECT COUNT(*)::text AS total FROM feed_comments WHERE event_id = ${eventId}::uuid
    `.execute(this.deps.db.db);
    const total = Number.parseInt(totalRow.rows[0]?.total ?? "0", 10);

    return { comments, next_cursor, total };
  }

  /**
   * Delete a comment. Allowed for the comment's author OR for the event's
   * actor (so the actor can moderate their own card). A missing comment
   * yields 404; a forbidden caller yields 403.
   */
  async delete(callerUserId: string, commentId: string): Promise<void> {
    const ownerRow = await sql<{
      comment_user_id: string;
      actor_user_id: string;
    }>`
      SELECT c.user_id AS comment_user_id, e.actor_user_id
        FROM feed_comments c
        JOIN feed_events e ON e.id = c.event_id
       WHERE c.id = ${commentId}::uuid
    `.execute(this.deps.db.db);
    const owner = ownerRow.rows[0];
    if (owner === undefined) {
      throw new NotFoundError("Comment not found");
    }

    const isAuthor = owner.comment_user_id === callerUserId;
    const isEventActor = owner.actor_user_id === callerUserId;
    if (!isAuthor && !isEventActor) {
      throw new ForbiddenError("You cannot delete this comment");
    }

    await sql`
      DELETE FROM feed_comments WHERE id = ${commentId}::uuid
    `.execute(this.deps.db.db);
  }
}
