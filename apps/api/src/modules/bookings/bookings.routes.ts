import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  BookingSchema,
  BookingsListResponse,
  CourtAvailabilityQuery,
  CourtAvailabilityResponse,
  CreateBookingRequest,
} from "./bookings.schema.js";
import { type BookingsService } from "./bookings.service.js";

export interface BookingsRouteDeps {
  service: BookingsService;
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

const IdParams = z.object({ id: z.string().uuid() });

export function registerBookingsRoutes(app: LinkfitServer, deps: BookingsRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/v1/courts/:id/availability?date=YYYY-MM-DD — read-only
  // pre-computed 30-minute slot grid for a court on a given day, in the
  // court's local timezone (Asia/Baku for now). Anonymous callers are
  // allowed — the booking-grid surface needs to render before login. The
  // route deliberately lives in the bookings module because the slot data
  // is sourced from the bookings table; routing it through `catalog` would
  // force that module to depend on bookings-specific concerns.
  // ───────────────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/courts/:id/availability",
    {
      schema: {
        params: IdParams,
        querystring: CourtAvailabilityQuery,
        response: {
          200: CourtAvailabilityResponse,
          400: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["bookings", "courts"],
      },
    },
    async (req, reply) => {
      const availability = await deps.service.getAvailability(req.params.id, req.query.date);
      return reply.status(200).send(availability);
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/v1/bookings — create a booking.  Idempotent on
  // `idempotency_key`, which the client SHOULD generate as a UUID v4 once
  // per attempt and reuse on retry.
  // ───────────────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/bookings",
    {
      preHandler: authenticate,
      schema: {
        body: CreateBookingRequest,
        response: {
          201: BookingSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["bookings"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const detail = await deps.service.create(userId, req.body);
      return reply.status(201).send(detail);
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/v1/bookings/me — list the caller's bookings split into
  // `upcoming` (start in the future, not cancelled) and `past` (everything
  // else: completed, cancelled, refunded, or just elapsed).
  // ───────────────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/bookings/me",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: BookingsListResponse, 401: ErrorEnvelope },
        tags: ["bookings"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const page = await deps.service.listMine(userId);
      return reply.status(200).send(page);
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/v1/bookings/:id — read one. Owner-scoped.
  // ───────────────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/bookings/:id",
    {
      preHandler: authenticate,
      schema: {
        params: IdParams,
        response: {
          200: BookingSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["bookings"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const detail = await deps.service.get(req.params.id, userId);
      return reply.status(200).send(detail);
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/v1/bookings/:id/cancel — owner cancels before it starts.
  // ───────────────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/bookings/:id/cancel",
    {
      preHandler: authenticate,
      schema: {
        params: IdParams,
        response: {
          200: BookingSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["bookings"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const detail = await deps.service.cancel(req.params.id, userId);
      return reply.status(200).send(detail);
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/v1/bookings/:id/mark-paid — stub for the future Stripe wiring.
  // Flips the booking to `paid` so the iOS flow can be exercised end-to-end
  // without a payment provider.
  // ───────────────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/bookings/:id/mark-paid",
    {
      preHandler: authenticate,
      schema: {
        params: IdParams,
        response: {
          200: BookingSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["bookings"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const detail = await deps.service.markPaid(req.params.id, userId);
      return reply.status(200).send(detail);
    },
  );
}
