import { randomUUID } from "node:crypto";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import {
  checkPasswordPolicy,
  hashPassword,
  performDummyVerify,
  verifyPassword,
} from "../../shared/auth/password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
} from "../../shared/auth/refreshToken.js";
import { type Logger } from "pino";
import {
  type LoginRequest,
  type RegisterRequest,
  type UpdateMeRequest,
} from "./users.schema.js";
import { type AuthSession, type PublicUser } from "./users.types.js";
import { usersRepository } from "./users.repository.js";
import { refreshTokensRepository } from "./refreshTokens.repository.js";
import { type TelemetryHandle } from "../../shared/telemetry/metrics.js";
import { type ReferralsService } from "../referrals/referrals.service.js";
// Product analytics (PostHog). Fire-and-forget — `track(...)` is a no-op
// when `POSTHOG_API_KEY` is unset, so this import is safe in dev/CI.
import {
  emailDomain,
  hashEmail,
  identify as analyticsIdentify,
  track as analyticsTrack,
} from "../../shared/observability/analytics.js";

export interface UsersServiceDeps {
  db: DbHandle;
  logger: Logger;
  jwtAccessSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  /** Optional metrics handle. When set, register/login attempts increment
   *  `linkfit_auth_attempts_total{method,result}`. Omitted in unit tests. */
  telemetry?: TelemetryHandle | undefined;
  /**
   * Optional referrals service. When wired, `register()` honours the new
   * Wave-10 `ref` field on `RegisterRequest` (sourced from the `?ref=` query
   * param at the route layer) and atomically links the referrer + bumps
   * their `referral_count` inside the signup transaction. Left undefined in
   * unit tests that don't care about referrals — the field is silently
   * ignored in that case. */
  referrals?: ReferralsService | undefined;
}

/**
 * Per-call HTTP context. Only `user_agent` is captured today, but the shape
 * is reserved as the slot where any future "request attribution" data
 * (IP, geolocation hint) would land without churning method signatures.
 */
export interface AuthRequestContext {
  user_agent?: string | null | undefined;
}

export class UsersService {
  /**
   * Late-bound referrals handle. Constructor can't accept it directly because
   * `ReferralsService` itself depends on `NotificationsService`, which is
   * built well after `UsersService` in the server-build sequence. The server
   * calls `setReferrals()` once both services exist; `register()` checks this
   * field at call time so the ordering is invisible to callers.
   */
  private referrals: ReferralsService | undefined;

  constructor(private readonly deps: UsersServiceDeps) {
    this.referrals = deps.referrals;
  }

  /**
   * Late-binding setter for the optional referrals dependency. Used by the
   * server build so the construction order can stay by-dependency
   * (UsersService is built before NotificationsService, which is itself a
   * transitive dep of ReferralsService). Calling this twice overwrites the
   * previous handle — fine, because each `buildServer()` is a fresh process
   * scope.
   */
  setReferrals(referrals: ReferralsService): void {
    this.referrals = referrals;
  }

  // ───────────────────────── register ─────────────────────────

