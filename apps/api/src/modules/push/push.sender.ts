import { connect, constants as h2c, type ClientHttp2Session } from "node:http2";
import { createSign } from "node:crypto";
import { type Logger } from "pino";
import { type NotificationType } from "../../shared/db/types.js";

/**
 * Cross-platform push payload contract. The shape mirrors what gets persisted
 * in `notifications.payload` so the iOS tap-handler can deep-link with the
 * same keys it reads from the in-app feed.
 */
export interface PushPayload {
  /** Logical notification type — drives client routing & sound choice. */
  type: NotificationType;
  /** Short, user-facing title (matches in-app `notifications.title`). */
  title: string;
  /** Body copy — kept brief; APNs truncates ~240 chars in the banner. */
  body: string;
  /** Arbitrary entity context. iOS reads `entity_id` + `type` to deep-link. */
  data: Record<string, unknown>;
  /** Optional unread-badge value the client should show on its tab badge. */
  badge?: number;
  /**
   * Optional iOS notification grouping key. Surfaces in the APNs payload as
   * `aps.thread-id` — iOS groups banners with the same value into a single
   * stack on the lock screen (e.g. `conversation:<id>` so five messages from
   * the same chat collapse into one expandable group).
   */
  threadId?: string;
  /**
   * Optional APNs replacement key. Sent as the `apns-collapse-id` header —
   * APNs delivers at most one notification per id and the newest one
   * supersedes any older undelivered ones (e.g. a fresh `game_reminder`
   * replaces a five-minutes-ago reminder still queued on the device).
   * Apple caps this at 64 bytes; longer values are rejected by the gateway.
   */
  collapseId?: string;
}

export interface PushTarget {
  token: string;
  /** Hint for the sender to pick a transport. Only `ios` is implemented;
   *  `android` rows are accepted by the registry but silently skipped by
   *  the APNs sender (FCM lives in a future agent). */
  platform: "ios" | "android";
}

export type PushSendResult =
  | { kind: "delivered"; token: string }
  | { kind: "unregistered"; token: string; reason: string }
  | { kind: "skipped"; token: string; reason: string }
  | { kind: "failed"; token: string; reason: string };

export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<PushSendResult>;
  close(): Promise<void>;
}

/**
 * Dev/test sender — captures everything in-memory and logs at debug. Used
 * when APNs env is missing so local development and integration tests can
 * exercise the full notifications.service flow without any external service.
 */
export class LoggingSender implements PushSender {
  public readonly sent: { target: PushTarget; payload: PushPayload }[] = [];

  constructor(private readonly logger: Logger) {}

  async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
    this.sent.push({ target, payload });
    this.logger.debug(
      { token: target.token.slice(0, 8) + "…", type: payload.type },
      "push.logging.sent",
    );
    return Promise.resolve({ kind: "delivered", token: target.token });
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

export interface ApnsSenderConfig {
  /** 10-char APNs key id from developer.apple.com. */
  keyId: string;
  /** 10-char Apple developer team id. */
  teamId: string;
  /** App bundle id, used as `apns-topic`. */
  bundleId: string;
  /** PEM-encoded ES256 private key (the contents of the `.p8` file). */
  authKey: string;
  /** Use the sandbox APNs gateway. Defaults to `false` (production). */
  useSandbox?: boolean;
}

/**
 * Cached signing-only context. APNs JWTs are reused for up to ~55min; we
 * rotate before the 60-minute server-side ceiling.
 */
interface ApnsJwt {
  token: string;
  expiresAt: number; // epoch seconds
}

/**
 * Production APNs HTTP/2 sender. Uses Apple's documented JWT-with-ES256
 * authentication — no third-party package required. The session is kept
 * open and reused; APNs servers happily multiplex thousands of streams
 * over a single connection.
 *
 * Failure modes are mapped to:
 *  - `delivered` when APNs returns 200.
 *  - `unregistered` when APNs returns 410, OR 400 with reason
 *    `BadDeviceToken`/`DeviceTokenNotForTopic` — the registry should soft-
 *    delete these tokens so the next emit doesn't re-attempt them.
 *  - `failed` for anything else (transient network errors included).
 */
export class ApnsSender implements PushSender {
  private static readonly JWT_TTL_SECONDS = 50 * 60; // 50 min, refresh before 60
  private readonly host: string;
  private session: ClientHttp2Session | null = null;
  private jwt: ApnsJwt | null = null;

