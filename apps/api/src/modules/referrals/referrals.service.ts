import { randomInt } from "node:crypto";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { type Executor } from "../../shared/db/withTransaction.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { type NotificationsService } from "../social/notifications.service.js";
import {
  type MyReferralResponse,
  type MyReferralsResponse,
  type ReferredUser,
  type ShareLocale,
  type ShareReferralResponse,
} from "./referrals.schema.js";

export interface ReferralsServiceDeps {
  db: DbHandle;
  /**
   * Public origin used to build referral share URLs (e.g.
   * `https://linkfit.app`). Optional — when omitted we fall back to the
   * production origin. Passed explicitly so tests can pin the value without
   * leaking env state across suites.
   */
  shareBaseUrl?: string;
  /**
   * Optional notifications fan-out used by `attachReferrerOnSignup` to push
   * the "Yeni dəvətli!" banner to the referrer when one of their codes is
   * redeemed at sign-up. Wired in production; left undefined in unit tests
   * that only assert the DB side-effects.
   */
  notifications?: NotificationsService | undefined;
  /** Pino logger used for best-effort warnings (push fan-out failures). */
  logger?: Logger | undefined;
}

/**
 * Canonical Wave-10 share URL host. The viral copy ("https://linkfit.az/r/X")
 * uses the .az ccTLD by spec — the deep link redirects to the App Store /
 * universal-links handler. We keep the constant here (rather than reading
 * an env var) so the migration of organic users to the new short link is
 * driven by code review, not deploy config.
 */
const VIRAL_SHARE_HOST = "https://linkfit.az";

/**
 * Resolve the canonical share-link origin. Trailing slashes are stripped so
 * we can always append `/r/CODE` without producing `//r/CODE`.
 */
function resolveShareBaseUrl(deps: ReferralsServiceDeps): string {
  const raw = deps.shareBaseUrl ?? "https://linkfit.app";
  return raw.replace(/\/+$/, "");
}

/**
 * Alphabet used to mint referral codes. Excludes 0/O and 1/I so codes are
 * unambiguous when read aloud or transcribed from a screenshot. 32 chars =
 * 32^6 ≈ 1.07 billion possible codes — collision risk is negligible at
 * Linkfit's scale and we retry on the UNIQUE constraint anyway.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

/**
 * How long after sign-up a new user may still redeem a referral code.
 * 7 days matches the assignment spec; tight enough that referrals stay a
 * "welcome bonus" rather than a permanent loophole.
 */
const REDEEM_WINDOW_DAYS = 7;
const REDEEM_WINDOW_MS = REDEEM_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Maximum number of code-generation retries on UNIQUE collision. */
const MAX_CODE_ATTEMPTS = 16;

export class ReferralsService {
  constructor(private readonly deps: ReferralsServiceDeps) {}

