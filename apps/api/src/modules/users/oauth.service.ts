/**
 * OAuth provider sign-in: Apple + Google.
 *
 * Both providers issue an ID token in JWS Compact Serialization form, signed
 * with an asymmetric key whose public half is published at a well-known JWKS
 * URL. We verify the signature locally (no round-trip per request), check
 * `iss`/`aud`/`exp`/`iat`, then upsert a user row keyed on the provider's
 * stable `sub` claim. The Linkfit session shape returned matches /auth/login
 * exactly so iOS treats the response identically.
 *
 * Test isolation: `JwksProvider` is injected so the test suite can swap in
 * a deterministic fake without network. The default provider fetches the
 * upstream JWKS over HTTPS and caches keys for 1h.
 */
import { createPublicKey, createVerify, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../../shared/db/pool.js";
import { withTransaction, type Executor } from "../../shared/db/withTransaction.js";
import {
  ConflictError,
  UnauthenticatedError,
  ValidationError,
} from "../../shared/errors/AppError.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import {
  generateRefreshToken,
} from "../../shared/auth/refreshToken.js";
import { refreshTokensRepository } from "./refreshTokens.repository.js";
import { type AuthSession, type PublicUser } from "./users.types.js";
import { type TelemetryHandle } from "../../shared/telemetry/metrics.js";

// ───────────────────────────── JWKS types ─────────────────────────────

/** A subset of RFC 7517 keys we accept — RSA (Apple, Google) and EC (Google). */
export interface Jwk {
  kty: "RSA" | "EC";
  kid: string;
  alg?: string;
  use?: string;
  // RSA
  n?: string;
  e?: string;
  // EC
  crv?: string;
  x?: string;
  y?: string;
}

export interface Jwks {
  keys: Jwk[];
}

export interface JwksProvider {
  /** Returns the JWKS for the given issuer URL (Apple or Google).
   *  Implementations should cache for ~1h to stay below upstream rate limits. */
  fetchJwks(issuerJwksUrl: string): Promise<Jwks>;
}

/** Default JWKS fetcher backed by global fetch + an in-memory cache. */
export class HttpJwksProvider implements JwksProvider {
  private cache = new Map<string, { keys: Jwks; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async fetchJwks(url: string): Promise<Jwks> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.keys;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new UnauthenticatedError("OAuth provider keyset unavailable");
    }
    const body = (await res.json()) as Jwks;
    if (!Array.isArray(body.keys)) {
      throw new UnauthenticatedError("OAuth provider keyset malformed");
    }
    this.cache.set(url, { keys: body, expiresAt: Date.now() + this.ttlMs });
    return body;
  }
}

// ───────────────────────────── JWS verification ─────────────────────────────

interface JwsHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface VerifiedClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  email?: string;
  email_verified?: boolean | string;
}

function base64UrlDecode(input: string): Buffer {
  // Node accepts base64url natively since 16.x.
  return Buffer.from(input, "base64url");
}

function jwkToPem(jwk: Jwk): Buffer {
  // createPublicKey supports JWK input directly. We convert to SPKI DER so
  // the verify path can pass either Buffer or KeyObject. Apple ships only
  // RSA; Google ships RSA (RS256). EC support is included for future Google
  // rotations — they have published ES256 keys in the past.
  const key = createPublicKey({
    key: jwk as unknown as Record<string, unknown>,
    format: "jwk",
  });
  return key.export({ type: "spki", format: "der" });
}

function nodeVerifyAlg(alg: string): string {
  // Map JWS alg → openssl algorithm name used by createVerify.
  switch (alg) {
    case "RS256": return "RSA-SHA256";
    case "RS384": return "RSA-SHA384";
    case "RS512": return "RSA-SHA512";
    case "ES256": return "SHA256";
    case "ES384": return "SHA384";
    default: throw new UnauthenticatedError(`Unsupported OAuth token alg: ${alg}`);
  }
}

