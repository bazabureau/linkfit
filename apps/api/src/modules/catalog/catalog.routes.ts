import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import {
  SportsListResponse,
  VenueDetailSchema,
  VenuesListQuery,
  VenuesListResponse,
} from "./catalog.schema.js";
import { type CatalogService } from "./catalog.service.js";

export interface CatalogRouteDeps {
  service: CatalogService;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export function registerCatalogRoutes(app: LinkfitServer, deps: CatalogRouteDeps): void {
  app.get(
    "/api/v1/sports",
    { schema: { response: { 200: SportsListResponse }, tags: ["catalog"] } },
    async (_req, reply) => {
      const items = await deps.service.listSports();
      return reply.status(200).send({ items });
    },
  );

  app.get(
    "/api/v1/venues",
    {
      schema: {
        querystring: VenuesListQuery,
        response: { 200: VenuesListResponse, 400: ErrorEnvelope },
        tags: ["catalog"],
      },
    },
    async (req, reply) => {
      const items = await deps.service.listVenues(req.query);
      return reply.status(200).send({ items });
    },
  );

  app.get(
    "/api/v1/venues/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: VenueDetailSchema, 404: ErrorEnvelope },
        tags: ["catalog"],
      },
    },
    async (req, reply) => {
      const venue = await deps.service.getVenue(req.params.id);
      return reply.status(200).send(venue);
    },
  );
}
