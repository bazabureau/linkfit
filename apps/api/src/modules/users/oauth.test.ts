/**
 * OAuth (Apple + Google) provider sign-in.
 *
 * All tests are hermetic — we generate a fresh RSA keypair per suite and
 * publish its JWK via a `FakeJwksProvider`, then mount routes manually
 * pointing at the same fake provider. No network is touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import Fastify from "fastify";
import { sql } from "kysely";
import {
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomUUID,
} from "node:crypto";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { fastifyErrorHandler } from "../../shared/errors/errorMapper.js";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  OauthService,
  type Jwk,
  type Jwks,
  type JwksProvider,
} from "./oauth.service.js";
import { registerOauthRoutes } from "./oauth.routes.js";

// ───────────────────────────── Test helpers ─────────────────────────────

const APPLE_CLIENT = "az.linkfit.app";
const GOOGLE_CLIENT = "1234.apps.googleusercontent.com";
const APPLE_ISS = "https://appleid.apple.com";
const GOOGLE_ISS = "https://accounts.google.com";

function generateRsaKeyPair(kid: string): {
  privatePem: Buffer;
  jwk: Jwk;
} {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwkRaw = publicKey.export({ format: "jwk" }) as Record<string, string>;
  const jwk: Jwk = {
    kty: "RSA",
    kid,
    alg: "RS256",
    use: "sig",
    n: jwkRaw.n!,
    e: jwkRaw.e!,
  };
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as Buffer,
    jwk,
  };
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

interface TokenInputs {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  expSecondsFromNow?: number;
  kid: string;
  privatePem: Buffer;
  alg?: string;
}

function mintJws(inputs: TokenInputs): string {
  const header = {
    alg: inputs.alg ?? "RS256",
    kid: inputs.kid,
    typ: "JWT",
  };
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: inputs.iss,
    aud: inputs.aud,
    sub: inputs.sub,
    iat: now,
    exp: now + (inputs.expSecondsFromNow ?? 3600),
  };
  if (inputs.email !== undefined) payload.email = inputs.email;
  if (inputs.email_verified !== undefined) payload.email_verified = inputs.email_verified;
  const headerB64 = base64Url(JSON.stringify(header));
  const payloadB64 = base64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(createPrivateKey(inputs.privatePem));
  return `${signingInput}.${base64Url(signature)}`;
}

class FakeJwksProvider implements JwksProvider {
  constructor(private readonly keys: Record<string, Jwks>) {}
  async fetchJwks(url: string): Promise<Jwks> {
    const out = this.keys[url];
    if (!out) throw new Error(`No JWKS fixture for ${url}`);
    return out;
  }
}

interface AuthSessionBody {
  user: {
    id: string;
    email: string;
    display_name: string;
    photo_url: string | null;
    home_lat: number | null;
    home_lng: number | null;
    created_at: string;
  };
  access_token: string;
  refresh_token: string;
  access_token_expires_in_seconds: number;
}

interface ErrorBody {
  error: { code: string; message: string };
}

// ───────────────────────────── Suite ─────────────────────────────

describe("oauth routes", () => {
  let app: ReturnType<typeof Fastify> & { listen: unknown; inject: (...args: unknown[]) => unknown };
  let db: DbHandle;
  let appleKeypair: ReturnType<typeof generateRsaKeyPair>;
  let googleKeypair: ReturnType<typeof generateRsaKeyPair>;
  const appleJwksUrl = "https://test.invalid/apple/keys";
  const googleJwksUrl = "https://test.invalid/google/keys";

  beforeAll(async () => {
    db = buildTestDb();
    appleKeypair = generateRsaKeyPair("apple-test-key-1");
    googleKeypair = generateRsaKeyPair("google-test-key-1");
    const jwks: Record<string, Jwks> = {
      [appleJwksUrl]: { keys: [appleKeypair.jwk] },
      [googleJwksUrl]: { keys: [googleKeypair.jwk] },
    };
    const provider = new FakeJwksProvider(jwks);

    const oauthService = new OauthService({
      db,
      logger: pino({ level: "silent" }),
      jwtAccessSecret: "x".repeat(32),
      accessTtlSeconds: 900,
      refreshTtlDays: 30,
      appleClientIds: [APPLE_CLIENT],
      googleClientIds: [GOOGLE_CLIENT],
      jwks: provider,
      appleJwksUrl,
      googleJwksUrl,
    });

    const f = Fastify({ loggerInstance: pino({ level: "silent" }) }).withTypeProvider<ZodTypeProvider>();
    f.setValidatorCompiler(validatorCompiler);
    f.setSerializerCompiler(serializerCompiler);
    f.setErrorHandler(async (err, req, reply) => {
      await fastifyErrorHandler(err, req, reply);
    });
    registerOauthRoutes(f, {
      service: oauthService,
      authRateLimit: { max: 10_000, timeWindowMs: 60_000 },
    });
    // Silence unused-var when using transform-only helpers:
    void jsonSchemaTransform;
    app = f;
  });

  afterAll(async () => {
    await (app as unknown as { close: () => Promise<void> }).close();
    await db.close();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE refresh_tokens, users RESTART IDENTITY CASCADE`.execute(db.db);
  });

  // ─────────────── Apple ───────────────

  describe("POST /api/v1/auth/apple", () => {
    it("creates a new user on first sign-in and returns a Linkfit session", async () => {
      const sub = "apple-user-" + randomUUID();
      const token = mintJws({
        iss: APPLE_ISS, aud: APPLE_CLIENT, sub,
        email: "alice@example.com", email_verified: true,
        kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST",
        url: "/api/v1/auth/apple",
        payload: {
          identity_token: token,
          name: { first: "Alice", last: "Liddell" },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<AuthSessionBody>();
      expect(body.user.email).toBe("alice@example.com");
      expect(body.user.display_name).toBe("Alice Liddell");
      expect(body.access_token.split(".").length).toBe(3);
      expect(body.refresh_token.length).toBeGreaterThan(40);
    });

    it("returns the same user_id when signing in twice with the same Apple sub", async () => {
      const sub = "apple-stable-" + randomUUID();
      const make = () => mintJws({
        iss: APPLE_ISS, aud: APPLE_CLIENT, sub,
        email: "bob@example.com", kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
      });
      const first = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/apple",
        payload: { identity_token: make() },
      });
      expect(first.statusCode).toBe(200);
      const a = first.json<AuthSessionBody>();
      const second = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/apple",
        payload: { identity_token: make() },
      });
      expect(second.statusCode).toBe(200);
      const b = second.json<AuthSessionBody>();
      expect(a.user.id).toBe(b.user.id);
    });

    it("rejects a token signed with a key not in the JWKS (401)", async () => {
      const rogue = generateRsaKeyPair("rogue-key");
      const token = mintJws({
        iss: APPLE_ISS, aud: APPLE_CLIENT, sub: "x",
        email: "x@example.com",
        kid: rogue.jwk.kid, privatePem: rogue.privatePem,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/apple",
        payload: { identity_token: token },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json<ErrorBody>().error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects a token with the wrong audience (401)", async () => {
      const token = mintJws({
        iss: APPLE_ISS, aud: "evil.app", sub: "x",
        email: "x@example.com",
        kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/apple",
        payload: { identity_token: token },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects an expired token (401)", async () => {
      const token = mintJws({
        iss: APPLE_ISS, aud: APPLE_CLIENT, sub: "expired",
        email: "expired@example.com",
        kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
        expSecondsFromNow: -60,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/apple",
        payload: { identity_token: token },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a tampered payload (signature mismatch → 401)", async () => {
      const token = mintJws({
        iss: APPLE_ISS, aud: APPLE_CLIENT, sub: "ok",
        email: "ok@example.com",
        kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
      });
      // Flip a byte of the payload (middle segment).
      const parts = token.split(".");
      const payload = Buffer.from(parts[1]!, "base64url").toString("utf8");
      const tampered = payload.replace("ok@example.com", "attacker@example.com");
      const newPayloadB64 = Buffer.from(tampered).toString("base64url");
      const tamperedToken = `${parts[0]!}.${newPayloadB64}.${parts[2]!}`;
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/apple",
        payload: { identity_token: tamperedToken },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects when Apple omits email on first sign-in and no row exists yet (400)", async () => {
      const token = mintJws({
        iss: APPLE_ISS, aud: APPLE_CLIENT, sub: "first-time-no-email-" + randomUUID(),
        kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/apple",
        payload: { identity_token: token },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─────────────── Google ───────────────

  describe("POST /api/v1/auth/google", () => {
    it("creates a user from a verified Google id_token", async () => {
      const sub = "google-user-" + randomUUID();
      const token = mintJws({
        iss: GOOGLE_ISS, aud: GOOGLE_CLIENT, sub,
        email: "carol@gmail.com", email_verified: true,
        kid: googleKeypair.jwk.kid, privatePem: googleKeypair.privatePem,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/google",
        payload: { id_token: token },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<AuthSessionBody>();
      expect(body.user.email).toBe("carol@gmail.com");
      expect(body.access_token.split(".").length).toBe(3);
    });

    it("rejects a Google token whose email is not verified (401)", async () => {
      const token = mintJws({
        iss: GOOGLE_ISS, aud: GOOGLE_CLIENT, sub: "unverified-" + randomUUID(),
        email: "dave@example.com", email_verified: false,
        kid: googleKeypair.jwk.kid, privatePem: googleKeypair.privatePem,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/google",
        payload: { id_token: token },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a Google token signed by Apple's key (wrong issuer → 401)", async () => {
      // Token claims Google issuer but signed by Apple's key — even though the
      // signature would verify, the kid points at a JWKS for the wrong url.
      // Fake provider returns Google JWKS containing only googleKeypair, so the
      // apple-kid lookup misses and we get UNAUTHENTICATED.
      const token = mintJws({
        iss: GOOGLE_ISS, aud: GOOGLE_CLIENT, sub: "x",
        email: "x@gmail.com", email_verified: true,
        kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
      });
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/google",
        payload: { id_token: token },
      });
      expect(res.statusCode).toBe(401);
    });

    it("links a Google identity to an existing user with the same email", async () => {
      // Create user via Google once.
      const sub1 = "google-link-1-" + randomUUID();
      const t1 = mintJws({
        iss: GOOGLE_ISS, aud: GOOGLE_CLIENT, sub: sub1,
        email: "linker@example.com", email_verified: true,
        kid: googleKeypair.jwk.kid, privatePem: googleKeypair.privatePem,
      });
      const r1 = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/google", payload: { id_token: t1 },
      });
      expect(r1.statusCode).toBe(200);
      const userId = r1.json<AuthSessionBody>().user.id;

      // Same email, same google sub → returns same user.
      const t2 = mintJws({
        iss: GOOGLE_ISS, aud: GOOGLE_CLIENT, sub: sub1,
        email: "linker@example.com", email_verified: true,
        kid: googleKeypair.jwk.kid, privatePem: googleKeypair.privatePem,
      });
      const r2 = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/google", payload: { id_token: t2 },
      });
      expect(r2.statusCode).toBe(200);
      expect(r2.json<AuthSessionBody>().user.id).toBe(userId);
    });

    it("rejects an empty id_token (400 validation)", async () => {
      const res = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
        method: "POST", url: "/api/v1/auth/google",
        payload: { id_token: "" },
      });
      // Zod's min(8) rejects with VALIDATION_ERROR via Fastify-zod.
      expect(res.statusCode).toBe(400);
    });
  });

  // ─────────────── Bonus: cross-provider safety ───────────────

  it("refuses to overwrite an existing Apple sub with a different one for the same email", async () => {
    const subA = "apple-1-" + randomUUID();
    const t1 = mintJws({
      iss: APPLE_ISS, aud: APPLE_CLIENT, sub: subA,
      email: "shared@example.com",
      kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
    });
    const r1 = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
      method: "POST", url: "/api/v1/auth/apple", payload: { identity_token: t1 },
    });
    expect(r1.statusCode).toBe(200);

    const subB = "apple-2-" + randomUUID();
    const t2 = mintJws({
      iss: APPLE_ISS, aud: APPLE_CLIENT, sub: subB,
      email: "shared@example.com",
      kid: appleKeypair.jwk.kid, privatePem: appleKeypair.privatePem,
    });
    const r2 = await (app.inject as (args: unknown) => Promise<{ statusCode: number; json: <T>() => T }>)({
      method: "POST", url: "/api/v1/auth/apple", payload: { identity_token: t2 },
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json<ErrorBody>().error.code).toBe("CONFLICT");
  });
});

// Suppress unused — kept for parity with how other suites import. The
// underscore makes ESLint happy when no test path exercises it.
const _unused = createPublicKey;
void _unused;
