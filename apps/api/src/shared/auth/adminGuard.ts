import { type FastifyReply, type FastifyRequest } from "fastify";
import { type DbHandle } from "../db/pool.js";
import { type AdminRole } from "../db/types.js";
import { ForbiddenError, UnauthenticatedError } from "../errors/AppError.js";
import { buildAuthGuard } from "./guard.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Set by `adminGuard` once a request has cleared both authentication and
     * staff-role checks. Routes can read this to differentiate admin vs.
     * moderator-level capabilities.
     */
    adminRole?: AdminRole;
  }
}

export interface AdminGuardDeps {
  jwtAccessSecret: string;
  db: DbHandle;
}

/**
 * Fastify preHandler factory layered on top of `authenticate`. After the JWT
 * check it loads the user, asserts `admin_role` is one of the allowed values,
 * and stashes the role on the request for fine-grained checks downstream.
 *
 * Unlike the regular auth guard we DO hit the DB on every admin request —
 * the safety win (role revocation taking effect immediately, not after the
 * next token refresh) is worth the extra round-trip on the very low-traffic
 * admin surface.
 */
export function buildAdminGuard(deps: AdminGuardDeps) {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  return async function adminGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticate(req, reply);
    if (!req.authUserId) {
      throw new UnauthenticatedError("Authentication required");
    }

    const row = await deps.db.db
      .selectFrom("users")
      .select(["id", "admin_role", "deleted_at"])
      .where("id", "=", req.authUserId)
      .executeTakeFirst();

    if (row?.deleted_at !== null) {
      throw new UnauthenticatedError("Account no longer active");
    }
    const role = row.admin_role;
    if (role !== "admin" && role !== "moderator") {
      throw new ForbiddenError("Admin access required");
    }
    req.adminRole = role;
  };
}

export function requireAdminRole(req: FastifyRequest): AdminRole {
  if (!req.adminRole) {
    throw new ForbiddenError("Admin access required");
  }
  return req.adminRole;
}
