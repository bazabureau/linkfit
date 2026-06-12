import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type NotificationsService } from "./notifications.service.js";
import { FeedService } from "../feed/feed.service.js";
import { type FeedEmitter } from "../feed/feed.types.js";
import { type SpamChecks } from "../../shared/security/spam-checks.js";

export interface FollowsServiceDeps {
  db: DbHandle;
  notifications: NotificationsService;
  /**
   * Optional feed emitter — when present, a fresh follow synchronously
   * emits a `followed_user` activity event. Fire-and-forget; failures
   * never bubble out of `follow()`. Defaults to a FeedService built
   * from `db`.
   */
  feed?: FeedEmitter | undefined;
  /**
   * Optional trust & safety hook. When provided, `follow()`:
   *   - returns a silent no-op when the actor is already
   *     `flagged_for_review` (admin triage queue);
   *   - asks the spam-checks module to evaluate the burst threshold
   *     after each successful insert, so a tipping-point follow is
   *     what raises the flag.
   * Omitted in legacy unit tests; the full server wires it.
   */
  spamChecks?: SpamChecks | undefined;
}

export interface FollowEdgeUser {
  id: string;
  display_name: string;
  photo_url: string | null;
  followed_at: string;
  is_following: boolean;
}

export interface FollowsPage {
  items: FollowEdgeUser[];
  next_offset: number | null;
}

export interface FollowsListQuery {
  limit?: number | undefined;
  offset?: number | undefined;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (limit < 1) return 1;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return Math.trunc(limit);
}

export class FollowsService {
  private readonly feed: FeedEmitter;

  constructor(private readonly deps: FollowsServiceDeps) {
    this.feed = deps.feed ?? new FeedService({ db: deps.db });
  }

  /**
   * Follow `targetUserId` on behalf of `followerUserId`. Idempotent — repeated
   * calls do not duplicate the row and only emit a notification on first
   * insert.
   *
   * Trust & safety: if `spamChecks` is wired and the actor is already
   * `flagged_for_review`, the call short-circuits as a silent no-op
   * (no edge inserted, no notification emitted, no error returned). This
   * is the "shadow rate-limit" applied to flagged accounts so the client
   * can't tell that the limit kicked in. Legit users are not affected —
   * only accounts that already tripped the burst tripwire.
   */
  async follow(followerUserId: string, targetUserId: string): Promise<void> {
    if (followerUserId === targetUserId) {
      throw new ValidationError("Cannot follow yourself");
    }

    // Shadow rate-limit: pre-flagged actors get a silent 204 with no DB
    // side-effects. The flag is set by the burst tripwire below; once
    // raised it persists until an admin clears it via /api/v1/admin/*.
    if (this.deps.spamChecks !== undefined) {
      const flagged = await this.deps.spamChecks.isFlaggedForReview(followerUserId);
      if (flagged) return;
    }

    const target = await this.deps.db.db
      .selectFrom("users")
      .select(["id", "display_name"])
      .where("id", "=", targetUserId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!target) throw new NotFoundError("User not found");

    const inserted = await this.deps.db.db
      .insertInto("follows")
      .values({
        follower_user_id: followerUserId,
        followed_user_id: targetUserId,
      })
      .onConflict((oc) => oc.columns(["follower_user_id", "followed_user_id"]).doNothing())
      .executeTakeFirst();

    // Only emit the notification when this is a fresh follow. node-pg's
    // INSERT...ON CONFLICT DO NOTHING reports 0 numInsertedOrUpdatedRows on a
    // duplicate, so we use that to short-circuit re-notifications.
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return;

    const follower = await this.deps.db.db
      .selectFrom("users")
      .select("display_name")
      .where("id", "=", followerUserId)
      .executeTakeFirst();
    await this.deps.notifications.emit({
      userId: targetUserId,
      type: "system",
      title: "New follower",
      body: `${follower?.display_name ?? "Someone"} started following you`,
      payload: { follower_user_id: followerUserId, event: "follow" },
    });

    // Fire-and-forget activity feed emit. Same `sourceKey` shape as the
    // polling worker in `feed.worker.ts` so the two paths converge on the
    // same row and a re-emit (e.g. if the worker swept this follow before
    // the synchronous emit landed) is dropped by the partial unique index.
    // We `await` here (instead of fire-and-forget) so the burst tripwire
    // below has a deterministic read; failure swallowed via `.catch()`.
    await this.feed
      .emit({
        actorUserId: followerUserId,
        type: "followed_user",
        payload: { followed_user_id: targetUserId },
        sourceKey: `follow:${followerUserId}:${targetUserId}`,
      })
      .catch(() => {
        /* swallow — feed emission must never break follow() */
      });

    // Burst tripwire: counts the actor's `followed_user` events in the
    // configured window. If `>= threshold`, flips `users.flagged_for_review`
    // so subsequent calls hit the shadow rate-limit above and an admin
    // can review. Failure is non-fatal — never break `follow()`.
    if (this.deps.spamChecks !== undefined) {
      await this.deps.spamChecks
        .recordSuspiciousActivity(followerUserId, "follow_burst")
        .catch(() => {
          /* swallow — tripwire failures must never break follow() */
        });
    }
  }

