import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  BookingIntentResponseSchema,
  BookingPaymentStatusSchema,
  CreateTournamentIntentRequest,
  PaymentSheetResponseSchema,
} from "./payments.schema.js";
import { type PaymentsService } from "./payments.service.js";

export interface PaymentsRouteDeps {
  service: PaymentsService;
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

export function registerPaymentsRoutes(
  app: LinkfitServer,
  deps: PaymentsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/v1/payments/booking/:id/intent
  // ───────────────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/payments/booking/:id/intent",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: BookingIntentResponseSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["payments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.createBookingIntent(req.params.id, userId);
      return reply.status(200).send(result);
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/v1/payments/booking/:id/status
  //
  // iOS polls this after PaymentSheet completes to confirm the webhook
  // has landed. Returns a normalized {pending,succeeded,failed} so the
  // client doesn't need to know about partially_paid/cancelled/refunded.
  // ───────────────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/payments/booking/:id/status",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: BookingPaymentStatusSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["payments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.getBookingPaymentStatus(req.params.id, userId);
      return reply.status(200).send(result);
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/v1/payments/tournament/:tournamentId/entry-intent
  //
  // Body captures the squad composition; the webhook materializes the entry
  // after the charge succeeds, so the tournaments module is untouched here.
  // ───────────────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/payments/tournament/:tournamentId/entry-intent",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ tournamentId: z.string().uuid() }),
        body: CreateTournamentIntentRequest,
        response: {
          200: PaymentSheetResponseSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["payments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.createTournamentEntryIntent(
        req.params.tournamentId,
        userId,
        req.body,
      );
      return reply.status(200).send(result);
    },
  );
}