  constructor(
    private readonly config: ApnsSenderConfig,
    private readonly logger: Logger,
  ) {
    this.host = config.useSandbox === true
      ? "https://api.sandbox.push.apple.com:443"
      : "https://api.push.apple.com:443";
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
    if (target.platform !== "ios") {
      return { kind: "skipped", token: target.token, reason: "non-ios platform" };
    }
    if (!/^[0-9a-fA-F]{8,}$/.test(target.token)) {
      // APNs hex tokens are 64 hex chars in practice; we accept >= 8 for safety
      // in tests but reject obviously-malformed tokens early.
      return { kind: "unregistered", token: target.token, reason: "malformed token" };
    }

    const session = this.ensureSession();
    const jwt = this.ensureJwt();

    const body = Buffer.from(JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
        ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
        "mutable-content": 1,
        // iOS groups banners with the same `thread-id` on the lock screen.
        // Only emit when the caller provided one — APNs otherwise treats
        // every notification as its own thread, which is the right default
        // for free-form `system` events without a domain anchor.
        ...(payload.threadId !== undefined ? { "thread-id": payload.threadId } : {}),
      },
      // Custom keys live alongside `aps`. iOS reads these in the tap handler.
      type: payload.type,
      ...payload.data,
    }));

    return await new Promise<PushSendResult>((resolve) => {
      const headers: Record<string, string | number> = {
        [h2c.HTTP2_HEADER_METHOD]: "POST",
        [h2c.HTTP2_HEADER_PATH]: `/3/device/${target.token}`,
        [h2c.HTTP2_HEADER_SCHEME]: "https",
        authorization: `bearer ${jwt}`,
        "apns-topic": this.config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
        "content-length": body.length,
        // APNs replaces any undelivered notification carrying the same
        // collapse-id with the newer payload (e.g. a fresh game reminder
        // supersedes one queued five minutes ago). Header is omitted when
        // unset so each notification stands alone.
        ...(payload.collapseId !== undefined ? { "apns-collapse-id": payload.collapseId } : {}),
      };

      const req = session.request(headers);
      let status = 0;
      const chunks: Buffer[] = [];
      req.on("response", (h) => {
        const s = h[h2c.HTTP2_HEADER_STATUS];
        status = typeof s === "number" ? s : Number(s ?? 0);
      });
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (status === 200) {
          resolve({ kind: "delivered", token: target.token });
          return;
        }
        let reason = "unknown";
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { reason?: string };
          reason = parsed.reason ?? `http ${String(status)}`;
        } catch {
          reason = `http ${String(status)}`;
        }
        if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic") {
          resolve({ kind: "unregistered", token: target.token, reason });
        } else {
          this.logger.warn({ status, reason, type: payload.type }, "apns.send.failed");
          resolve({ kind: "failed", token: target.token, reason });
        }
      });
      req.on("error", (err: Error) => {
        this.logger.warn({ err: err.message, type: payload.type }, "apns.stream.error");
        resolve({ kind: "failed", token: target.token, reason: err.message });
      });
      req.setTimeout(10_000, () => {
        req.close();
        resolve({ kind: "failed", token: target.token, reason: "timeout" });
      });
      req.end(body);
    });
  }

  async close(): Promise<void> {
    if (this.session && !this.session.destroyed) {
      await new Promise<void>((resolve) => {
        this.session?.close(() => { resolve(); });
      });
    }
    this.session = null;
    this.jwt = null;
  }

  private ensureSession(): ClientHttp2Session {
    if (this.session && !this.session.destroyed && !this.session.closed) {
      return this.session;
    }
    const session = connect(this.host);
    session.on("error", (err: Error) => {
      this.logger.warn({ err: err.message }, "apns.session.error");
    });
    session.on("close", () => {
      if (this.session === session) this.session = null;
    });
    this.session = session;
    return session;
  }

  private ensureJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && this.jwt.expiresAt > now + 60) {
      return this.jwt.token;
    }
    const header = base64url(JSON.stringify({ alg: "ES256", kid: this.config.keyId, typ: "JWT" }));
    const claims = base64url(JSON.stringify({ iss: this.config.teamId, iat: now }));
    const signingInput = `${header}.${claims}`;
    const signer = createSign("SHA256");
    signer.update(signingInput);
    signer.end();
    // The .p8 file is a PKCS#8 PEM. createSign accepts the PEM directly.
    const der = signer.sign({ key: this.config.authKey, dsaEncoding: "ieee-p1363" });
    const token = `${signingInput}.${base64urlBytes(der)}`;
    this.jwt = { token, expiresAt: now + ApnsSender.JWT_TTL_SECONDS };
    return token;
  }
}

function base64url(input: string): string {
  return base64urlBytes(Buffer.from(input, "utf8"));
}

function base64urlBytes(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