  /**
   * Unfollow — also idempotent. Returns silently if no edge existed.
   */
  async unfollow(followerUserId: string, targetUserId: string): Promise<void> {
    if (followerUserId === targetUserId) {
      throw new ValidationError("Cannot unfollow yourself");
    }
    await this.deps.db.db
      .deleteFrom("follows")
      .where("follower_user_id", "=", followerUserId)
      .where("followed_user_id", "=", targetUserId)
      .execute();
  }

  /**
   * Forcibly remove a follower edge on behalf of the profile owner. The
   * deleted edge is `(follower_user_id = followerUserId, followed_user_id =
   * profileUserId)`. Only the profile owner (viewer === profileUserId) may
   * call this; otherwise throws ForbiddenError. Idempotent — silently
   * succeeds when no edge exists.
   */
  async removeFollower(
    viewerUserId: string,
    profileUserId: string,
    followerUserId: string,
  ): Promise<void> {
    if (viewerUserId !== profileUserId) {
      throw new ForbiddenError("You can only manage your own followers");
    }
    await this.deps.db.db
      .deleteFrom("follows")
      .where("follower_user_id", "=", followerUserId)
      .where("followed_user_id", "=", profileUserId)
      .execute();
  }

  /**
   * Users that follow `userId`. Newest-first; offset paginated.
   */
  async followers(userId: string, viewerUserId: string, query: FollowsListQuery): Promise<FollowsPage> {
    await this.assertUserExists(userId);
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const rows = await sql<{
      id: string;
      display_name: string;
      photo_url: string | null;
      created_at: Date;
      is_following: boolean;
    }>`
      SELECT u.id, u.display_name, u.photo_url, f.created_at,
             EXISTS (
               SELECT 1 FROM follows
                WHERE follower_user_id = ${viewerUserId}
                  AND followed_user_id = u.id
             ) AS is_following
        FROM follows f
        JOIN users u ON u.id = f.follower_user_id
       WHERE f.followed_user_id = ${userId}
         AND u.deleted_at IS NULL
       ORDER BY f.created_at DESC, u.id ASC
       LIMIT ${limit + 1}
      OFFSET ${offset}
    `.execute(this.deps.db.db);

    const hasMore = rows.rows.length > limit;
    const items = (hasMore ? rows.rows.slice(0, limit) : rows.rows).map((r) => ({
      id: r.id,
      display_name: r.display_name,
      photo_url: r.photo_url,
      followed_at: r.created_at.toISOString(),
      is_following: r.is_following,
    }));
    return { items, next_offset: hasMore ? offset + limit : null };
  }

  /**
   * Users that `userId` follows. Newest-first; offset paginated.
   */
  async following(userId: string, viewerUserId: string, query: FollowsListQuery): Promise<FollowsPage> {
    await this.assertUserExists(userId);
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const rows = await sql<{
      id: string;
      display_name: string;
      photo_url: string | null;
      created_at: Date;
      is_following: boolean;
    }>`
      SELECT u.id, u.display_name, u.photo_url, f.created_at,
             EXISTS (
               SELECT 1 FROM follows
                WHERE follower_user_id = ${viewerUserId}
                  AND followed_user_id = u.id
             ) AS is_following
        FROM follows f
        JOIN users u ON u.id = f.followed_user_id
       WHERE f.follower_user_id = ${userId}
         AND u.deleted_at IS NULL
       ORDER BY f.created_at DESC, u.id ASC
       LIMIT ${limit + 1}
      OFFSET ${offset}
    `.execute(this.deps.db.db);

    const hasMore = rows.rows.length > limit;
    const items = (hasMore ? rows.rows.slice(0, limit) : rows.rows).map((r) => ({
      id: r.id,
      display_name: r.display_name,
      photo_url: r.photo_url,
      followed_at: r.created_at.toISOString(),
      is_following: r.is_following,
    }));
    return { items, next_offset: hasMore ? offset + limit : null };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const row = await this.deps.db.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("User not found");
  }
}
