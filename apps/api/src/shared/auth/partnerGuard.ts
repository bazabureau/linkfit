import { type FastifyReply, type FastifyRequest } from "fastify";
import { type DbHandle } from "../db/pool.js";
import { ForbiddenError, UnauthenticatedError } from "../errors/AppError.js";
import { buildAuthGuard } from "./guard.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Stashed by `partnerGuard` once the request passes.
     * Regular partners will have their assigned venue UUID.
     * Global admins accessing B2B endpoints will have `undefined` and can specify the venue_id dynamically.
     */
    partnerVenueId?: string;
  }
}

export interface PartnerGuardDeps {
  jwtAccessSecret: string;
  db: DbHandle;
}

/**
 * Fastify preHandler guard that ensures a user is authenticated,
 * active, and is either a global admin or an operator assigned to a venue.
 */
export function buildPartnerGuard(deps: PartnerGuardDeps) {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  return async function partnerGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticate(req, reply);
    if (!req.authUserId) {
      throw new UnauthenticatedError("Authentication required");
    }

    const row = await deps.db.db
      .selectFrom("users")
      .select(["id", "admin_role", "venue_id", "deleted_at"])
      .where("id", "=", req.authUserId)
      .executeTakeFirst();

    if (row?.deleted_at !== null) {
      throw new UnauthenticatedError("Account no longer active");
    }

    // Must be either a global admin or have a venue_id association
    if (row.admin_role !== "admin" && !row.venue_id) {
      throw new ForbiddenError("Partner access required");
    }

    if (row.venue_id !== null) {
      req.partnerVenueId = row.venue_id;
    }
  };
}

/**
 * Resolves the venue ID for partner operations.
 * If regular partner, returns their stashed venue ID.
 * If global admin, supports reading venue_id from query/body.
 */
export function requirePartnerVenueId(req: FastifyRequest): string {
  if (!req.partnerVenueId) {
    // Admins can pass a custom venue_id via query or body to impersonate any partner.
    const query = req.query as Record<string, unknown> | null | undefined;
    const body = req.body as Record<string, unknown> | null | undefined;
    const queryVenueId = query?.venue_id ?? body?.venue_id;
    if (queryVenueId && typeof queryVenueId === "string") {
      return queryVenueId;
    }
    throw new ForbiddenError("Partner venue association required");
  }
  return req.partnerVenueId;
}
