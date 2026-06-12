import { type Executor } from "../../shared/db/withTransaction.js";

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: Buffer;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  created_at: Date;
  user_agent: string | null;
  last_used_at: Date | null;
}

export interface InsertRefreshTokenParams {
  user_id: string;
  token_hash: Buffer;
  family_id: string;
  expires_at: Date;
  /**
   * Free-form UA from the inbound HTTP request, captured at mint time.
   * Optional — pass `undefined`/`null` for callers without an HTTP context
   * (background refresh in tests, internal mints). The service trims and
   * truncates before passing through; the column itself is plain text.
   */
  user_agent?: string | null | undefined;
}

/** Active session view, joined with what the listing endpoint needs. */
export interface ActiveSessionRow {
  id: string;
  user_id: string;
  family_id: string;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date;
}

/** Maximum length we accept for a captured UA. Real-world browsers stay
 *  under 300 chars; we truncate aggressively so a malicious client can't
 *  blow up the row size. */
const USER_AGENT_MAX_LEN = 512;

export function sanitizeUserAgent(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > USER_AGENT_MAX_LEN
    ? trimmed.slice(0, USER_AGENT_MAX_LEN)
    : trimmed;
}

export const refreshTokensRepository = {
  async insert(db: Executor, params: InsertRefreshTokenParams): Promise<RefreshTokenRow> {
    // Stamp `last_used_at` at mint time so the sessions list shows a
    // meaningful "last active" value even for sessions that never refreshed.
    const row = await db
      .insertInto("refresh_tokens")
      .values({
        user_id: params.user_id,
        token_hash: params.token_hash,
        family_id: params.family_id,
        expires_at: params.expires_at,
        user_agent: sanitizeUserAgent(params.user_agent),
        last_used_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row;
  },

  async findByHash(db: Executor, hash: Buffer): Promise<RefreshTokenRow | null> {
    const row = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("token_hash", "=", hash)
      .executeTakeFirst();
    return row ?? null;
  },

  /**
   * Atomically mark the supplied token as revoked AND link it to its
   * replacement. Returns 1 row affected when this is the first revocation —
   * a 0 result tells the caller "someone already revoked this; treat as
   * replay" (we use this for reuse detection on race).
   */
  async revokeOne(
    db: Executor,
    tokenId: string,
    replacedBy: string | null,
  ): Promise<number> {
    const result = await db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date(), replaced_by: replacedBy })
      .where("id", "=", tokenId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  },

  /** Revoke every still-active token in a family. Used on suspected theft. */
  async revokeFamily(db: Executor, familyId: string): Promise<number> {
    const result = await db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date() })
      .where("family_id", "=", familyId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  },

  async countActiveInFamily(db: Executor, familyId: string): Promise<number> {
    const row = await db
      .selectFrom("refresh_tokens")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("family_id", "=", familyId)
      .where("revoked_at", "is", null)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  },

  /**
   * List every active (non-revoked, non-expired) refresh-token row owned by
   * the given user. Ordered most-recent-first so the iOS list shows the
   * newest sign-in at the top.
   */
  async listActiveByUser(db: Executor, userId: string): Promise<ActiveSessionRow[]> {
    const rows = await db
      .selectFrom("refresh_tokens")
      .select([
        "id",
        "user_id",
        "family_id",
        "user_agent",
        "created_at",
        "last_used_at",
        "expires_at",
      ])
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date())
      .orderBy("created_at", "desc")
      .execute();
    return rows;
  },

  /**
   * Fetch one row by id without any user filter — caller is responsible for
   * checking ownership before acting on it. Returning null lets the service
   * map to a NOT_FOUND vs FORBIDDEN response.
   */
  async findById(db: Executor, id: string): Promise<RefreshTokenRow | null> {
    const row = await db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ?? null;
  },

  /**
   * Revoke every active row for `userId` whose `family_id` is NOT the
   * current session's family. Returns the count of newly-revoked rows so
   * the service can short-circuit when there's nothing to do.
   */
  async revokeAllExceptFamily(
    db: Executor,
    userId: string,
    keepFamilyId: string,
  ): Promise<number> {
    const result = await db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date() })
      .where("user_id", "=", userId)
      .where("family_id", "!=", keepFamilyId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  },

  /**
   * Stamp `last_used_at = NOW()` on the supplied row. Called from the
   * refresh path so the sessions list reflects each successful rotation.
   * Returns nothing — best-effort; the caller has already committed the
   * critical revoke + insert pair.
   */
  async touchLastUsed(db: Executor, id: string): Promise<void> {
    await db
      .updateTable("refresh_tokens")
      .set({ last_used_at: new Date() })
      .where("id", "=", id)
      .execute();
  },
};

export type RefreshTokensRepository = typeof refreshTokensRepository;
