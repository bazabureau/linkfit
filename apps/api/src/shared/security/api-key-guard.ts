import { type FastifyReply, type FastifyRequest } from "fastify";
import { ForbiddenError } from "../errors/AppError.js";
import { apiKeyFingerprint, apiKeyMatches } from "./api-key-ring.js";

export interface ApiKeyGuardConfig {
  requireApiKey: boolean;
  plainKeys: readonly string[];
  keyHashes: readonly string[];
}

const EXEMPT_PREFIXES = [
  "/api/v1/webhooks/stripe",
  "/api/v1/membership-webhook",
  "/.well-known/apple-app-site-association",
  "/health",
  "/metrics",
  "/docs",
  "/documentation",
  "/uploads/",
];

export async function apiKeyGuard(
  req: FastifyRequest,
  _reply: FastifyReply,
  config: ApiKeyGuardConfig,
): Promise<void> {
  if (!config.requireApiKey || req.method === "OPTIONS" || isExemptPath(req.url)) {
    return;
  }

  const provided = headerValue(req.headers["x-linkfit-app-key"]);
  const fingerprint = apiKeyFingerprint(provided);
  if (!apiKeyMatches(provided, config.plainKeys, config.keyHashes)) {
    req.log.warn(
      {
        path: req.url,
        ip: req.ip,
        origin: req.headers.origin,
        app_key_fp: fingerprint,
        reason: provided === undefined || provided.trim() === "" ? "missing" : "invalid",
      },
      "public app API key rejected",
    );
    throw new ForbiddenError("Invalid or missing API key");
  }

  req.headers["x-linkfit-app-key-fp"] = fingerprint ?? undefined;
}

function isExemptPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
