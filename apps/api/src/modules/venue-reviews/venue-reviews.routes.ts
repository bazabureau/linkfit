import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type VenueReviewsService } from "./venue-reviews.service.js";
import {
  Empty,
  ErrorEnvelope,
  UpsertVenueReviewBody,
  VenueRatingSummarySchema,
  VenueReviewSchema,
  VenueReviewsListQuery,
  VenueReviewsPageSchema,
} from "./venue-reviews.schema.js";

export interface VenueReviewsRouteDeps {
  service: VenueReviewsService;
  jwtAccessSecret: string;
}

export function registerVenueReviewsRoutes(
  app: LinkfitServer,
  deps: VenueReviewsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // ─── Create / update a review (UPSERT) ────────────────────────────
  app.post(
    "/api/v1/venues/:id/reviews",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: UpsertVenueReviewBody,
        response: {
          201: VenueReviewSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["venue-reviews"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const review = await deps.service.upsert(req.params.id, userId, req.body);
      return reply.status(201).send(review);
    },
  );

  // ─── List reviews for a venue ─────────────────────────────────────
  app.get(
    "/api/v1/venues/:id/reviews",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: VenueReviewsListQuery,
        response: {
          200: VenueReviewsPageSchema,
          400: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["venue-reviews"],
      },
    },
    async (req, reply) => {
      const page = await deps.service.list(req.params.id, {
        limit: req.query.limit,
        cursor: req.query.cursor,
        sort: req.query.sort,
      });
      return reply.status(200).send(page);
    },
  );

  // ─── Aggregate summary (avg, count, histogram) ────────────────────
  app.get(
    "/api/v1/venues/:id/rating-summary",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: VenueRatingSummarySchema,
          404: ErrorEnvelope,
        },
        tags: ["venue-reviews"],
      },
    },
    async (req, reply) => {
      const summary = await deps.service.summary(req.params.id);
      return reply.status(200).send(summary);
    },
  );

  // ─── Author-only delete ───────────────────────────────────────────
  app.delete(
    "/api/v1/reviews/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["venue-reviews"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.remove(req.params.id, userId);
      return reply.status(204).send({});
    },
  );
}
