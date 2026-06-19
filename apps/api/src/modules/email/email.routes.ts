import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type EmailService } from "./email.service.js";

export interface EmailRouteDeps {
  service: EmailService;
  jwtAccessSecret: string;
  /** Same rate limit envelope used by /auth/login etc. */
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

const SendVerificationResponse = z.object({ sent: z.boolean() });
const VerifyEmailRequest = z.object({
  token: z.string().min(1).max(512),
});
const VerifyEmailResponse = z.object({ verified: z.boolean() });

const RequestPasswordResetRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
/** Always 200 with `{ requested: true }` — body intentionally lies about
 *  whether the email was on file. See `EmailService.requestPasswordReset`. */
const RequestPasswordResetResponse = z.object({ requested: z.literal(true) });

const ResetPasswordRequest = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    token: z.string().min(6).max(512).optional(),
    password: z.string().min(12).max(200).optional(),
    new_password: z.string().min(12).max(200).optional(),
  })
  .refine(
    (body) => body.token !== undefined || (body.email !== undefined && body.code !== undefined),
    {
      message: "Either token or email + code is required",
    },
  )
  .refine((body) => body.password !== undefined || body.new_password !== undefined, {
    message: "Password is required",
  });
const ResetPasswordResponse = z.object({ reset: z.literal(true) });

export function registerEmailRoutes(app: LinkfitServer, deps: EmailRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });
  const authRl = {
    max: deps.authRateLimit.max,
    timeWindow: deps.authRateLimit.timeWindowMs,
  };

  app.post(
    "/api/v1/auth/send-verification",
    {
      preHandler: authenticate,
      config: { rateLimit: authRl },
      schema: {
        response: {
          200: SendVerificationResponse,
          401: ErrorEnvelope,
          429: ErrorEnvelope,
        },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.sendVerification(userId);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/api/v1/auth/verify-email",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: {
        body: VerifyEmailRequest,
        response: {
          200: VerifyEmailResponse,
          401: ErrorEnvelope,
          400: ErrorEnvelope,
        },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.verifyEmail(userId, req.body.token);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/api/v1/auth/request-password-reset",
    {
      config: { rateLimit: authRl },
      schema: {
        body: RequestPasswordResetRequest,
        response: {
          200: RequestPasswordResetResponse,
        },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const result = await deps.service.requestPasswordReset(req.body.email);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/api/v1/auth/reset-password",
    {
      config: { rateLimit: authRl },
      schema: {
        body: ResetPasswordRequest,
        response: {
          200: ResetPasswordResponse,
          400: ErrorEnvelope,
        },
        tags: ["auth"],
      },
    },
    async (req, reply) => {
      const body = req.body;
      const result = await deps.service.resetPassword(
        body.code ?? body.token ?? "",
        body.password ?? body.new_password ?? "",
        body.email,
      );
      return reply.status(200).send(result);
    },
  );
}
