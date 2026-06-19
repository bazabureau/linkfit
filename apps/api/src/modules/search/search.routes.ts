import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../../shared/auth/jwt.js";
import { SearchQuery, SearchResponse } from "./search.schema.js";
import { type SearchService } from "./search.service.js";

export interface SearchRouteDeps {
  service: SearchService;
  /**
   * JWT access-token secret used to soft-authenticate the caller. When
   * supplied we use it to detect a signed-in viewer and drop blocked users
   * from the player results (mirrors the pattern in `feed.routes.ts`).
   */
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

/**
 * Soft-auth extractor — mirrors `feed.routes.ts`. Returns the viewer's user
 * id when a valid bearer token is present, otherwise `null`. Missing /
 * malformed / expired tokens never fail the request: search is public, so
 * we silently degrade to anonymous instead of rejecting the call.
 */
function extractOptionalViewer(
  req: { headers: { authorization?: string | undefined } },
  secret: string,
): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) return null;
  try {
    return verifyAccessToken(token, secret).sub;
  } catch (err) {
    if (err instanceof InvalidAccessTokenError) return null;
    throw err;
  }
}

export function registerSearchRoutes(app: LinkfitServer, deps: SearchRouteDeps): void {
  // GET /api/v1/search?q=...&type=...&limit=...
  // Unified search across players, games, tournaments and venues. The
  // endpoint is intentionally public — discovery never requires an account
  // — but a signed-in viewer gets blocked users filtered out of the
  // `players` bucket so a previously-blocked profile can't reappear via
  // search.
  app.get(
    "/api/v1/search",
    {
      schema: {
        querystring: SearchQuery,
        response: { 200: SearchResponse, 400: ErrorEnvelope },
        tags: ["search"],
      },
    },
    async (req, reply) => {
      const viewerUserId = extractOptionalViewer(req, deps.jwtAccessSecret);
      const result = await deps.service.search(req.query, viewerUserId);
      return reply.status(200).send(result);
    },
  );
}
