import { Buffer } from "node:buffer";
import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { ValidationError } from "../../shared/errors/AppError.js";
import {
  type FeedEmitter,
  type EmitFeedEventInput,
  type FeedEventOut,
  type FeedPage,
} from "./feed.types.js";

export interface FeedServiceDeps {
  db: DbHandle;
}

export interface FeedListQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Cursor encodes the (created_at, id) of the last row in the previous page.
 * id is the tie-breaker so identical timestamps are still totally ordered.
 * Base64-url is opaque to the client — they treat it as an unstructured
 * string. We deliberately don't sign it: feed pages aren't privileged data,
 * worst case a client tampers and gets a 400 from the cursor decoder.
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
 * FeedService — reads from `feed_events` for the caller's timeline, and
 * implements the `FeedEmitter` contract so other modules (and the fan-out
 * worker) can write events through a single chokepoint.
 *
 * Read query rules:
 *   - For a signed-in viewer: returns events authored by the viewer OR by
 *     anyone the viewer follows OR public events from anyone, while
 *     dropping `private` events authored by others (only the author sees
 *     them) and dropping any event whose actor is in a mutual block
 *     relationship with the viewer (bidirectional `user_blocks`).
 *   - For an anonymous caller (`viewerUserId === null`): returns the
 *     public-visibility events only. No block filter applies — there's no
 *     viewer to filter against.
 *   - Newest-first; cursor pagination over (created_at DESC, id DESC).
 */
export class FeedService implements FeedEmitter {
  constructor(private readonly deps: FeedServiceDeps) {}

  async emit(input: EmitFeedEventInput): Promise<void> {
    const payload: Record<string, unknown> = { ...(input.payload ?? {}) };
    if (input.sourceKey) {
      payload.source_key = input.sourceKey;
    }
    const visibility = input.visibility ?? "followers";

    // ON CONFLICT targets the partial unique index defined in the migration
    // (`feed_events_dedupe_idx`). When `source_key` is absent the index's
    // WHERE clause excludes the row entirely, so the constraint can't fire
    // and the insert proceeds unconditionally. We use raw SQL because
    // Kysely's typed onConflict builder can't express
    // `((payload->>'source_key'))` as a conflict target column expression.
    await sql`
      INSERT INTO feed_events (actor_user_id, type, payload, visibility)
      VALUES (
        ${input.actorUserId}::uuid,
        ${input.type}::feed_event_type,
        ${JSON.stringify(payload)}::jsonb,
        ${visibility}::feed_visibility
      )
      ON CONFLICT (actor_user_id, type, (payload->>'source_key'))
        WHERE payload ? 'source_key'
      DO NOTHING
    `.execute(this.deps.db.db);
  }