function verifyJws(
  token: string,
  expectedIssuers: string[],
  expectedAudiences: string[],
  jwks: Jwks,
  now: number = Date.now(),
): VerifiedClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new UnauthenticatedError("Malformed OAuth token");
  }
  // After the length check, all three positions are guaranteed-defined,
  // but TypeScript's `noUncheckedIndexedAccess` still types each access
  // as `string | undefined`. The three-way destructure is the cleanest
  // way to surface both facts to the compiler at once.
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  let header: JwsHeader;
  let payload: VerifiedClaims;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8")) as JwsHeader;
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as VerifiedClaims;
  } catch {
    throw new UnauthenticatedError("Malformed OAuth token");
  }

  if (!header.alg || header.alg === "none") {
    throw new UnauthenticatedError("OAuth token missing signature alg");
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new UnauthenticatedError("OAuth token signed with unknown key");
  }

  const signed = `${headerB64}.${payloadB64}`;
  const signature = base64UrlDecode(sigB64);
  const verifier = createVerify(nodeVerifyAlg(header.alg));
  verifier.update(signed);
  verifier.end();

  // For EC tokens the signature is a fixed-size r||s concatenation; Node's
  // createVerify expects DER. We only support RSA in production today (both
  // Apple and Google issue RS256) — guard EC behind an explicit error so we
  // never silently accept an unverified token.
  if (header.alg.startsWith("ES")) {
    throw new UnauthenticatedError(
      "EC-signed OAuth tokens are not yet supported — please reissue with RS256",
    );
  }

  const publicKey = createPublicKey({
    key: jwk as unknown as Record<string, unknown>,
    format: "jwk",
  });
  const ok = verifier.verify(publicKey, signature);
  if (!ok) {
    throw new UnauthenticatedError("OAuth token signature invalid");
  }

  // Verified — now apply claims policy.
  if (!expectedIssuers.includes(payload.iss)) {
    throw new UnauthenticatedError(`OAuth token issuer rejected: ${payload.iss}`);
  }
  const audValues = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const audOk = audValues.some((a) => expectedAudiences.includes(a));
  if (!audOk) {
    throw new UnauthenticatedError("OAuth token audience rejected");
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) {
    throw new UnauthenticatedError("OAuth token expired");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new UnauthenticatedError("OAuth token missing subject");
  }
  return payload;
}

// ───────────────────────────── Repository helpers ─────────────────────────────
// We use raw kysely SQL here to avoid widening the global Database type for
// columns owned by this module. The columns live on `users` regardless and
// no other module reads `apple_sub`/`google_sub`.

interface OauthUserRow {
  id: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  home_lat: string | null;
  home_lng: string | null;
  apple_sub: string | null;
  google_sub: string | null;
  email_verified_at: Date | null;
  created_at: Date;
}

function rowToPublic(row: OauthUserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    photo_url: row.photo_url,
    home_lat: row.home_lat === null ? null : Number(row.home_lat),
    home_lng: row.home_lng === null ? null : Number(row.home_lng),
    created_at: row.created_at.toISOString(),
    email_verified_at:
      row.email_verified_at === null ? null : row.email_verified_at.toISOString(),
    // OAuth flow doesn't promote admins — they get the role via the
    // dedicated admin tooling. Fresh OAuth sign-ins always start without.
    admin_role: null,
  };
}

async function findBySub(
  tx: Executor,
  provider: "apple" | "google",
  sub: string,
): Promise<OauthUserRow | null> {
  const column = provider === "apple" ? sql.ref("apple_sub") : sql.ref("google_sub");
  const result = await sql<OauthUserRow>`
    SELECT id, email, display_name, photo_url, home_lat, home_lng,
           apple_sub, google_sub, email_verified_at, created_at
    FROM users
    WHERE ${column} = ${sub} AND deleted_at IS NULL
    LIMIT 1
  `.execute(tx);
  return result.rows[0] ?? null;
}

async function findByEmail(tx: Executor, email: string): Promise<OauthUserRow | null> {
  const result = await sql<OauthUserRow>`
    SELECT id, email, display_name, photo_url, home_lat, home_lng,
           apple_sub, google_sub, email_verified_at, created_at
    FROM users
    WHERE email = ${email} AND deleted_at IS NULL
    LIMIT 1
  `.execute(tx);
  return result.rows[0] ?? null;
}

async function linkProvider(
  tx: Executor,
  userId: string,
  provider: "apple" | "google",
  sub: string,
): Promise<void> {
  if (provider === "apple") {
    await sql`UPDATE users SET apple_sub = ${sub} WHERE id = ${userId}`.execute(tx);
  } else {
    await sql`UPDATE users SET google_sub = ${sub} WHERE id = ${userId}`.execute(tx);
  }
}

async function markEmailVerified(
  tx: Executor,
  userId: string,
  verifiedAt: Date,
): Promise<void> {
  await sql`
    UPDATE users
    SET email_verified_at = ${verifiedAt}
    WHERE id = ${userId}
      AND email_verified_at IS NULL
  `.execute(tx);
}

