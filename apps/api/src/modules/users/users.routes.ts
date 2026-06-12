import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  AuthSessionSchema,
  LoginRequest,
  LogoutRequest,
  PublicUserSchema,
  RefreshRequest,
  RegisterRequest,
  UpdateMeRequest,
} from "./users.schema.js";
import { type UsersService } from "./users.service.js";
import {
  type SpamChecks,
  signupRejectToHttp,
} from "../../shared/security/spam-checks.js";

export interface UsersRouteDeps {
  service: UsersService;
  jwtAccessSecret: string;
  authRateLimit: { max: number; timeWindowMs: number };
  /** Optional — when present, the register route runs the
   *  composite spam check (disposable email + per-IP daily budget)
   *  BEFORE invoking the service. Omitted in legacy unit tests; the
   *  full server build always wires it. */
  spamChecks?: SpamChecks | undefined;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const NoBody = z.object({}).strict();

export function registerUsersRoutes(app: LinkfitServer, deps: UsersRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  const authRl = {
    max: deps.authRateLimit.max,
    timeWindow: deps.authRateLimit.timeWindowMs,
  };

  /** Pulls the User-Agent header into the shape `UsersService` accepts.
   *  Centralized so every auth-mint route captures attribution uniformly. */
  const captureUa = (req: { headers: { "user-agent"?: string | undefined } }): { user_agent: string | null } => ({
    user_agent: req.headers["user-agent"] ?? null,
  });

  // POST /api/v1/auth/register — strict rate limit; expensive (Argon2 hash).
  // Three-layer trust & safety pipeline runs BEFORE the (expensive) service
  // call so a 429/400 reject doesn't burn an Argon2 hash:
  //   1. disposable-email blacklist (in `spamChecks.checkSignupAllowed`)
  //   2. per-IP daily budget (24h sliding window, also inside the check)
  //   3. the attempt itself is logged — even rejected ones count toward
  //      the attacker's budget.
  // See `shared/security/spam-checks.ts`.
  //
  // Wave-10 viral hook: an optional `?ref=<code>` query string mirrors the
  // body's `ref` field so the share link
  // `https://linkfit.az/r/<code>` → signup deep link can pass attribution
  // without requiring the iOS client to forward the code into the JSON
  // body. The body always wins if both are present.
  app.post(
    "/api/v1/auth/register",
    {
      config: { rateLimit: authRl },
      schema: {
        body: RegisterRequest,
        querystring: z.object({
          ref: z.string().trim().min(1).max(16).optional(),
        }),
        response: {
          201: AuthSessionSchema,
          400: ErrorEnvelope,
          409: ErrorEnvelope,
          429: ErrorEnvelope,
        },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      if (deps.spamChecks !== undefined) {
        const ip = req.ip;
        // Record FIRST so even malformed/duplicate signups count toward
        // the budget. Then check — the just-inserted row is included in
        // the count, so the N-th attempt (where N === limit + 1) lands
        // on the >= comparison.
        await deps.spamChecks.recordSignupAttempt(ip);
        const verdict = await deps.spamChecks.checkSignupAllowed(ip, req.body.email);
        if (!verdict.ok) {
          const reason = verdict.reason ?? "disposable_email";
          const err = signupRejectToHttp(reason);
          return reply.status(err.status).send({
            error: { code: err.code, message: err.message, request_id: req.id },
          });
        }
      }
      // Merge `?ref=` into the body when the body didn't carry one. We never
      // overwrite an explicit body value — that's the iOS client's intent.
      const body =
        req.body.ref === undefined && req.query.ref !== undefined
          ? { ...req.body, ref: req.query.ref }
          : req.body;
      const session = await deps.service.register(body, captureUa(req));
      return reply.status(201).send(session);
    },
  );

  app.post(
    "/api/v1/auth/login",
    {
      config: { rateLimit: authRl },
      schema: {
        body: LoginRequest,
        response: { 200: AuthSessionSchema, 401: ErrorEnvelope },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const session = await deps.service.login(req.body, captureUa(req));
      return reply.status(200).send(session);
    },
  );

  app.post(
    "/api/v1/auth/refresh",
    {
      // Refresh is also rate-limited to defend against bursts of stolen-token
      // probing. We allow 6× the normal auth limit since legitimate clients
      // refresh proactively before expiry.
      config: {
        rateLimit: {
          max: deps.authRateLimit.max * 6,
          timeWindow: deps.authRateLimit.timeWindowMs,
        },
      },
      schema: {
        body: RefreshRequest,
        response: { 200: AuthSessionSchema, 401: ErrorEnvelope },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const session = await deps.service.refresh(req.body.refresh_token, captureUa(req));
      return reply.status(200).send(session);
    },
  );

  app.post(
    "/api/v1/auth/logout",
    {
      schema: {
        body: LogoutRequest,
        response: { 204: NoBody },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      await deps.service.logout(req.body.refresh_token);
      return reply.status(204).send({});
    },
  );

  app.get(
    "/api/v1/me",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: PublicUserSchema, 401: ErrorEnvelope },
        tags: ["users"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const me = await deps.service.getMe(userId);
      return reply.status(200).send(me);
    },
  );

  app.patch(
    "/api/v1/me",
    {
      preHandler: authenticate,
      schema: {
        body: UpdateMeRequest,
        response: { 200: PublicUserSchema, 400: ErrorEnvelope, 401: ErrorEnvelope },
        tags: ["users"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const me = await deps.service.updateMe(userId, req.body);
      return reply.status(200).send(me);
    },
  );
}
