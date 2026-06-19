import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import { NotFoundError } from "../../shared/errors/AppError.js";
import { type NotificationType } from "../../shared/db/types.js";
import { type PushService } from "../push/push.service.js";
import { type RealtimeBus } from "../realtime/realtime.bus.js";
import { type NotificationPreferencesService } from "../notification-preferences/notification-preferences.service.js";

export interface NotificationsServiceDeps {
  db: DbHandle;
  /** Optional push fan-out. Wired in production; left undefined in unit
   *  tests that only exercise the in-DB notification row. */
  push?: PushService | undefined;
  /** Optional realtime bus. When set, every successful `emit()` also
   *  publishes a `notification` event to any SSE subscribers for the
   *  target user. Left undefined in unit tests. */
  realtime?: RealtimeBus | undefined;
  /** Optional preferences gateway. When set, `emit()` consults
   *  `shouldPush()` before delivering through APNs (the in-DB row and
   *  the SSE event are NOT gated — those are required for the
   *  notifications screen + live UI consistency). Tests that don't
   *  care about preferences omit this and always push. */
  preferences?: NotificationPreferencesService | undefined;
}

export interface NotificationOut {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsPage {
  items: NotificationOut[];
  unread_count: number;
}

export class NotificationsService {
  constructor(private readonly deps: NotificationsServiceDeps) {}

  async list(userId: string, limit = 50): Promise<NotificationsPage> {
    const rows = await this.deps.db.db
      .selectFrom("notifications")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();

    const unreadCount = await this.deps.db.db
      .selectFrom("notifications")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("user_id", "=", userId)
      .where("read_at", "is", null)
      .executeTakeFirstOrThrow();

    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        payload: r.payload,
        read_at: r.read_at?.toISOString() ?? null,
        created_at: r.created_at.toISOString(),
      })),
      unread_count: Number(unreadCount.c),
    };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const res = await this.deps.db.db
      .updateTable("notifications")
      .set({ read_at: new Date() })
      .where("id", "=", notificationId)
      .where("user_id", "=", userId)
      .where("read_at", "is", null)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) {
      // Check existence so caller distinguishes 404 from "already read"
      const exists = await this.deps.db.db
        .selectFrom("notifications")
        .select("id")
        .where("id", "=", notificationId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (!exists) throw new NotFoundError("Notification not found");
    }
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.deps.db.db
      .updateTable("notifications")
      .set({ read_at: new Date() })
      .where("user_id", "=", userId)
      .where("read_at", "is", null)
      .executeTakeFirst();
    return { updated: Number(res.numUpdatedRows) };
  }

  /**
   * Delete a single notification owned by the caller. Throws 404 when the
   * row does not exist or belongs to a different user — we intentionally
   * conflate the two so we don't leak existence of other users' rows.
   */
  async deleteOne(notificationId: string, userId: string): Promise<void> {
    const res = await this.deps.db.db
      .deleteFrom("notifications")
      .where("id", "=", notificationId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) {
      throw new NotFoundError("Notification not found");
    }
  }

  /** Delete every notification belonging to the caller. Idempotent — a
   *  call with nothing to delete is a no-op (caller still gets 204). */
  async deleteAll(userId: string): Promise<void> {
    await this.deps.db.db
      .deleteFrom("notifications")
      .where("user_id", "=", userId)
      .execute();
  }

  /**
   * Emit a notification — called from other services (games, ratings, etc.).
   * Pass an existing transaction executor to bundle the emit with the
   * triggering write (e.g., when host marks no-show, emit + update inside
   * the same tx so the user either sees both or neither).
   *
   * ## Payload contract (iOS deeplink routing)
   *
   * Every payload SHOULD include at least one of `game_id`, `conversation_id`,
   * `user_id`, `venue_id`, `follower_user_id`, `rating_id`, or `tournament_id`
   * so the iOS tap handler can deeplink to the relevant screen. The helper
   * `extractEntityId` below promotes the first of these it finds to
   * `data.entity_id` in the APNs payload, so iOS can route without having to
   * know every domain-specific key.
   *
   * Expected payload shapes per type:
   *
   * - `message_received`:  { conversation_id: string }
   * - `game_joined`:       { game_id: string }
   * - `game_cancelled`:    { game_id: string, by?: "host" | "admin", reason?: string }
   * - `game_reminder`:     { game_id: string, starts_at?: string }
   * - `no_show_marked`:    { game_id: string }
   * - `rating_received`:   { rating_id: string, game_id: string }
   * - `tournament_invite`: { game_id?: string, tournament_id?: string,
   *                          invitation_id?: string, inviter_user_id?: string,
   *                          kind?: "game_invite" | "tournament_invite" }
   * - `system`:            free-form. Known routing shapes:
   *                        follow → `{ event: "follow", follower_user_id: string }`
   *                        feed comment → `{ kind: "feed:comment",
   *                        entity_id: string, event_id: string,
   *                        comment_id: string, commenter_user_id: string }`
   *
   * The `payload` parameter is typed `Record<string, unknown>` for flexibility,
   * but call sites are expected to honour the above contract. A discriminated
   * union would be safer; tracked as a follow-up rather than a blocking change
   * since the current call sites all comply.
   */
  async emit(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const payload = params.payload ?? {};
    await withTransaction(this.deps.db.db, async (tx) => {
      await tx
        .insertInto("notifications")
        .values({
          user_id: params.userId,
          type: params.type,
          title: params.title,
          body: params.body,
          payload,
        })
        .execute();
    });

    // Realtime fan-out — push to any SSE subscribers for the recipient.
    // This runs INSIDE the request hot-path because it's an in-memory
    // EventEmitter call (microseconds, not network); a synchronous publish
    // is acceptable. The push to APNs below still happens regardless so
    // backgrounded clients still get a wake.
    if (this.deps.realtime) {
      this.deps.realtime.publish(params.userId, {
        kind: "notification",
        data: {
          type: params.type,
          title: params.title,
          body: params.body,
          payload,
          created_at: new Date().toISOString(),
        },
      });
    }

    // Push fan-out runs OUTSIDE the transaction so a missing token / APNs
    // hiccup never rolls back the in-app notification row. `deliverToUser`
    // uses `Promise.allSettled` internally, so per-token failures are
    // already isolated. We deliberately don't `await` it on the request
    // hot-path either — but for testability we DO await so callers can
    // assert that push attempts ran. `deliverToUser` is best-effort and
    // logs any unexpected failures itself.
    //
    // Preferences gating: when a preferences service is wired, we ask
    // whether this (user, type) wants push right now. The query also
    // covers quiet hours. A "no" here skips APNs entirely — the in-DB
    // row + SSE event were already delivered above so the user still
    // sees the notification when they open the app, they just don't
    // get a phone-buzz at 3am.
    if (this.deps.push) {
      const shouldPush = this.deps.preferences === undefined
        ? true
        : await this.deps.preferences.shouldPush(params.userId, params.type);
      if (!shouldPush) {
        return;
      }
      const grouping = deriveGrouping(params.type, payload);
      try {
        // Spread `grouping` so `threadId` / `collapseId` are only present
        // when defined — `exactOptionalPropertyTypes` rejects an explicit
        // `undefined` here.
        await this.deps.push.deliverToUser(params.userId, {
          type: params.type,
          title: params.title,
          body: params.body,
          data: { entity_id: extractEntityId(payload), ...payload },
          ...grouping,
        });
      } catch {
        // Swallow — a busted push transport must never break the caller.
      }
    }
  }
}