  async list(viewerUserId: string | null, query: FeedListQuery): Promise<FeedPage> {
    const limit = clampLimit(query.limit);
    let cursor: CursorPayload | null = null;
    if (query.cursor !== undefined && query.cursor.length > 0) {
      cursor = decodeCursor(query.cursor);
      if (!cursor) throw new ValidationError("Invalid cursor");
    }

    // We fetch limit+1 to detect "is there a next page". The extra row is
    // sliced off before returning; its cursor is what becomes `next_cursor`.
    //
    // The OR/AND visibility predicate (signed-in viewer):
    //   - actor is self → always visible (so private events are visible to
    //     their author)
    //   - actor is in the followed set AND visibility != private → visible
    //   - actor is public AND visibility = public → visible to all
    //
    // For an anonymous viewer (viewerUserId === null) we collapse the
    // predicate to "visibility = 'public'" — no self, no follows, and no
    // block filter applies (there's no viewer to block).
    const rows = await sql<{
      id: string;
      type: string;
      actor_user_id: string;
      display_name: string;
      photo_url: string | null;
      payload: Record<string, unknown>;
      visibility: string;
      created_at: Date;
      likes_count: string;
      liked_by_me: boolean;
    }>`
      SELECT fe.id, fe.type, fe.actor_user_id, fe.payload, fe.visibility, fe.created_at,
             u.display_name, u.photo_url,
             (SELECT COUNT(*) FROM feed_event_reactions r WHERE r.feed_event_id = fe.id)::text AS likes_count,
             ${
               viewerUserId !== null
                 ? sql`EXISTS (SELECT 1 FROM feed_event_reactions r WHERE r.feed_event_id = fe.id AND r.user_id = ${viewerUserId})`
                 : sql`FALSE`
             } AS liked_by_me
        FROM feed_events fe
        JOIN users u ON u.id = fe.actor_user_id
       WHERE u.deleted_at IS NULL
         AND ${
           viewerUserId !== null
             ? sql`(
                 fe.actor_user_id = ${viewerUserId}
                 OR (
                   fe.visibility <> 'private'
                   AND (
                     fe.visibility = 'public'
                     OR EXISTS (
                       SELECT 1 FROM follows f
                        WHERE f.follower_user_id = ${viewerUserId}
                          AND f.followed_user_id = fe.actor_user_id
                     )
                   )
                 )
               )`
             : sql`fe.visibility = 'public'`
         }
         ${
           viewerUserId !== null
             ? sql`AND NOT EXISTS (
                     SELECT 1 FROM user_blocks ub
                      WHERE (ub.blocker_user_id = ${viewerUserId} AND ub.blocked_user_id = fe.actor_user_id)
                         OR (ub.blocker_user_id = fe.actor_user_id AND ub.blocked_user_id = ${viewerUserId})
                   )`
             : sql``
         }
         ${
           cursor
             ? sql`AND (fe.created_at, fe.id) < (${cursor.created_at}::timestamptz, ${cursor.id}::uuid)`
             : sql``
         }
       ORDER BY fe.created_at DESC, fe.id DESC
       LIMIT ${limit + 1}
    `.execute(this.deps.db.db);

    const hasMore = rows.rows.length > limit;
    const trimmed = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const items: FeedEventOut[] = trimmed.map((r) => ({
      id: r.id,
      // The narrow cast is sound because the column is a Postgres ENUM with
      // exactly these labels — but we still rely on the DB CHECK / enum to
      // gate writes, never the read side.
      type: r.type as FeedEventOut["type"],
      actor: {
        id: r.actor_user_id,
        display_name: r.display_name,
        photo_url: r.photo_url,
      },
      payload: r.payload,
      visibility: r.visibility as FeedEventOut["visibility"],
      created_at: r.created_at.toISOString(),
      likes_count: Number.parseInt(r.likes_count, 10),
      liked_by_me: r.liked_by_me,
    }));

    const last = items[items.length - 1];
    const next_cursor =
      hasMore && last
        ? encodeCursor({ created_at: last.created_at, id: last.id })
        : null;

    return { items, next_cursor };
  }

  /**
   * Idempotent like. The composite PK on (feed_event_id, user_id) makes
   * the underlying INSERT a no-op when the row already exists, so we
   * `ON CONFLICT DO NOTHING` and report success either way. Returns the
   * fresh like count so the client can update without a second round-trip.
   *
   * Throws NotFoundError if the feed event doesn't exist. We deliberately
   * don't enforce the visibility rules here — once an event is visible
   * to the user in their feed, liking it is allowed; the next /feed
   * fetch will or won't include it based on the same predicate.
   */
  async like(userId: string, feedEventId: string): Promise<{ likes_count: number }> {
    const exists = await this.deps.db.db
      .selectFrom("feed_events")
      .select("id")
      .where("id", "=", feedEventId)
      .executeTakeFirst();
    if (exists === undefined) {
      throw new ValidationError("Feed event not found");
    }

    await this.deps.db.db
      .insertInto("feed_event_reactions")
      .values({ feed_event_id: feedEventId, user_id: userId })
      .onConflict((oc) => oc.columns(["feed_event_id", "user_id"]).doNothing())
      .execute();

    return this.countLikes(feedEventId);
  }

  /** Idempotent unlike. Removing a non-existent like is a no-op. */
  async unlike(userId: string, feedEventId: string): Promise<{ likes_count: number }> {
    await this.deps.db.db
      .deleteFrom("feed_event_reactions")
      .where("feed_event_id", "=", feedEventId)
      .where("user_id", "=", userId)
      .execute();

    return this.countLikes(feedEventId);
  }

  private async countLikes(feedEventId: string): Promise<{ likes_count: number }> {
    const row = await this.deps.db.db
      .selectFrom("feed_event_reactions")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("feed_event_id", "=", feedEventId)
      .executeTakeFirstOrThrow();
    return { likes_count: Number(row.count) };
  }
}