  async register(req: RegisterRequest, ctx: AuthRequestContext = {}): Promise<AuthSession> {
    const policy = checkPasswordPolicy(req.password);
    if (!policy.ok) {
      throw new ValidationError("Password does not meet policy", {
        details: { issues: policy.issues },
      });
    }

    const passwordHash = await hashPassword(req.password);
    const referrals = this.referrals;

    const referralWrapper = {
      value: null as {
        referrer_user_id: string;
        referrer_display_name: string;
        new_user_display_name: string;
        new_user_id: string;
      } | null,
    };

    const result = await withTransaction(this.deps.db.db, async (tx) => {
      const existing = await usersRepository.findActiveByEmail(tx, req.email);
      if (existing) throw new ConflictError("Email already registered");

      const insertParams: Parameters<typeof usersRepository.insert>[1] = {
        email: req.email,
        password_hash: passwordHash,
        display_name: req.display_name,
      };
      if (req.birth_date !== undefined) insertParams.birth_date = req.birth_date;
      const row = await usersRepository.insert(tx, insertParams);

      // Wave-10: bind the new account to its referrer (if one was supplied
      // via `?ref=<code>`). The service silently no-ops on malformed or
      // unknown codes so a fat-fingered URL never blocks a legitimate
      // signup. See `ReferralsService.attachReferrerOnSignup`.
      if (referrals !== undefined && req.ref !== undefined) {
        const attached = await referrals.attachReferrerOnSignup(
          tx,
          row.id,
          req.ref,
        );
        if (attached !== null) {
          referralWrapper.value = { ...attached, new_user_id: row.id };
        }
      }

      const user = usersRepository.toPublic(row);
      const session = await this.issueSession(tx, user.id, randomUUID(), ctx);
      this.deps.telemetry?.business.authAttempts.inc({ method: "password", result: "ok" });

      // Product analytics — `account_created`. Fire-and-forget: the
      // facade is a no-op when `POSTHOG_API_KEY` is unset, and the
      // capture buffer is owned by the vendor SDK so we do not block
      // the registration response on PostHog's network. We hash the
      // email (SHA-256 of lowercased + trimmed) so PostHog never sees
      // the raw address; the domain is fine to ship in cleartext as a
      // low-cardinality slice column.
      const hashedEmail = hashEmail(req.email);
      analyticsIdentify(user.id, {
        signup_method: "password",
        email_hash: hashedEmail,
      });
      analyticsTrack({
        distinctId: user.id,
        event: "account_created",
        properties: {
          email_domain: emailDomain(req.email),
          // Server doesn't yet capture the client locale on the auth
          // request — the iOS client tags `signup_completed` with its
          // locale instead, and the two events share a distinct_id so
          // PostHog can join them. Leaving null here keeps the schema
          // honest until the request shape grows an `Accept-Language`
          // capture step.
          locale: null,
          email_hash: hashedEmail,
        },
      });

      return { user, ...session };
    });

    // Push the referrer's "Yeni dəvətli!" banner OUTSIDE the transaction so
    // a transient APNs hiccup never rolls back a successful signup. The
    // notifications service has its own try/catch — we just unblock it.
    if (referralWrapper.value !== null && referrals !== undefined) {
      const r = referralWrapper.value;
      void referrals.notifyReferrerOfSignup({
        referrerUserId: r.referrer_user_id,
        newUserDisplayName: r.new_user_display_name,
        newUserId: r.new_user_id,
      });
    }

    return result;
  }

  // ────────────────────────── login ──────────────────────────

  async login(req: LoginRequest, ctx: AuthRequestContext = {}): Promise<AuthSession> {
    const row = await usersRepository.findActiveByEmail(this.deps.db.db, req.email);
    if (!row) {
      // Equalize timing so attackers can't enumerate registered emails.
      await performDummyVerify();
      this.deps.telemetry?.business.authAttempts.inc({ method: "password", result: "fail" });
      throw new UnauthenticatedError("Invalid email or password");
    }
    const ok = await verifyPassword(row.password_hash, req.password);
    if (!ok) {
      this.deps.telemetry?.business.authAttempts.inc({ method: "password", result: "fail" });
      throw new UnauthenticatedError("Invalid email or password");
    }

    const user = usersRepository.toPublic(row);
    this.deps.telemetry?.business.authAttempts.inc({ method: "password", result: "ok" });
    return withTransaction(this.deps.db.db, async (tx) => {
      const session = await this.issueSession(tx, user.id, randomUUID(), ctx);
      return { user, ...session };
    });
  }

  // ───────────────────────── refresh ─────────────────────────