/**
 * Best-effort hint: many emit-payloads already carry a domain id under one
 * of these well-known keys. Surfacing it as `entity_id` lets the iOS tap
 * handler route without having to know every variation.
 *
 * Order matters: keys earlier in the list win when a payload carries multiple
 * (e.g. an invitation row has both `invitation_id` and `game_id` — iOS routes
 * to the game, so `game_id` is checked first).
 */
function extractEntityId(payload: Record<string, unknown>): string | undefined {
  for (const key of [
    "entity_id",
    "game_id",
    "conversation_id",
    "rating_id",
    "tournament_id",
    "invitation_id",
    "follower_user_id",
    "user_id",
    "venue_id",
  ]) {
    const v = payload[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Derive APNs grouping hints so iOS can collapse repeated banners about the
 * same logical thing:
 *
 *  - `threadId` → `aps.thread-id`. Groups banners on the lock screen.
 *    Example: five new messages in the same conversation stack as one card.
 *  - `collapseId` → `apns-collapse-id` header. Tells APNs that a newer
 *    notification supersedes any older undelivered one with the same id —
 *    e.g. a fresh `game_reminder` replaces one queued five minutes ago.
 *
 * Mapping:
 *  - `message_received` keyed by `conversation_id` → thread `conversation:<id>`.
 *  - `game_*` types (`game_joined`, `game_cancelled`, `game_reminder`,
 *    `no_show_marked`, `rating_received`) keyed by `game_id` →
 *    thread `game:<id>`.
 *  - `tournament_invite` keyed by `game_id` when present → thread `game:<id>`.
 *  - feed-comment `system` notifications keyed by `entity_id`/`event_id` →
 *    thread `feed_comment:<id>`.
 *  - other `system` events (and anything without a clear anchor) → no
 *    grouping; iOS will show each banner standalone, which is the right
 *    default for free-form events.
 *
 * `collapseId` mirrors `threadId` so that repeated reminders about the same
 * game replace each other rather than stacking. Conversation messages use a
 * type-scoped collapse id (`message:conversation:<id>`) so a `message_received`
 * doesn't replace e.g. a `game_reminder` for the same game-as-conversation
 * (different namespaces, so this is a defensive narrowing).
 */
function deriveGrouping(
  type: NotificationType,
  payload: Record<string, unknown>,
): { threadId?: string; collapseId?: string } {
  const conversationId = typeof payload.conversation_id === "string"
    ? payload.conversation_id
    : undefined;
  const gameId = typeof payload.game_id === "string"
    ? payload.game_id
    : undefined;

  if (type === "message_received" && conversationId !== undefined && conversationId.length > 0) {
    const thread = `conversation:${conversationId}`;
    return { threadId: thread, collapseId: `message:${thread}` };
  }

  if (type === "system" && payload.kind === "feed:comment") {
    const feedEventId = typeof payload.entity_id === "string"
      ? payload.entity_id
      : typeof payload.event_id === "string"
        ? payload.event_id
        : undefined;
    if (feedEventId !== undefined && feedEventId.length > 0) {
      const thread = `feed_comment:${feedEventId}`;
      return { threadId: thread, collapseId: `system:${thread}` };
    }
  }

  // Every game-anchored type groups under the game thread. A second
  // `game_reminder` for the same game replaces the first via collapse-id;
  // distinct types (e.g. `game_cancelled` vs `game_reminder`) use a
  // type-scoped collapse id so a cancellation doesn't overwrite a pending
  // reminder before the user has seen either.
  if (gameId !== undefined && gameId.length > 0 && (
    type === "game_joined" ||
    type === "game_cancelled" ||
    type === "game_reminder" ||
    type === "no_show_marked" ||
    type === "rating_received" ||
    type === "tournament_invite"
  )) {
    const thread = `game:${gameId}`;
    return { threadId: thread, collapseId: `${type}:${thread}` };
  }

  return {};
}
