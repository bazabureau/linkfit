/**
 * Sessions service — backs the "Logged-in devices" surface on iOS.
 *
 * A "session" here is one refresh-token family. Each `refresh_tokens` row
 * is a generation in that family, but at any moment a family has at most
 * one active (non-revoked, non-expired) row — that's the row this module
 * lists and lets the user revoke.
 *
 * `is_current` is determined by comparing the row's `family_id` to the
 * session id carried on the access token (`sid` claim, plumbed through
 * the auth guard as `req.authSessionId`). Tokens minted before the
 * sessions-metadata migration carry no claim — for those, every row is
 * `is_current: false` and the iOS UI degrades gracefully.
 */
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
} from "../../shared/errors/AppError.js";
import { refreshTokensRepository } from "./refreshTokens.repository.js";

export interface SessionsServiceDeps {
  db: DbHandle;
}

export interface SessionListItem {
  /** `refresh_tokens.id` for the active row — the value clients pass to
   *  DELETE /api/v1/me/sessions/:id. */
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  /** True only when this row's family matches the access token's `sid`
   *  claim. Mutually exclusive across the returned list. */
  is_current: boolean;
}

export interface ListSessionsResult {
  items: SessionListItem[];
}

export class SessionsService {
  constructor(private readonly deps: SessionsServiceDeps) {}

  /**
   * List every active session for `userId`. The `currentSessionId`
   * parameter is the value of `req.authSessionId` (the access token's
   * `sid` claim). When `undefined` (legacy token), every item comes back
   * with `is_current: false` and the UI falls back to "no row highlighted".
   */
  async listForUser(
    userId: string,
    currentSessionId: string | undefined,
  ): Promise<ListSessionsResult> {
    const rows = await refreshTokensRepository.listActiveByUser(this.deps.db.db, userId);
    const items: SessionListItem[] = rows.map((row) => ({
      id: row.id,
      user_agent: row.user_agent,
      created_at: row.created_at.toISOString(),
      last_used_at: row.last_used_at === null ? null : row.last_used_at.toISOString(),
      is_current: currentSessionId !== undefined && row.family_id === currentSessionId,
    }));
    return { items };
  }

  /**
   * Revoke a single session by its `refresh_tokens.id`. Mirrors the family-
   * level revocation used at logout: revoking the whole family blocks both
   * the current row AND any in-flight replacement that a racing refresh
   * might already have minted.
   *
   * Status codes:
   *   * 404 — id doesn't exist
   *   * 403 — id belongs to a different user
   *   * 422 — the row is the caller's *current* session (use logout instead)
   *   * 204 — revoked (or already revoked: idempotent)
   */
  async revokeById(
    userId: string,
    currentSessionId: string | undefined,
    sessionId: string,
  ): Promise<void> {
    const row = await refreshTokensRepository.findById(this.deps.db.db, sessionId);
    if (!row) {
      throw new NotFoundError("Session not found");
    }
    if (row.user_id !== userId) {
      // Don't 404 here — the id is a real row, just not theirs. 403 is the
      // accurate status, and the test suite distinguishes these explicitly.
      throw new ForbiddenError("Session does not belong to current user");
    }
    if (currentSessionId !== undefined && row.family_id === currentSessionId) {
      throw new PreconditionFailedError(
        "Cannot revoke the current session — use POST /api/v1/auth/logout instead",
      );
    }
    await withTransaction(this.deps.db.db, async (tx) => {
      await refreshTokensRepository.revokeFamily(tx, row.family_id);
    });
  }

  /**
   * "Sign out everywhere else" — revoke every active family for `userId`
   * except the one carrying this request. When no `currentSessionId` is
   * available (legacy access token), we refuse rather than guess: that
   * would risk locking the caller out of their own bearer.
   */
  async revokeAllExceptCurrent(
    userId: string,
    currentSessionId: string | undefined,
  ): Promise<void> {
    if (currentSessionId === undefined) {
      throw new PreconditionFailedError(
        "Cannot identify current session — refresh your access token and retry",
      );
    }
    await withTransaction(this.deps.db.db, async (tx) => {
      await refreshTokensRepository.revokeAllExceptFamily(tx, userId, currentSessionId);
    });
  }
}

export type SessionsServiceLike = Pick<
  SessionsService,
  "listForUser" | "revokeById" | "revokeAllExceptCurrent"
>;
