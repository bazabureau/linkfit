import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAdminGuard } from "../../shared/auth/adminGuard.js";
import { requireUserId } from "../../shared/auth/guard.js";
import {
  AdminBookingsListQuery,
  AdminBookingsListResponse,
  AdminCourtSchema,
  AdminCourtsListResponse,
  AdminGameCancelRequest,
  AdminGameDetailSchema,
  AdminGameUpdateRequest,
  AdminGamesListQuery,
  AdminGamesListResponse,
  AdminStatsSchema,
  AdminTournamentEntriesResponse,
  AdminTournamentSchema,
  AdminTournamentsListQuery,
  AdminTournamentsListResponse,
  AdminUsersListQuery,
  AdminUsersListResponse,
  AdminVenueSchema,
  AuditListQuery,
  AuditListResponse,
  CreateCourtRequest,
  CreateTournamentRequest,
  CreateVenueRequest,
  SetRoleRequest,
  UpdateCourtRequest,
  UpdateTournamentRequest,
  UpdateVenueRequest,
} from "./admin.schema.js";
import { type AdminService } from "./admin.service.js";

export interface AdminRouteDeps {
  service: AdminService;
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

export function registerAdminRoutes(app: LinkfitServer, deps: AdminRouteDeps): void {
  // Reuse the same db handle already inside the service for the guard's
  // role lookup. The route module is the only owner of the wiring; service
  // exposes the handle through a getter to keep the surface tight.
  const db = deps.service.db;
  const adminGuard = buildAdminGuard({
    jwtAccessSecret: deps.jwtAccessSecret,
    db,
  });

  // ───────────── /api/v1/admin/* (ADMIN ONLY) ─────────────
  //
  // NOTE: /api/v1/reports and /api/v1/admin/reports* now live in the
  // reports module (modules/reports/reports.routes.ts).

  app.get(
    "/api/v1/admin/stats",
    {
      preHandler: adminGuard,
      schema: {
        response: { 200: AdminStatsSchema, 401: ErrorEnvelope, 403: ErrorEnvelope },
        tags: ["admin"],
      },
    },
    async (_req, reply) => {
      const stats = await deps.service.stats();
      return reply.status(200).send(stats);
    },
  );

  // --- users ---

  app.get(
    "/api/v1/admin/users",
    {
      preHandler: adminGuard,
      schema: {
        querystring: AdminUsersListQuery,
        response: {
          200: AdminUsersListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const page = await deps.service.listUsers(req.query);
      return reply.status(200).send(page);
    },
  );

  app.post(
    "/api/v1/admin/users/:id/role",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SetRoleRequest,
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.setUserRole(adminId, req.params.id, req.body);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/admin/users/:id/soft-delete",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.softDeleteUser(adminId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/admin/users/:id/restore",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.restoreUser(adminId, req.params.id);
      return reply.status(204).send({});
    },
  );

  // --- games ---

  app.get(
    "/api/v1/admin/games",
    {
      preHandler: adminGuard,
      schema: {
        querystring: AdminGamesListQuery,
        response: {
          200: AdminGamesListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const page = await deps.service.listGames(req.query);
      return reply.status(200).send(page);
    },
  );

  app.get(
    "/api/v1/admin/games/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: AdminGameDetailSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const detail = await deps.service.getGameDetail(req.params.id);
      return reply.status(200).send(detail);
    },
  );

  app.post(
    "/api/v1/admin/games/:id/cancel",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        // Body is optional — callers may send `{ reason: "..." }` or no body
        // at all. We parse defensively in the handler so missing Content-Type
        // never blows the request up with a 400.
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const parsed = AdminGameCancelRequest.safeParse(req.body ?? {});
      const body = parsed.success ? parsed.data : {};
      await deps.service.cancelGame(adminId, req.params.id, body);
      return reply.status(204).send({});
    },
  );

  app.patch(
    "/api/v1/admin/games/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: AdminGameUpdateRequest,
        response: {
          200: AdminGameDetailSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const updated = await deps.service.updateGame(adminId, req.params.id, req.body);
      return reply.status(200).send(updated);
    },
  );

  app.delete(
    "/api/v1/admin/games/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.softDeleteGame(adminId, req.params.id);
      return reply.status(204).send({});
    },
  );

  // --- venues ---

  app.post(
    "/api/v1/admin/venues",
    {
      preHandler: adminGuard,
      schema: {
        body: CreateVenueRequest,
        response: {
          201: AdminVenueSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const venue = await deps.service.createVenue(adminId, req.body);
      return reply.status(201).send(venue);
    },
  );

  app.patch(
    "/api/v1/admin/venues/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: UpdateVenueRequest,
        response: {
          200: AdminVenueSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const venue = await deps.service.updateVenue(adminId, req.params.id, req.body);
      return reply.status(200).send(venue);
    },
  );

  app.delete(
    "/api/v1/admin/venues/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.deleteVenue(adminId, req.params.id);
      return reply.status(204).send({});
    },
  );

  // --- venue courts (nested under venues) ---

  app.get(
    "/api/v1/admin/venues/:id/courts",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: AdminCourtsListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const items = await deps.service.listCourtsForVenue(req.params.id);
      return reply.status(200).send({ items });
    },
  );

  app.post(
    "/api/v1/admin/venues/:id/courts",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CreateCourtRequest,
        response: {
          201: AdminCourtSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const court = await deps.service.createCourt(adminId, req.params.id, req.body);
      return reply.status(201).send(court);
    },
  );

  app.patch(
    "/api/v1/admin/venues/:id/courts/:courtId",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({
          id: z.string().uuid(),
          courtId: z.string().uuid(),
        }),
        body: UpdateCourtRequest,
        response: {
          200: AdminCourtSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const court = await deps.service.updateCourt(
        adminId,
        req.params.id,
        req.params.courtId,
        req.body,
      );
      return reply.status(200).send(court);
    },
  );

  app.delete(
    "/api/v1/admin/venues/:id/courts/:courtId",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({
          id: z.string().uuid(),
          courtId: z.string().uuid(),
        }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.deleteCourt(adminId, req.params.id, req.params.courtId);
      return reply.status(204).send({});
    },
  );

  // --- tournaments ---

  app.get(
    "/api/v1/admin/tournaments",
    {
      preHandler: adminGuard,
      schema: {
        querystring: AdminTournamentsListQuery,
        response: {
          200: AdminTournamentsListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const page = await deps.service.listTournaments(req.query);
      return reply.status(200).send(page);
    },
  );

  app.post(
    "/api/v1/admin/tournaments",
    {
      preHandler: adminGuard,
      schema: {
        body: CreateTournamentRequest,
        response: {
          201: AdminTournamentSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const t = await deps.service.createTournament(adminId, req.body);
      return reply.status(201).send(t);
    },
  );

  app.patch(
    "/api/v1/admin/tournaments/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: UpdateTournamentRequest,
        response: {
          200: AdminTournamentSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const t = await deps.service.updateTournament(adminId, req.params.id, req.body);
      return reply.status(200).send(t);
    },
  );

  app.delete(
    "/api/v1/admin/tournaments/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.deleteTournament(adminId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.get(
    "/api/v1/admin/tournaments/:id/entries",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: AdminTournamentEntriesResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const items = await deps.service.listTournamentEntries(req.params.id);
      return reply.status(200).send({ items });
    },
  );

  app.delete(
    "/api/v1/admin/tournaments/:id/entries/:entryId",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({
          id: z.string().uuid(),
          entryId: z.string().uuid(),
        }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.removeTournamentEntry(
        adminId,
        req.params.id,
        req.params.entryId,
      );
      return reply.status(204).send({});
    },
  );

  // --- audit log ---

  app.get(
    "/api/v1/admin/audit",
    {
      preHandler: adminGuard,
      schema: {
        querystring: AuditListQuery,
        response: {
          200: AuditListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const items = await deps.service.listAudit(req.query);
      return reply.status(200).send({ items });
    },
  );

  // --- bookings ---

  app.get(
    "/api/v1/admin/bookings",
    {
      preHandler: adminGuard,
      schema: {
        querystring: AdminBookingsListQuery,
        response: {
          200: AdminBookingsListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const page = await deps.service.listBookings(req.query);
      return reply.status(200).send(page);
    },
  );

  app.post(
    "/api/v1/admin/bookings/:id/cancel",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.adminCancelBooking(adminId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/admin/bookings/:id/mark-paid",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.adminMarkBookingPaid(adminId, req.params.id);
      return reply.status(204).send({});
    },
  );
}