  /**
   * Return the user's referral code, minting one lazily if the row doesn't
   * have one yet. Idempotent — once a code exists we always return the
   * same value. Concurrent callers race only on the FIRST call; subsequent
   * calls short-circuit at the SELECT.
   */
  async codeFor(userId: string): Promise<string> {
    const existing = await this.deps.db.db
      .selectFrom("users")
      .select(["referral_code"])
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();

    if (!existing) throw new NotFoundError("User not found");
    if (existing.referral_code) return existing.referral_code;

    // Try a handful of candidate codes until one wins the UNIQUE race.
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const candidate = generateCode();
      try {
        const updated = await this.deps.db.db
          .updateTable("users")
          .set({ referral_code: candidate })
          .where("id", "=", userId)
          .where("referral_code", "is", null)
          .returning("referral_code")
          .executeTakeFirst();
        // Another caller filled the column between our SELECT and UPDATE.
        // Re-read; that value is the canonical one.
        if (!updated) {
          const row = await this.deps.db.db
            .selectFrom("users")
            .select(["referral_code"])
            .where("id", "=", userId)
            .executeTakeFirst();
          if (row?.referral_code) return row.referral_code;
          continue;
        }
        if (updated.referral_code) return updated.referral_code;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23505") continue; // UNIQUE collision — try again
        throw err;
      }
    }
    throw new Error("Could not mint a unique referral code");
  }

  /**
   * Redeem a code on behalf of `refereeUserId`. Validates everything in a
   * single transaction:
   *   - referee row exists and was created within the last 7 days
   *   - code resolves to a valid (non-deleted) user
   *   - referrer ≠ referee
   *   - referee hasn't redeemed before (PK on referrals)
   *
   * On success we write an `audit_log` row with action `referrals.redeem` so
   * downstream agents (achievements / future fraud audits) can react.
   */
  async redeem(
    refereeUserId: string,
    rawCode: string,
  ): Promise<{
    referrer_user_id: string;
    referrer_display_name: string;
    code_used: string;
  }> {
    const code = rawCode.trim().toUpperCase();

    return withTransaction(this.deps.db.db, async (tx) => {
      const referee = await tx
        .selectFrom("users")
        .select(["id", "created_at", "referral_code"])
        .where("id", "=", refereeUserId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!referee) throw new NotFoundError("User not found");

      const ageMs = Date.now() - referee.created_at.getTime();
      if (ageMs > REDEEM_WINDOW_MS) {
        throw new PreconditionFailedError(
          `Referral codes can only be redeemed within ${String(REDEEM_WINDOW_DAYS)} days of sign-up`,
        );
      }

      const referrer = await tx
        .selectFrom("users")
        .select(["id", "display_name"])
        .where("referral_code", "=", code)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!referrer) throw new NotFoundError("Referral code not found");

      if (referrer.id === refereeUserId) {
        throw new ValidationError("Cannot redeem your own code");
      }

      // Single-row PK on referee_user_id catches the "already redeemed"
      // case at insert time. We surface it as 409 below.
      try {
        await tx
          .insertInto("referrals")
          .values({
            referee_user_id: refereeUserId,
            referrer_user_id: referrer.id,
            code_used: code,
          })
          .execute();

        await tx
          .updateTable("users")
          .set((eb) => ({ referral_count: eb("referral_count", "+", 1) }))
          .where("id", "=", referrer.id)
          .execute();
      } catch (err) {
        const pgCode = (err as { code?: string } | null)?.code;
        if (pgCode === "23505") {
          throw new ConflictError("You have already redeemed a referral code");
        }
        throw err;
      }

      // Audit-log fan-out — the achievements agent (or anyone else) can poll
      // this stream to grant a "First friend" badge. Best-effort: a failure
      // here SHOULD roll back the referral, since the achievement hook is
      // part of the contract.
      await tx
        .insertInto("audit_log")
        .values({
          actor_user_id: refereeUserId,
          action: "referrals.redeem",
          entity: "user",
          entity_id: referrer.id,
          metadata: {
            referee_user_id: refereeUserId,
            referrer_user_id: referrer.id,
            code_used: code,
          },
        })
        .execute();

      return {
        referrer_user_id: referrer.id,
        referrer_display_name: referrer.display_name,
        code_used: code,
      };
    });
  }

  /**
   * Build the dashboard payload for `GET /me/referrals`. Includes the
   * caller's own code (minting it on first read) plus the list of users
   * they've referred so far.
   */
  async dashboardFor(userId: string): Promise<MyReferralsResponse> {
    const code = await this.codeFor(userId);

    const rows = await this.deps.db.db
      .selectFrom("referrals")
      .innerJoin("users", "users.id", "referrals.referee_user_id")
      .select([
        "users.id as id",
        "users.display_name as display_name",
        "users.photo_url as photo_url",
        "referrals.created_at as referred_at",
      ])
      .where("referrals.referrer_user_id", "=", userId)
      .where("users.deleted_at", "is", null)
      .orderBy("referrals.created_at", "desc")
      .limit(200)
      .execute();

    const referred_users: ReferredUser[] = rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      photo_url: r.photo_url,
      referred_at: r.referred_at.toISOString(),
    }));

    return {
      code,
      referred_count: referred_users.length,
      referred_users,
    };
  }

  /**
   * Build a copy-paste-ready share payload for the caller's referral code.
   * Used by iOS to populate the system share sheet / SMS / iMessage with a
   * pre-baked invite string. We return all three localised variants so the
   * client can switch language without another round-trip, but `share_text`
   * is server-picked based on the requested locale (defaulting to English).
   *
   * Lazy mint behaviour piggy-backs on `codeFor` — first call ever from a
   * brand-new account will write the user's permanent referral_code.
   */
  async shareFor(
    userId: string,
    locale: ShareLocale = "en",
  ): Promise<ShareReferralResponse> {
    const code = await this.codeFor(userId);
    const base = resolveShareBaseUrl(this.deps);
    const shareUrl = `${base}/r/${code}`;

    const texts = buildShareTexts(code, shareUrl);
    return {
      code,
      share_url: shareUrl,
      share_text: texts[locale],
      share_text_en: texts.en,
      share_text_az: texts.az,
      share_text_ru: texts.ru,
    };
  }

  /**
   * Wave-10 compact dashboard fetch: just the caller's code, the running
   * tally on `users.referral_count`, and the canonical viral share URL.
   * Reads in a single row — no JOIN against the `referrals` ledger — so the
   * "Dostunu dəvət et" header card on the Settings sub-screen stays cheap.
   *
   * The richer `dashboardFor()` still drives the dedicated Referrals tab
   * (it adds the friend list); this method is intentionally minimal.
   */
  async summaryFor(userId: string): Promise<MyReferralResponse> {
    const code = await this.codeFor(userId);
    const row = await this.deps.db.db
      .selectFrom("users")
      .select(["referral_count"])
      .where("id", "=", userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("User not found");
    return {
      code,
      count: row.referral_count,
      share_url: `${VIRAL_SHARE_HOST}/r/${code}`,
    };
  }

  /**
   * Bind a brand-new account to its referrer inside the signup transaction.
   *
   * Called by `UsersService.register` immediately after inserting the new
   * user row, when the request carried a `?ref=<code>` query param. Runs
   * inside the caller's transaction (so a malformed code rolls back the
   * whole signup) and returns the referrer's row when one was attached.
   *
   * The wiring is intentionally narrower than `redeem()`:
   *   - There is no 7-day window — the user IS signing up right now.
   *   - There is no `referrals` ledger insert from this path; the brief
   *     specifies the denormalized columns are the system of record for
   *     signup-time attribution. The `redeem()` flow (post-signup CTA)
   *     still owns the ledger for users who fat-fingered the code.
   *   - Self-referral is impossible here (the new user doesn't yet own
   *     any code, and we're inside the same tx that just inserted them).
   *
   * Returns null if:
   *   - the code is empty / malformed (silently dropped — we never want
   *     a bad query string to 400 the signup itself);
   *   - the code resolves to a deleted / nonexistent user;
   *   - the referrer turned out to be the new user themselves (defensive).
   *
   * Side-effects when a referrer is attached:
   *   - `users.referred_by_user_id` set on the new account
   *   - `users.referral_count` bumped atomically on the referrer
   *   - a `referrals` ledger row written so the dashboard friend list
   *     shows the new user
   *   - `audit_log` row with action `referrals.signup_attach`
   *   - best-effort push to the referrer ("Yeni dəvətli!") — fired AFTER
   *     the transaction commits so a push failure never rolls back signup
   */
  async attachReferrerOnSignup(
    tx: Executor,
    newUserId: string,
    rawCode: string | null | undefined,
  ): Promise<{
    referrer_user_id: string;
    referrer_display_name: string;
    new_user_display_name: string;
  } | null> {
    if (rawCode === null || rawCode === undefined) return null;
    const code = rawCode.trim().toUpperCase();
    // Same regex as the redeem schema — silently drop anything else.
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return null;

    const referrer = await tx
      .selectFrom("users")
      .select(["id", "display_name"])
      .where("referral_code", "=", code)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!referrer) return null;
    if (referrer.id === newUserId) return null; // belt-and-suspenders

    const newUser = await tx
      .selectFrom("users")
      .select(["display_name"])
      .where("id", "=", newUserId)
      .executeTakeFirst();
    if (!newUser) return null; // shouldn't happen — we're inside the signup tx

    // Stamp the new account with the referrer link.
    await tx
      .updateTable("users")
      .set({ referred_by_user_id: referrer.id })
      .where("id", "=", newUserId)
      .execute();

    // Bump the referrer's lifetime count atomically. We use a raw expression
    // (referral_count + 1) so concurrent signups under the same code can't
    // clobber each other — Postgres serializes the UPDATEs at row level.
    await tx
      .updateTable("users")
      .set((eb) => ({ referral_count: eb("referral_count", "+", 1) }))
      .where("id", "=", referrer.id)
      .execute();

    // Mirror the binding into the ledger so the existing dashboard friend
    // list keeps working. ON CONFLICT DO NOTHING because in the (impossible
    // but defensive) case a redeem already ran for this referee we don't
    // want to fail the signup — the denormalized count is still correct.
    await tx
      .insertInto("referrals")
      .values({
        referee_user_id: newUserId,
        referrer_user_id: referrer.id,
        code_used: code,
      })
      .onConflict((oc) => oc.column("referee_user_id").doNothing())
      .execute();

    await tx
      .insertInto("audit_log")
      .values({
        actor_user_id: newUserId,
        action: "referrals.signup_attach",
        entity: "user",
        entity_id: referrer.id,
        metadata: {
          referee_user_id: newUserId,
          referrer_user_id: referrer.id,
          code_used: code,
        },
      })
      .execute();

    return {
      referrer_user_id: referrer.id,
      referrer_display_name: referrer.display_name,
      new_user_display_name: newUser.display_name,
    };
  }

  /**
   * Fire-and-forget push notification informing the referrer that someone
   * just signed up with their code. Called by the signup route AFTER the
   * transaction commits so a push hiccup never rolls back a successful
   * registration. Returns nothing — failures are swallowed and logged.
   *
   * Copy: "Yeni dəvətli! %@ sənin kodun ilə qoşuldu." (AZ-first per spec).
   * Localisation across EN/RU is deferred to the `push.templates` catalog;
   * for now we emit the AZ string verbatim since the assignment brief
   * pins it and the recipient population is Azerbaijan-first.
   */
  async notifyReferrerOfSignup(params: {
    referrerUserId: string;
    newUserDisplayName: string;
    newUserId: string;
  }): Promise<void> {
    if (this.deps.notifications === undefined) return;
    try {
      await this.deps.notifications.emit({
        userId: params.referrerUserId,
        type: "system",
        title: "Yeni dəvətli!",
        body: `${params.newUserDisplayName} sənin kodun ilə qoşuldu.`,
        payload: {
          event: "referral.signup",
          new_user_id: params.newUserId,
        },
      });
    } catch (err) {
      this.deps.logger?.warn(
        { err, referrerUserId: params.referrerUserId },
        "referrals.notify_referrer_failed",
      );
    }
  }
}