  async refresh(rawToken: string, ctx: AuthRequestContext = {}): Promise<AuthSession> {
    const incomingHash = hashRefreshToken(rawToken);

    // Step 1 — Look up the presented token and decide whether to revoke
    // the family. Revocations happen on the OUTER db handle (not a tx) so
    // that they commit even when the request ends in an error throw.
    const row = await refreshTokensRepository.findByHash(this.deps.db.db, incomingHash);
    if (!row) {
      throw new UnauthenticatedError("Invalid refresh token");
    }

    if (row.revoked_at !== null) {
      // Previously revoked token presented again → replay/theft.
      const revoked = await refreshTokensRepository.revokeFamily(
        this.deps.db.db,
        row.family_id,
      );
      this.deps.logger.warn(
        { family_id: row.family_id, user_id: row.user_id, revoked_count: revoked },
        "refresh token replay detected — family revoked",
      );
      throw new UnauthenticatedError("Refresh token reuse detected");
    }

    if (row.expires_at.getTime() <= Date.now()) {
      await refreshTokensRepository.revokeOne(this.deps.db.db, row.id, null);
      throw new UnauthenticatedError("Refresh token expired");
    }

    const userRow = await usersRepository.findActiveById(this.deps.db.db, row.user_id);
    if (!userRow) {
      await refreshTokensRepository.revokeFamily(this.deps.db.db, row.family_id);
      throw new UnauthenticatedError("Account no longer active");
    }
    const user = usersRepository.toPublic(userRow);

    // Step 2 — Issue the new token + revoke the old one atomically inside
    // a transaction. If the atomic revoke shows 0 rows, someone else won
    // the race — treat as reuse and revoke the family (outside the tx so
    // it persists past the imminent throw).
    return withTransaction(this.deps.db.db, async (tx) => {
      await tx
        .selectFrom("users")
        .select("id")
        .where("id", "=", user.id)
        .forShare()
        .executeTakeFirstOrThrow();

      // The new row inherits the consumed row's UA when the client didn't
      // resend one (background refresh on iOS won't always carry it).
      const effectiveUa = ctx.user_agent ?? row.user_agent ?? null;
      const session = await this.issueSession(tx, user.id, row.family_id, {
        user_agent: effectiveUa,
      });
      const replacementRow = await refreshTokensRepository.findByHash(
        tx,
        hashRefreshToken(session.refresh_token),
      );
      const updated = await refreshTokensRepository.revokeOne(
        tx,
        row.id,
        replacementRow?.id ?? null,
      );
      if (updated === 0) {
        throw new RefreshRaceError(row.family_id);
      }
      // Stamp the just-consumed row so any in-flight session listing
      // shows a fresh "last active" before we replace it with the new row.
      await refreshTokensRepository.touchLastUsed(tx, row.id);
      return { user, ...session };
    }).catch(async (err: unknown) => {
      if (err instanceof RefreshRaceError) {
        await refreshTokensRepository.revokeFamily(this.deps.db.db, err.familyId);
        throw new UnauthenticatedError("Refresh token reuse detected");
      }
      throw err;
    });
  }

  // ───────────────────────── logout ──────────────────────────

  async logout(rawToken: string): Promise<void> {
    const incomingHash = hashRefreshToken(rawToken);
    await withTransaction(this.deps.db.db, async (tx) => {
      const row = await refreshTokensRepository.findByHash(tx, incomingHash);
      if (!row) return; // idempotent: unknown token is a no-op
      await refreshTokensRepository.revokeFamily(tx, row.family_id);
    });
  }

  // ───────────────────────── /me ──────────────────────────

  async getMe(userId: string): Promise<PublicUser> {
    const row = await usersRepository.findActiveById(this.deps.db.db, userId);
    if (!row) throw new NotFoundError("User not found");
    return usersRepository.toPublic(row);
  }

  async updateMe(userId: string, patch: UpdateMeRequest): Promise<PublicUser> {
    const params: Parameters<typeof usersRepository.update>[2] = {};
    if (patch.display_name !== undefined) params.display_name = patch.display_name;
    if (patch.photo_url !== undefined) params.photo_url = patch.photo_url;
    if (patch.home_lat !== undefined) params.home_lat = patch.home_lat;
    if (patch.home_lng !== undefined) params.home_lng = patch.home_lng;
    const row = await usersRepository.update(this.deps.db.db, userId, params);
    if (!row) throw new NotFoundError("User not found");
    return usersRepository.toPublic(row);
  }

  // ───────────────────── internals ─────────────────────

  private async issueSession(
    tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
    userId: string,
    familyId: string,
    ctx: AuthRequestContext,
  ): Promise<Omit<AuthSession, "user">> {
    const access = signAccessToken(userId, {
      secret: this.deps.jwtAccessSecret,
      ttlSeconds: this.deps.accessTtlSeconds,
      familyId,
    });
    const refresh = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlDays * 24 * 60 * 60 * 1000);
    await refreshTokensRepository.insert(tx, {
      user_id: userId,
      token_hash: refresh.hash,
      family_id: familyId,
      expires_at: expiresAt,
      user_agent: ctx.user_agent ?? null,
    });
    return {
      access_token: access,
      refresh_token: refresh.token,
      access_token_expires_in_seconds: this.deps.accessTtlSeconds,
    };
  }
}

/**
 * Internal signal used to bubble a "lost-the-race" refresh out of the
 * transaction so the family revocation can run on the outer (committed)
 * connection. Never leaves this module.
 */
class RefreshRaceError extends Error {
  constructor(public readonly familyId: string) {
    super("Refresh race detected — family must be revoked");
    this.name = "RefreshRaceError";
  }
}
