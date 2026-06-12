import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { type DevicePlatform } from "../../shared/db/types.js";
import { ValidationError } from "../../shared/errors/AppError.js";
import { type PushPayload, type PushSender, type PushSendResult } from "./push.sender.js";

/**
 * Push copy lives in `shared/i18n/push.templates.ts` (AZ / EN / RU), not in
 * this service. Callers (feed-comments, social/squads, stories, invitations)
 * resolve the recipient's locale, render the template with
 * `renderPushTemplate(key, locale, values)`, and pass the resulting
 * `{ title, body }` through `NotificationsService.emit` — which in turn
 * invokes `deliverToUser` below. Keeping templates out of the transport
 * layer means a string-only change ("rewrite the squad invite body") never
 * needs to touch APNs plumbing.
 */

export interface PushServiceDeps {
  db: DbHandle;
  sender: PushSender;
  logger: Logger;
}

export interface DeviceTokenOut {
  id: string;
  token: string;
  platform: DevicePlatform;
  last_seen: string;
  created_at: string;
}

/**
 * Reasonable safety bounds for the inbound token. APNs hex tokens are 64
 * chars; APS push tokens (newer key-based registrations) max around 200.
 * Anything outside this range is almost certainly a client bug or attack.
 */
const TOKEN_MIN_LEN = 8;
const TOKEN_MAX_LEN = 512;

export class PushService {
  constructor(private readonly deps: PushServiceDeps) {}

  /**
   * Register or refresh a device token for the current user. Idempotent —
   * the unique (user_id, token) constraint means re-registers just bump
   * `last_seen` and re-activate a previously-revoked row.
   */
  async register(
    userId: string,
    input: { token: string; platform: DevicePlatform },
  ): Promise<DeviceTokenOut> {
    const token = input.token.trim();
    if (token.length < TOKEN_MIN_LEN || token.length > TOKEN_MAX_LEN) {
      throw new ValidationError("Device token has invalid length");
    }
    const row = await this.deps.db.db
      .insertInto("device_tokens")
      .values({
        user_id: userId,
        token,
        platform: input.platform,
        last_seen: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(["user_id", "token"]).doUpdateSet({
          platform: input.platform,
          last_seen: new Date(),
          revoked_at: null,
        }),
      )
      .returning(["id", "token", "platform", "last_seen", "created_at"])
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      token: row.token,
      platform: row.platform,
      last_seen: row.last_seen.toISOString(),
      created_at: row.created_at.toISOString(),
    };
  }

  /**
   * Revoke a single token for a user — called on explicit sign-out or when
   * the OS rotates the device token. Idempotent: revoking an unknown token
   * is a silent no-op (we don't want to leak "is this user logged in?").
   */
  async revoke(userId: string, token: string): Promise<void> {
    await this.deps.db.db
      .updateTable("device_tokens")
      .set({ revoked_at: new Date() })
      .where("user_id", "=", userId)
      .where("token", "=", token)
      .where("revoked_at", "is", null)
      .execute();
  }

  /**
   * Fan-out helper used by the notifications.service. Loads every active
   * token for `userId` and pushes the payload through the configured sender.
   * Uses `Promise.allSettled` so one expired token doesn't take down the
   * write path that emitted the notification in the first place.
   */
  async deliverToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await this.deps.db.db
      .selectFrom("device_tokens")
      .select(["id", "token", "platform"])
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .execute();
    if (tokens.length === 0) return;

    const results = await Promise.allSettled(
      tokens.map((t) =>
        this.deps.sender.send({ token: t.token, platform: t.platform }, payload),
      ),
    );

    // Soft-delete any unregistered tokens so we stop retrying them on the
    // next emit. APNs explicitly returns 410/BadDeviceToken/Unregistered for
    // these and asks senders to stop.
    const toRevoke: string[] = [];
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const v: PushSendResult = r.value;
      if (v.kind === "unregistered") toRevoke.push(v.token);
    }
    if (toRevoke.length > 0) {
      await this.deps.db.db
        .updateTable("device_tokens")
        .set({ revoked_at: new Date() })
        .where("user_id", "=", userId)
        .where("token", "in", toRevoke)
        .execute();
      this.deps.logger.info(
        { userId, count: toRevoke.length },
        "push.revoked_unregistered_tokens",
      );
    }
  }
}
