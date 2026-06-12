import { sql } from "kysely";
import { type Executor } from "../../shared/db/withTransaction.js";
import { type EmailTokenKind } from "../../shared/db/types.js";

interface EmailTokenRow {
  id: string;
  user_id: string;
  kind: EmailTokenKind;
  token_hash: Buffer;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export const emailRepository = {
  /** Insert a fresh magic-link token. The (token_hash) UNIQUE constraint
   *  guarantees we never collide — sha256 over 32 random bytes makes this
   *  vanishingly unlikely anyway. */
  async insertToken(
    db: Executor,
    params: {
      user_id: string;
      kind: EmailTokenKind;
      token_hash: Buffer;
      expires_at: Date;
    },
  ): Promise<EmailTokenRow> {
    return db
      .insertInto("email_tokens")
      .values({
        user_id: params.user_id,
        kind: params.kind,
        token_hash: params.token_hash,
        expires_at: params.expires_at,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  /** Used by the cool-down check: was a token of this `kind` issued for
   *  this user within the last `seconds` seconds? */
  async findRecentActive(
    db: Executor,
    userId: string,
    kind: EmailTokenKind,
    seconds: number,
  ): Promise<EmailTokenRow | null> {
    const row = await db
      .selectFrom("email_tokens")
      .selectAll()
      .where("user_id", "=", userId)
      .where("kind", "=", kind)
      .where("used_at", "is", null)
      .where("created_at", ">", sql<Date>`now() - (${seconds} || ' seconds')::interval`)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  },

  async findByHash(
    db: Executor,
    tokenHash: Buffer,
    kind: EmailTokenKind,
  ): Promise<EmailTokenRow | null> {
    const row = await db
      .selectFrom("email_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("kind", "=", kind)
      .executeTakeFirst();
    return row ?? null;
  },

  /** Atomic single-shot consume. Returns the row only if THIS call flipped
   *  it; concurrent requests for the same token get `null`. */
  async consumeToken(
    db: Executor,
    id: string,
  ): Promise<EmailTokenRow | null> {
    const row = await db
      .updateTable("email_tokens")
      .set({ used_at: new Date() })
      .where("id", "=", id)
      .where("used_at", "is", null)
      .where("expires_at", ">", sql<Date>`now()`)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  },

  async markUserVerified(db: Executor, userId: string): Promise<void> {
    await db
      .updateTable("users")
      .set({ email_verified_at: new Date() })
      .where("id", "=", userId)
      .where("email_verified_at", "is", null)
      .execute();
  },

  /** Revoke every refresh token belonging to a user — called after a
   *  password reset so stolen sessions are kicked out. */
  async revokeAllRefreshTokensForUser(db: Executor, userId: string): Promise<void> {
    await db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date() })
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .execute();
  },

  async updatePasswordHash(
    db: Executor,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await db
      .updateTable("users")
      .set({ password_hash: passwordHash })
      .where("id", "=", userId)
      .execute();
  },

  /** Convenience used by `request-password-reset` — returns null when the
   *  email doesn't exist so the route can still answer 200 without leaking
   *  enumeration data. */
  async findActiveUserByEmail(
    db: Executor,
    email: string,
  ): Promise<{ id: string; email: string } | null> {
    const row = await db
      .selectFrom("users")
      .select(["id", "email"])
      .where("email", "=", email)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ?? null;
  },

  async findUserById(
    db: Executor,
    id: string,
  ): Promise<{ id: string; email: string; email_verified_at: Date | null } | null> {
    const row = await db
      .selectFrom("users")
      .select(["id", "email", "email_verified_at"])
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ?? null;
  },
};

export type EmailRepository = typeof emailRepository;
