import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type MedicalService } from "./medical.service.js";
import {
  GameMedicalSummaryResponse,
  MedicalProfileResponse,
  SignWaiverRequest,
  SignWaiverResponse,
  UpdateMedicalProfileRequest,
} from "./medical.schema.js";

export interface MedicalRouteDeps {
  service: MedicalService;
  jwtAccessSecret: string;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export function registerMedicalRoutes(
  app: LinkfitServer,
  deps: MedicalRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // GET /api/v1/me/medical-profile — owner read
  app.get(
    "/api/v1/me/medical-profile",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: MedicalProfileResponse, 401: ErrorEnvelope },
        tags: ["medical"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const profile = await deps.service.getProfile(userId);
      return reply.status(200).send(profile);
    },
  );

  // PUT /api/v1/me/medical-profile — owner upsert
  app.put(
    "/api/v1/me/medical-profile",
    {
      preHandler: authenticate,
      schema: {
        body: UpdateMedicalProfileRequest,
        response: {
          200: MedicalProfileResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["medical"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const profile = await deps.service.upsertProfile(userId, req.body);
      return reply.status(200).send(profile);
    },
  );

  // GET /api/v1/games/:id/medical-summary — host-only
  app.get(
    "/api/v1/games/:id/medical-summary",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: GameMedicalSummaryResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["medical"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const summary = await deps.service.hostSummary(req.params.id, userId);
      return reply.status(200).send(summary);
    },
  );

  // POST /api/v1/tournaments/:id/sign-waiver — required before tournament
  // registration. Idempotent; double-sign returns `already_signed=true`.
  app.post(
    "/api/v1/tournaments/:id/sign-waiver",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SignWaiverRequest,
        response: {
          200: SignWaiverResponse,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["medical"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      // Capture the network metadata the regulator typically asks about.
      // Both are best-effort; behind a proxy chain we trust whatever the
      // configured `trustProxy` allowed Fastify to set on `req.ip`.
      const ip = typeof req.ip === "string" && req.ip.length > 0 ? req.ip : null;
      const uaHeader = req.headers["user-agent"];
      const userAgent =
        typeof uaHeader === "string" && uaHeader.length > 0
          ? uaHeader.slice(0, 500)
          : null;
      const result = await deps.service.signWaiver(req.params.id, userId, {
        ip,
        userAgent,
      });
      return reply.status(200).send(result);
    },
  );
}
