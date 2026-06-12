import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { type OgImageService } from "./og-image.service.js";

export interface OgImageRouteDeps {
  service: OgImageService;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const ParamsSchema = z.object({ id: z.string().uuid() });

/**
 * `image/png` responses bypass the JSON-Zod response schema (we hand back a
 * raw Buffer). The route response schema declares 404 only for the error
 * branch; the 200 success branch sets the Content-Type header manually.
 */
const PNG_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

export function registerOgImageRoutes(
  app: LinkfitServer,
  deps: OgImageRouteDeps,
): void {
  app.get(
    "/og/game/:id.png",
    {
      schema: {
        params: ParamsSchema,
        response: { 404: ErrorEnvelope },
        tags: ["og-image"],
      },
    },
    async (req, reply) => {
      const png = await deps.service.renderGame(req.params.id);
      // Cast through unknown — the route's response schema only declares
      // the 404 error shape, so the 2xx send type narrows to that envelope.
      // Binary PNG bypasses serialization; the cast restores reality.
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", PNG_CACHE_CONTROL);
      return reply.send(png as unknown as { error: never });
    },
  );

  app.get(
    "/og/user/:id.png",
    {
      schema: {
        params: ParamsSchema,
        response: { 404: ErrorEnvelope },
        tags: ["og-image"],
      },
    },
    async (req, reply) => {
      const png = await deps.service.renderUser(req.params.id);
      // Cast through unknown — the route's response schema only declares
      // the 404 error shape, so the 2xx send type narrows to that envelope.
      // Binary PNG bypasses serialization; the cast restores reality.
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", PNG_CACHE_CONTROL);
      return reply.send(png as unknown as { error: never });
    },
  );

  app.get(
    "/og/tournament/:id.png",
    {
      schema: {
        params: ParamsSchema,
        response: { 404: ErrorEnvelope },
        tags: ["og-image"],
      },
    },
    async (req, reply) => {
      const png = await deps.service.renderTournament(req.params.id);
      // Cast through unknown — the route's response schema only declares
      // the 404 error shape, so the 2xx send type narrows to that envelope.
      // Binary PNG bypasses serialization; the cast restores reality.
      reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", PNG_CACHE_CONTROL);
      return reply.send(png as unknown as { error: never });
    },
  );
}
