import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildPartnerGuard, requirePartnerVenueId } from "../../shared/auth/partnerGuard.js";
import { requireUserId } from "../../shared/auth/guard.js";
import {
  PartnerVenueSchema,
  PartnerVenueUpdateSchema,
  PartnerCourtSchema,
  PartnerCourtCreateSchema,
  PartnerCourtUpdateSchema,
  PartnerBookingsListQuery,
  PartnerBookingsListResponse,
  PartnerStatsResponse,
  PartnerBookingCreateSchema,
  PartnerBookingRowSchema,
} from "./partner.schema.js";
import { type PartnerService } from "./partner.service.js";

export interface PartnerRouteDeps {
  service: PartnerService;
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
const Empty = z.object({}).strict();

export function registerPartnerRoutes(app: LinkfitServer, deps: PartnerRouteDeps): void {
  const db = deps.service.db;
  const partnerGuard = buildPartnerGuard({
    jwtAccessSecret: deps.jwtAccessSecret,
    db,
  });

  // ───────────── /api/v1/partner/* (PARTNER ONLY) ─────────────

  // GET /api/v1/partner/venue
  app.get(
    "/api/v1/partner/venue",
    {
      preHandler: partnerGuard,
      schema: {
        response: {
          200: PartnerVenueSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const profile = await deps.service.getVenueProfile(venueId);
      return reply.send(profile);
    }
  );

  // PUT /api/v1/partner/venue
  app.put(
    "/api/v1/partner/venue",
    {
      preHandler: partnerGuard,
      schema: {
        body: PartnerVenueUpdateSchema,
        response: {
          200: PartnerVenueSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const update = req.body;
      const profile = await deps.service.updateVenueProfile(venueId, update);
      return reply.send(profile);
    }
  );

  // GET /api/v1/partner/courts
  app.get(
    "/api/v1/partner/courts",
    {
      preHandler: partnerGuard,
      schema: {
        response: {
          200: z.array(PartnerCourtSchema),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const courts = await deps.service.listVenueCourts(venueId);
      return reply.send(courts);
    }
  );

  // POST /api/v1/partner/courts
  app.post(
    "/api/v1/partner/courts",
    {
      preHandler: partnerGuard,
      schema: {
        body: PartnerCourtCreateSchema,
        response: {
          201: PartnerCourtSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const body = req.body;
      const court = await deps.service.createVenueCourt(venueId, body);
      return reply.status(201).send(court);
    }
  );

  // PUT /api/v1/partner/courts/:id
  app.put(
    "/api/v1/partner/courts/:id",
    {
      preHandler: partnerGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: PartnerCourtUpdateSchema,
        response: {
          200: PartnerCourtSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const { id } = req.params;
      const body = req.body;
      const court = await deps.service.updateVenueCourt(venueId, id, body);
      return reply.send(court);
    }
  );

  // DELETE /api/v1/partner/courts/:id
  app.delete(
    "/api/v1/partner/courts/:id",
    {
      preHandler: partnerGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const { id } = req.params;
      await deps.service.deleteVenueCourt(venueId, id);
      return reply.status(204).send({});
    }
  );

  // GET /api/v1/partner/bookings
  app.get(
    "/api/v1/partner/bookings",
    {
      preHandler: partnerGuard,
      schema: {
        querystring: PartnerBookingsListQuery,
        response: {
          200: PartnerBookingsListResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const query = req.query;
      const bookings = await deps.service.listVenueBookings(venueId, query);
      return reply.send(bookings);
    }
  );

  // POST /api/v1/partner/bookings/:id/cancel
  app.post(
    "/api/v1/partner/bookings/:id/cancel",
    {
      preHandler: partnerGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const { id } = req.params;
      const actorId = requireUserId(req);
      await deps.service.cancelVenueBooking(venueId, id, actorId);
      return reply.status(204).send({});
    }
  );

  // POST /api/v1/partner/bookings/:id/mark-paid
  app.post(
    "/api/v1/partner/bookings/:id/mark-paid",
    {
      preHandler: partnerGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const { id } = req.params;
      const actorId = requireUserId(req);
      await deps.service.markVenueBookingPaid(venueId, id, actorId);
      return reply.status(204).send({});
    }
  );

  // POST /api/v1/partner/bookings
  app.post(
    "/api/v1/partner/bookings",
    {
      preHandler: partnerGuard,
      schema: {
        body: PartnerBookingCreateSchema,
        response: {
          201: PartnerBookingRowSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          409: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const actorId = requireUserId(req);
      const body = req.body;
      const booking = await deps.service.createVenueBooking(venueId, actorId, body);
      return reply.status(201).send(booking);
    }
  );

  // GET /api/v1/partner/stats
  app.get(
    "/api/v1/partner/stats",
    {
      preHandler: partnerGuard,
      schema: {
        response: {
          200: PartnerStatsResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const venueId = requirePartnerVenueId(req);
      const stats = await deps.service.getVenueStats(venueId);
      return reply.send(stats);
    }
  );
}
