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
  hashEmailToken,
} from "./email.tokens.js";
import { type MailTransport } from "./email.transport.js";

/**
 * Default expiry windows. Verification links live longer than reset links
 * because the user has no urgency to act, while reset links are higher-risk
 * if intercepted. Numbers tuned to be friendly without becoming dangerous:
 *
 *  - verify         → 24h
 *  - reset_password → 1h
 *
 * Cool-down keeps abusive resend loops in check; 60s is the contractual
 * floor (see task spec).
 */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_SECONDS = 60;

export interface EmailServiceDeps {
  db: DbHandle;
  logger: Logger;
  transport: MailTransport;
  /** Base URL used to build the magic-link sent in the email body. The link
   *  is informational — the API doesn't follow it; it tells the user where
   *  to paste the token (the iOS client supports both URL and code entry). */
  publicAppUrl: string;
}

export class EmailService {
  constructor(private readonly deps: EmailServiceDeps) {}

  // ───────────────────────── send-verification ─────────────────────────

  /**
   * Mint a verification token and email it. Idempotent within
   * `RESEND_COOLDOWN_SECONDS` — repeated calls before the cool-down expires
   * throw `RateLimitedError`. We do NOT silently re-send the previous token
   * because the prior hash is in the DB; we'd have no way to deliver the
   * raw value again.
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

    const fresh = generateEmailToken();
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
    await emailRepository.insertToken(this.deps.db.db, {
      user_id: userId,
      kind: "verify",
      token_hash: fresh.hash,
      expires_at: expiresAt,
    });

    await this.deliverVerify(user.email, fresh.token);
    return { sent: true };
  }

  // ───────────────────────── verify-email ─────────────────────────

  /** Consume a verification token. Bad / expired / re-used → 400. */
  async verifyEmail(rawToken: string): Promise<{ verified: boolean }> {
    const tokenHash = hashEmailToken(rawToken);
    return withTransaction(this.deps.db.db, async (tx) => {
      const row = await emailRepository.findByHash(tx, tokenHash, "verify");
      if (row === null) {
        throw new ValidationError("Invalid verification token");
      }
      const consumed = await emailRepository.consumeToken(tx, row.id);
      if (consumed === null) {
        // Either already used, or expired — uniform error to the client.
        throw new ValidationError("Token is no longer valid");
      }
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
    await emailRepository.insertToken(this.deps.db.db, {
      user_id: user.id,
      kind: "reset_password",
      token_hash: fresh.hash,
      expires_at: expiresAt,
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

  private async deliverVerify(to: string, token: string): Promise<void> {
    const link = `${this.deps.publicAppUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.deps.transport.send({
      to,
      subject: "Verify your Linkfit email",
      text:
        `Welcome to Linkfit!\n\n` +
        `Confirm your address by tapping the link below or pasting the token into the app:\n\n` +
        `${link}\n\n` +
        `Token: ${token}\n\n` +
        `This link expires in 24 hours.`,
      html:
        `<p>Welcome to Linkfit!</p>` +
        `<p>Confirm your address by tapping the link below or pasting the token into the app:</p>` +
        `<p><a href="${link}"><strong>${link}</strong></a></p>` +
        `<p>Token: <code>${token}</code></p>` +
        `<p>This link expires in 24 hours.</p>`,
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