/**
 * Compose the localised invite strings. Kept as a free function so the copy
 * is easy to audit (and so unit tests can compare against a fixture). The
 * tone matches the assignment's product brief: friendly, Azerbaijan-padel
 * focused, code- and link-bearing.
 */
function buildShareTexts(
  code: string,
  shareUrl: string,
): Record<ShareLocale, string> {
  return {
    en: `Hey, join me on Linkfit — Azerbaijan's padel community! Use my code ${code} to get started: ${shareUrl}`,
    az: `Salam! Linkfit-ə qoşul — Azərbaycanın padel icmasına! Başlamaq üçün mənim kodumdan istifadə et: ${code} ${shareUrl}`,
    ru: `Привет! Заходи в Linkfit — падел-сообщество Азербайджана. Используй мой код ${code}, чтобы начать: ${shareUrl}`,
  };
}

/**
 * Mint a single 6-char candidate from the ambiguity-free alphabet using a
 * cryptographically-strong RNG. Not exported — callers should go through
 * `ReferralsService.codeFor` which handles uniqueness.
 */
function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i += 1) {
    // `randomInt` is bounded by CODE_ALPHABET.length so the indexed access
    // is always defined; the `?? ""` is a noUncheckedIndexedAccess-safety
    // net that should never fire in practice.
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)] ?? "";
  }
  return out;
}
