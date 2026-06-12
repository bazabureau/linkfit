import { sql } from "kysely";
import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError, ValidationError } from "../../shared/errors/AppError.js";

export interface BlocksServiceDeps {
  db: DbHandle;
}

export interface BlockedUser {
  user_id: string;
  display_name: string;
  photo_url: string | null;
  blocked_at: string;
}

/**
 * Block management.
 *
 * The service intentionally mirrors {@link FollowsService} on shape (idempotent
 * create + idempotent delete + list). The two interact: blocking somebody also
 * tears down any pre-existing follow edge in either direction — leaving stale
 * edges is what leaks a blocked user back into the feed.
 */
export class BlocksService {
  constructor(private readonly deps: BlocksServiceDeps) {}

  /**
   * Block `targetUserId` on behalf of `blockerUserId`. Idempotent.
   * Side-effect: removes any follow edges (both directions) between the two
   * users so they immediately stop appearing in each other's feeds.
   */
  async block(blockerUserId: string, targetUserId: string): Promise<void> {
    if (blockerUserId === targetUserId) {
      throw new ValidationError("Cannot block yourself");
    }

    const target = await this.deps.db.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", targetUserId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!target) throw new NotFoundError("User not found");

    await this.deps.db.db.transaction().execute(async (tx) => {
      // Idempotent block row.
      await sql`
        INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
        VALUES (${blockerUserId}, ${targetUserId})
        ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
      `.execute(tx);

      // Tear down mutual follow edges so the blocked user disappears from
      // the feed on the next refresh.
      await tx
        .deleteFrom("follows")
        .where((eb) =>
          eb.or([
            eb.and([
              eb("follower_user_id", "=", blockerUserId),
              eb("followed_user_id", "=", targetUserId),
            ]),
            eb.and([
              eb("follower_user_id", "=", targetUserId),
              eb("followed_user_id", "=", blockerUserId),
            ]),
          ]),
        )
        .execute();
    });
  }

  /** Unblock. Idempotent — returns silently if no row exists. */
  async unblock(blockerUserId: string, targetUserId: string): Promise<void> {
    if (blockerUserId === targetUserId) {
      throw new ValidationError("Cannot unblock yourself");
    }
    await sql`
      DELETE FROM user_blocks
       WHERE blocker_user_id = ${blockerUserId}
         AND blocked_user_id = ${targetUserId}
    `.execute(this.deps.db.db);
  }

  /**
   * Users that `viewerUserId` has blocked. Newest-first; no pagination — a
   * single user rarely blocks 100+ people. Soft-deleted users are filtered
   * out so the iOS unblock list never renders an orphaned row.
   */
  async listFor(viewerUserId: string): Promise<BlockedUser[]> {
    const rows = await sql<{
      id: string;
      display_name: string;
      photo_url: string | null;
      created_at: Date;
    }>`
      SELECT u.id, u.display_name, u.photo_url, b.created_at
        FROM user_blocks b
        JOIN users u ON u.id = b.blocked_user_id
       WHERE b.blocker_user_id = ${viewerUserId}
         AND u.deleted_at IS NULL
       ORDER BY b.created_at DESC, u.id ASC
    `.execute(this.deps.db.db);

    return rows.rows.map((r) => ({
      user_id: r.id,
      display_name: r.display_name,
      photo_url: r.photo_url,
      blocked_at: r.created_at.toISOString(),
    }));
  }

  /**
   * Whether `viewerUserId` and `otherUserId` are in a blocked relationship in
   * either direction. Used by listings to drop hidden rows.
   */
  async isBlockedEitherWay(viewerUserId: string, otherUserId: string): Promise<boolean> {
    const row = await sql<{ exists: boolean }>`
      SELECT EXISTS(
        SELECT 1 FROM user_blocks
         WHERE (blocker_user_id = ${viewerUserId} AND blocked_user_id = ${otherUserId})
            OR (blocker_user_id = ${otherUserId} AND blocked_user_id = ${viewerUserId})
      ) AS exists
    `.execute(this.deps.db.db);
    return Boolean(row.rows[0]?.exists);
  }
}
