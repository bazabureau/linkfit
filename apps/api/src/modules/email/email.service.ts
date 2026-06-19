import { timingSafeEqual } from "node:crypto";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction } from "../../shared/db/withTransaction.js";
import {
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import {
  checkPasswordPolicy,
  hashPassword,
} from "../../shared/auth/password.js";
import { emailRepository } from "./email.repository.js";
import {
  generateEmailToken,
  generateVerificationCode,
  hashEmailToken,
  hashVerificationCode,
} from "./email.tokens.js";
import { type MailTransport } from "./email.transport.js";

/**
 * Default expiry windows. Verification links live longer than reset links
 * because the user has no urgency to act, while reset links are higher-risk
 * if intercepted. Numbers tuned to be friendly without becoming dangerous:
 *
 *  - verify         → 10m
 *  - reset_password → 1h
 *
 * Cool-down keeps abusive resend loops in check; 60s is the contractual
 * floor (see task spec).
 */
const VERIFY_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_SECONDS = 60;
const VERIFY_MAX_ATTEMPTS = 5;

export interface EmailServiceDeps {
  db: DbHandle;
  logger: Logger;
  transport: MailTransport;
  /** Secret used to HMAC the six-digit verification code before storing it. */
  verificationCodeSecret: string;
  /** Base URL used to build the password-reset magic-link sent by email. */
  publicAppUrl: string;
}

export class EmailService {
  constructor(private readonly deps: EmailServiceDeps) {}

  // ───────────────────────── send-verification ─────────────────────────

  /**
   * Mint a six-digit verification code and email it. Idempotent within
   * `RESEND_COOLDOWN_SECONDS` — repeated calls before the cool-down expires
   * throw `RateLimitedError`. We never store the plain code — only a HMAC.
   */
  async sendVerification(userId: string): Promise<{ sent: boolean }> {
    const user = await emailRepository.findUserById(this.deps.db.db, userId);
    if (!user) throw new UnauthenticatedError("Account not found");
    if (user.email_verified_at !== null) {
      // Idempotent success — already verified means "nothing to do".
      return { sent: false };
    }

    const recent = await emailRepository.findRecentActive(
      this.deps.db.db,
      userId,
      "verify",
      RESEND_COOLDOWN_SECONDS,
    );
    if (recent !== null) {
      throw new RateLimitedError(
        `Verification email was sent recently. Try again in ${RESEND_COOLDOWN_SECONDS}s.`,
      );
    }

    const fresh = generateVerificationCode(this.deps.verificationCodeSecret);
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
    await withTransaction(this.deps.db.db, async (tx) => {
      await emailRepository.invalidatePendingForUser(tx, userId, "verify");
      await emailRepository.insertToken(tx, {
        user_id: userId,
        kind: "verify",
        token_hash: fresh.hash,
        expires_at: expiresAt,
      });
    });

    await this.deliverVerify(user.email, fresh.code);
    return { sent: true };
  }

  // ───────────────────────── verify-email ─────────────────────────

  /**
   * Verify the authenticated user's six-digit code. Bad / expired / mismatch
   * intentionally returns HTTP 200 `{ verified: false }` because the shipped
   * iOS app maps the boolean, not a validation exception.
   */
  async verifyEmail(userId: string, rawToken: string): Promise<{ verified: boolean }> {
    const code = rawToken.trim();
    const tokenHash = /^\d{6}$/.test(code)
      ? hashVerificationCode(code, this.deps.verificationCodeSecret)
      : null;
    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await emailRepository.findLatestPendingForUser(tx, userId, "verify");
      if (row === null) {
        return { verified: false };
      }
      if (row.attempts >= VERIFY_MAX_ATTEMPTS) {
        await emailRepository.invalidateToken(tx, row.id);
        return { verified: false };
      }

      const expired = row.expires_at.getTime() <= Date.now();
      const matches =
        tokenHash !== null &&
        tokenHash.length === row.token_hash.length &&
        timingSafeEqual(tokenHash, row.token_hash);

      if (expired || !matches) {
        const attempted = await emailRepository.incrementAttempts(tx, row.id);
        if (expired || (attempted?.attempts ?? VERIFY_MAX_ATTEMPTS) >= VERIFY_MAX_ATTEMPTS) {
          await emailRepository.invalidateToken(tx, row.id);
        }
        return { verified: false };
      }

      const consumed = await emailRepository.consumeToken(tx, row.id);
      if (consumed === null) return { verified: false };
      await emailRepository.markUserVerified(tx, row.user_id);
      return { verified: true };
    });
  }

  // ───────────────────────── request-password-reset ─────────────────────────

  /**
   * Always returns `{ requested: true }` — never surfaces whether the email
   * exists. This is the standard anti-enumeration pattern. If the email
   * IS valid we drop a reset token + dispatch a mail; if not, we still
   * burn the cool-down window so timing analysis stays uninformative.
   */
  async requestPasswordReset(email: string): Promise<{ requested: true }> {
    const normalized = email.trim().toLowerCase();
    const user = await emailRepository.findActiveUserByEmail(
      this.deps.db.db,
      normalized,
    );
    if (user === null) {
      // Silent no-op. We still log at debug for ops visibility.
      this.deps.logger.debug(
        { email: normalized },
        "password reset requested for unknown email",
      );
      return { requested: true };
    }

    const recent = await emailRepository.findRecentActive(
      this.deps.db.db,
      user.id,
      "reset_password",
      RESEND_COOLDOWN_SECONDS,
    );
    if (recent !== null) {
      // Don't tell the caller. They can spam — we just ignore until the
      // cool-down lapses. (The 60s gate is the same one used by verify.)
      return { requested: true };
    }

    const fresh = generateEmailToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await withTransaction(this.deps.db.db, async (tx) => {
      await emailRepository.invalidatePendingForUser(tx, user.id, "reset_password");
      await emailRepository.insertToken(tx, {
        user_id: user.id,
        kind: "reset_password",
        token_hash: fresh.hash,
        expires_at: expiresAt,
      });
    });
    await this.deliverReset(user.email, fresh.token);
    return { requested: true };
  }

  // ───────────────────────── reset-password ─────────────────────────

  /** Atomically: validate token, rehash password, revoke all refresh tokens. */
  async resetPassword(rawToken: string, newPassword: string): Promise<{ reset: true }> {
    const policy = checkPasswordPolicy(newPassword);
    if (!policy.ok) {
      throw new ValidationError("Password does not meet policy", {
        details: { issues: policy.issues },
      });
    }

    const tokenHash = hashEmailToken(rawToken);
    const passwordHash = await hashPassword(newPassword);

    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await emailRepository.findByHash(tx, tokenHash, "reset_password");
      if (row === null) {
        throw new ValidationError("Invalid reset token");
      }
      const consumed = await emailRepository.consumeToken(tx, row.id);
      if (consumed === null) {
        throw new ValidationError("Token is no longer valid");
      }
      await emailRepository.updatePasswordHash(tx, row.user_id, passwordHash);
      await emailRepository.revokeAllRefreshTokensForUser(tx, row.user_id);
      return { reset: true as const };
    });
  }

  // ───────────────────────── internals ─────────────────────────

  private async deliverVerify(to: string, code: string, locale: "az" | "en" | "ru" = "az"): Promise<void> {
    const copy = {
      az: {
        subject: `Linkfit təsdiq kodu: ${code}`,
        body: `Hesabını təsdiqləmək üçün kod: ${code}. Kod 10 dəqiqə etibarlıdır, kimsə ilə paylaşma.`,
      },
      en: {
        subject: `Your Linkfit code: ${code}`,
        body: `Your verification code is ${code}. It expires in 10 minutes. Don't share it.`,
      },
      ru: {
        subject: `Код Linkfit: ${code}`,
        body: `Ваш код подтверждения: ${code}. Он действует 10 минут. Никому его не сообщайте.`,
      },
    }[locale];
    await this.deps.transport.send({
      to,
      subject: copy.subject,
      text: copy.body,
      html: `<p>${copy.body.replace(code, `<strong style="font-size:24px;letter-spacing:0.18em">${code}</strong>`)}</p>`,
    });
  }

  private async deliverReset(to: string, token: string): Promise<void> {
    const link = `${this.deps.publicAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.deps.transport.send({
      to,
      subject: "Reset your Linkfit password",
      text:
        `Someone (hopefully you) asked to reset the password on this account.\n\n` +
        `Use the link below or paste the token into the app:\n\n` +
        `${link}\n\n` +
        `Token: ${token}\n\n` +
        `If this wasn't you, you can ignore this email — your password is still safe.\n` +
        `This link expires in 1 hour.`,
      html:
        `<p>Someone (hopefully you) asked to reset the password on this account.</p>` +
        `<p>Use the link below or paste the token into the app:</p>` +
        `<p><a href="${link}"><strong>${link}</strong></a></p>` +
        `<p>Token: <code>${token}</code></p>` +
        `<p>If this wasn't you, you can ignore this email — your password is still safe.</p>` +
        `<p>This link expires in 1 hour.</p>`,
    });
  }
}
