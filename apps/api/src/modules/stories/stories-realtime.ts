import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { type RealtimeBus } from "../realtime/realtime.bus.js";

/**
 * Broadcast a `story_posted` SSE event to every follower of the poster so
 * their iOS StoriesRail can animate in the new unviewed indicator without
 * a network refetch.
 *
 * ## Wire format
 *
 *   { kind: "story_posted",
 *     data: { user_id: <poster>, latest_story_at: <iso> } }
 *
 * `user_id` is the bucket key on the iOS side — the rail uses it to either
 * mark an existing bucket as having a fresh unviewed story, or to insert a
 * new bucket when the viewer didn't previously have one for that author.
 * `latest_story_at` lets the client resort buckets without a fetch.
 *
 * ## Fan-out shape
 *
 * Followers are looked up with a single SELECT. We deliberately do NOT
 * filter by online/subscribed — the realtime bus is in-memory and
 * `publish()` to a user with no listeners is a no-op (microseconds,
 * EventEmitter.emit returns false). Filtering by `subscriberCount()`
 * upfront would mean the broadcast fails the moment a follower's
 * connection drops mid-fan-out; better to fire and forget.
 *
 * Bidirectional blocks are respected — if either side has blocked the
 * other, the edge is filtered out at the SQL layer so we never publish to
 * a follower the poster has since blocked, or vice versa. (A follow edge
 * can persist after a block until one side unfollows; the block check
 * here matches the same one the feed query uses, so what the rail
 * displays matches what the SSE event would push.)
 *
 * Soft-deleted followers are excluded so we don't waste publishes on
 * tombstoned accounts.
 *
 * ## Why a separate module
 *
 * `StoriesService` is owned by another agent. Keeping the broadcast as a
 * free function in its own file means the service can `import` and call
 * it from `create()` after the row commits, without us needing to touch
 * service-internal state or constructor deps. The function signature is
 * stable (`realtime`, `db`, `posterUserId`, `latestStoryAt`) so it can be
 * wired directly into the request pipeline that already has access to a
 * RealtimeBus.
 */
export async function broadcastStoryPosted(
  realtime: RealtimeBus,
  db: DbHandle,
  posterUserId: string,
  latestStoryAt: string,
): Promise<void> {
  const result = await sql<{ follower_user_id: string }>`
    SELECT f.follower_user_id
      FROM follows f
      JOIN users u ON u.id = f.follower_user_id
     WHERE f.followed_user_id = ${posterUserId}::uuid
       AND u.deleted_at IS NULL
       AND NOT EXISTS (
            SELECT 1 FROM user_blocks ub
             WHERE (ub.blocker_user_id = ${posterUserId}::uuid AND ub.blocked_user_id = f.follower_user_id)
                OR (ub.blocker_user_id = f.follower_user_id AND ub.blocked_user_id = ${posterUserId}::uuid)
       )
  `.execute(db.db);

  const data = {
    user_id: posterUserId,
    latest_story_at: latestStoryAt,
  };

  for (const row of result.rows) {
    realtime.publish(row.follower_user_id, {
      kind: "story_posted",
      data,
    });
  }
}