async function insertOauthUser(
  tx: Executor,
  params: {
    email: string;
    display_name: string;
    provider: "apple" | "google";
    sub: string;
  },
): Promise<OauthUserRow> {
  const appleSub = params.provider === "apple" ? params.sub : null;
  const googleSub = params.provider === "google" ? params.sub : null;
  // OAuth callers have already proven control of the address via Apple/Google,
  // so we mark the email verified at row-creation time. Password-flow users
  // start with `email_verified_at = NULL` and must complete the magic-link flow.
  const result = await sql<OauthUserRow>`
    INSERT INTO users (email, display_name, password_hash, apple_sub, google_sub, email_verified_at)
    VALUES (${params.email}, ${params.display_name}, NULL, ${appleSub}, ${googleSub}, now())
    RETURNING id, email, display_name, photo_url, home_lat, home_lng,
              apple_sub, google_sub, email_verified_at, created_at
  `.execute(tx);
  const row = result.rows[0];
  if (!row) {
    throw new ConflictError("Failed to create OAuth user");
  }
  return row;
}

// ───────────────────────────── Service ─────────────────────────────

export interface OauthServiceDeps {
  db: DbHandle;
  logger: Logger;
  jwtAccessSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  appleClientIds: string[];
  googleClientIds: string[];
  jwks: JwksProvider;
  /** Override for tests — defaults to apple/google production URLs. */
  appleJwksUrl?: string;
  googleJwksUrl?: string;
  /** Optional telemetry — when set, each OAuth sign-in increments
   *  `linkfit_auth_attempts_total{method=apple|google,result=ok|fail}`. */
  telemetry?: TelemetryHandle | undefined;
}

export interface AppleSignInRequest {
  identity_token: string;
  /** Optional — only populated on the very first Apple authorization. */
  name?: { first?: string; last?: string };
}

export interface GoogleSignInRequest {
  id_token: string;
}

/**
 * Per-call HTTP context for OAuth sign-in. Mirrors `AuthRequestContext` in
 * `users.service.ts` so the routes layer can pass a single captured UA into
 * either entry point. Kept as its own type to avoid a cross-module import
 * cycle.
 */
export interface OauthRequestContext {
  user_agent?: string | null | undefined;
}

const APPLE_ISS = "https://appleid.apple.com";
const APPLE_JWKS = "https://appleid.apple.com/auth/keys";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

const FALLBACK_DISPLAY_NAME = "Linkfit Player";

function safeDisplayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const trimmed = local.replace(/[^A-Za-z0-9 .'-]/g, " ").trim();
  if (trimmed.length === 0) return FALLBACK_DISPLAY_NAME;
  return trimmed.slice(0, 80);
}

export class OauthService {
  constructor(private readonly deps: OauthServiceDeps) {}

  async signInWithApple(
    req: AppleSignInRequest,
    ctx: OauthRequestContext = {},
  ): Promise<AuthSession> {
    try {
      const session = await this.doSignInWithApple(req, ctx);
      this.deps.telemetry?.business.authAttempts.inc({ method: "apple", result: "ok" });
      return session;
    } catch (err) {
      this.deps.telemetry?.business.authAttempts.inc({ method: "apple", result: "fail" });
      throw err;
    }
  }

  async signInWithGoogle(
    req: GoogleSignInRequest,
    ctx: OauthRequestContext = {},
  ): Promise<AuthSession> {
    try {
      const session = await this.doSignInWithGoogle(req, ctx);
      this.deps.telemetry?.business.authAttempts.inc({ method: "google", result: "ok" });
      return session;
    } catch (err) {
      this.deps.telemetry?.business.authAttempts.inc({ method: "google", result: "fail" });
      throw err;
    }
  }

  private async doSignInWithApple(
    req: AppleSignInRequest,
    ctx: OauthRequestContext,
  ): Promise<AuthSession> {
    if (typeof req.identity_token !== "string" || req.identity_token.length === 0) {
      throw new ValidationError("identity_token is required");
    }
    const jwks = await this.deps.jwks.fetchJwks(this.deps.appleJwksUrl ?? APPLE_JWKS);
    const claims = verifyJws(
      req.identity_token,
      [APPLE_ISS],
      this.deps.appleClientIds,
      jwks,
    );
    // Apple may omit email after the first sign-in. The `sub` is always there
    // and is the stable account key.
    const sub = claims.sub;
    const email = (claims.email ?? "").trim().toLowerCase();
    if (email.length === 0) {
      // First-time sign-in must include email — Apple sends it once. We can't
      // safely create a row without one because the users table requires it.
      const existing = await findBySub(this.deps.db.db, "apple", sub);
      if (existing === null) {
        throw new ValidationError(
          "Apple did not return an email on this sign-in — sign out of Linkfit in Settings → Apple ID → Sign in with Apple and retry",
        );
      }
      return this.issueSessionFor(existing, ctx);
    }
    const displayName = this.buildName(req.name) ?? safeDisplayNameFromEmail(email);
    return this.upsertAndIssue("apple", sub, email, displayName, ctx);
  }

  private async doSignInWithGoogle(
    req: GoogleSignInRequest,
    ctx: OauthRequestContext,
  ): Promise<AuthSession> {
    if (typeof req.id_token !== "string" || req.id_token.length === 0) {
      throw new ValidationError("id_token is required");
    }
    const jwks = await this.deps.jwks.fetchJwks(this.deps.googleJwksUrl ?? GOOGLE_JWKS);
    const claims = verifyJws(
      req.id_token,
      GOOGLE_ISSUERS,
      this.deps.googleClientIds,
      jwks,
    );
    const sub = claims.sub;
    const email = (claims.email ?? "").trim().toLowerCase();
    if (email.length === 0) {
      throw new UnauthenticatedError("Google token missing email claim");
    }
    if (claims.email_verified === false || claims.email_verified === "false") {
      throw new UnauthenticatedError("Google email is not verified");
    }
    const displayName = safeDisplayNameFromEmail(email);
    return this.upsertAndIssue("google", sub, email, displayName, ctx, true);
  }

  // ───────────────────── internals ─────────────────────

  private buildName(input?: { first?: string; last?: string }): string | null {
    if (!input) return null;
    const composed = [input.first, input.last]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .join(" ");
    return composed.length > 0 ? composed.slice(0, 80) : null;
  }

  private async upsertAndIssue(
    provider: "apple" | "google",
    sub: string,
    email: string,
    displayName: string,
    ctx: OauthRequestContext,
    forceEmailVerified = false,
  ): Promise<AuthSession> {
    const row = await withTransaction(this.deps.db.db, async (tx) => {
      let row = await findBySub(tx, provider, sub);
      if (!row) {
        const byEmail = await findByEmail(tx, email);
        if (byEmail) {
          // Link the OAuth identity to the existing local account. We do NOT
          // overwrite if the same provider was already linked to a different
          // sub — that's a critical inconsistency and signals account takeover
          // attempts. Reject with a 409.
          const existingProviderSub =
            provider === "apple" ? byEmail.apple_sub : byEmail.google_sub;
          if (existingProviderSub !== null && existingProviderSub !== sub) {
            throw new ConflictError(
              `Account already linked to a different ${provider} identity`,
            );
          }
          if (existingProviderSub === null) {
            await linkProvider(tx, byEmail.id, provider, sub);
          }
          row = {
            ...byEmail,
            [provider === "apple" ? "apple_sub" : "google_sub"]: sub,
          };
        } else {
          row = await insertOauthUser(tx, { email, display_name: displayName, provider, sub });
        }
      }
      if (forceEmailVerified && row.email_verified_at === null) {
        const verifiedAt = new Date();
        await markEmailVerified(tx, row.id, verifiedAt);
        return { ...row, email_verified_at: verifiedAt };
      }
      return row;
    });
    return this.issueSessionFor(row, ctx);
  }

  private async issueSessionFor(
    row: OauthUserRow,
    ctx: OauthRequestContext,
  ): Promise<AuthSession> {
    const user = rowToPublic(row);
    return withTransaction(this.deps.db.db, async (tx) => {
      const familyId = randomUUID();
      const access = signAccessToken(user.id, {
        secret: this.deps.jwtAccessSecret,
        ttlSeconds: this.deps.accessTtlSeconds,
        familyId,
      });
      const refresh = generateRefreshToken();
      const expiresAt = new Date(
        Date.now() + this.deps.refreshTtlDays * 24 * 60 * 60 * 1000,
      );
      await refreshTokensRepository.insert(tx, {
        user_id: user.id,
        token_hash: refresh.hash,
        family_id: familyId,
        expires_at: expiresAt,
        user_agent: ctx.user_agent ?? null,
      });
      return {
        user,
        access_token: access,
        refresh_token: refresh.token,
        access_token_expires_in_seconds: this.deps.accessTtlSeconds,
      };
    });
  }
}

// ───────────────────────────── Public helpers for tests ─────────────────────────────

export const __testing = {
  verifyJws,
  jwkToPem,
};
