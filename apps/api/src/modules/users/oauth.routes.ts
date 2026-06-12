import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { AuthSessionSchema } from "./users.schema.js";
import { type OauthService } from "./oauth.service.js";

export interface OauthRouteDeps {
  service: OauthService;
  authRateLimit: { max: number; timeWindowMs: number };
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const AppleSignInBody = z.object({
  identity_token: z.string().min(8).max(8192),
  // `authorization_code` is sent by the native SDK but we don't need it for
  // pure auth — the identity_token alone is sufficient and is what the JWS
  // verification operates on. We accept it so the iOS client can include it
  // without a separate code path, but we ignore the value server-side.
  authorization_code: z.string().min(1).max(2048).optional(),
  name: z
    .object({
      first: z.string().max(80).optional(),
      last: z.string().max(80).optional(),
    })
    .optional(),
});

const GoogleSignInBody = z.object({
  id_token: z.string().min(8).max(8192),
});

export function registerOauthRoutes(app: LinkfitServer, deps: OauthRouteDeps): void {
  const rl = {
    max: deps.authRateLimit.max,
    timeWindow: deps.authRateLimit.timeWindowMs,
  };

  app.post(
    "/api/v1/auth/apple",
    {
      config: { rateLimit: rl },
      schema: {
        body: AppleSignInBody,
        response: {
          200: AuthSessionSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const body = req.body;
      const args: Parameters<OauthService["signInWithApple"]>[0] = {
        identity_token: body.identity_token,
      };
      if (body.name !== undefined) {
        const composed: { first?: string; last?: string } = {};
        if (body.name.first !== undefined) composed.first = body.name.first;
        if (body.name.last !== undefined) composed.last = body.name.last;
        args.name = composed;
      }
      const session = await deps.service.signInWithApple(args, {
        user_agent: req.headers["user-agent"] ?? null,
      });
      return reply.status(200).send(session);
    },
  );

  app.post(
    "/api/v1/auth/google",
    {
      config: { rateLimit: rl },
      schema: {
        body: GoogleSignInBody,
        response: {
          200: AuthSessionSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const session = await deps.service.signInWithGoogle(
        { id_token: req.body.id_token },
        { user_agent: req.headers["user-agent"] ?? null },
      );
      return reply.status(200).send(session);
    },
  );
}
