import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../../shared/auth/jwt.js";
import {
  ConversationListResponse,
  ConversationThreadResponse,
  NotificationsListResponse,
  PlayersListQuery,
  PlayersListResponse,
  RankingsResponse,
  SendMessageRequest,
  StartConversationRequest,
  UploadImageResponse,
} from "./social.schema.js";
import { type NotificationsService } from "./notifications.service.js";
import { type MessagesService } from "./messages.service.js";
import { type SocialService } from "./social.service.js";
import { ValidationError } from "../../shared/errors/AppError.js";

/**
 * Best-effort viewer extraction for endpoints that personalize but do not
 * require auth (e.g., /players returns `is_followed_by_me`). Invalid tokens
 * yield `null` rather than 401 — the route still serves the public view.
 */
function extractOptionalViewer(req: { headers: { authorization?: string | undefined } }, secret: string): string | null {
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

export interface SocialRouteDeps {
  notifications: NotificationsService;
  messages: MessagesService;
  social: SocialService;
  jwtAccessSecret: string;
  /** Where uploaded message attachments are written. Served by
   *  `@fastify/static` at `/uploads/*`. */
  uploadDir: string;
  /** Public origin used when building absolute attachment URLs. When
   *  unset the route falls back to the request's reported origin —
   *  fine for local dev, not safe behind a proxy. */
  publicBaseUrl: string | undefined;
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

// Image + voice-message audio allowlist. Voice clips (.m4a / AAC) come
// from the iOS chat composer's hold-to-record path; the multipart field
// name on /messages/upload-image is the same ("file") and the backend
// persists the raw bytes either way. iOS sets attachment_type to "image"
// or "voice" when sending the subsequent /messages POST.
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/m4a",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MiB — covers a high-quality phone photo or a 60s voice clip.

function extForMime(mime: string, originalName: string | undefined): string {
  // Trust the file extension when present, otherwise map from MIME.
  const fromName = originalName ? extname(originalName).toLowerCase() : "";
  if (fromName && /^\.[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  switch (mime) {
    case "image/jpeg": return ".jpg";
    case "image/png":  return ".png";
    case "image/webp": return ".webp";
    case "image/gif":  return ".gif";
    default:           return ".bin";
  }
}

export function registerSocialRoutes(app: LinkfitServer, deps: SocialRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });
  // Fastify queues plugin registration; awaiting is optional. Doing it here
  // keeps the multipart concern local to the only module that needs it.
  void app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  });

  // ─── Notifications ─────────────────────────────────────────────────

  app.get(
    "/api/v1/notifications",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: NotificationsListResponse, 401: ErrorEnvelope },
        tags: ["notifications"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      return reply.status(200).send(await deps.notifications.list(userId));
    },
  );

  app.post(
    "/api/v1/notifications/:id/read",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: Empty, 401: ErrorEnvelope, 404: ErrorEnvelope },
        tags: ["notifications"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.notifications.markRead(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/notifications/read-all",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: z.object({ updated: z.number().int().nonnegative() }), 401: ErrorEnvelope },
        tags: ["notifications"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      return reply.status(200).send(await deps.notifications.markAllRead(userId));
    },
  );

  app.delete(
    "/api/v1/notifications/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: Empty, 401: ErrorEnvelope, 404: ErrorEnvelope },
        tags: ["notifications"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.notifications.deleteOne(req.params.id, userId);
      return reply.status(204).send({});
    },
  );

  app.delete(
    "/api/v1/notifications",
    {
      preHandler: authenticate,
      schema: {
        response: { 204: Empty, 401: ErrorEnvelope },
        tags: ["notifications"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.notifications.deleteAll(userId);
      return reply.status(204).send({});
    },
  );

  // ─── Messages ─────────────────────────────────────────────────────

  app.get(
    "/api/v1/conversations",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: ConversationListResponse, 401: ErrorEnvelope },
        tags: ["messages"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const items = await deps.messages.listConversations(userId);
      return reply.status(200).send({ items });
    },
  );

  app.post(
    "/api/v1/conversations",
    {
      preHandler: authenticate,
      schema: {
        body: StartConversationRequest,
        response: {
          200: z.object({ conversation_id: z.string().uuid() }),
          400: ErrorEnvelope, 401: ErrorEnvelope, 404: ErrorEnvelope,
        },
        tags: ["messages"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const id = await deps.messages.getOrCreateWith(userId, req.body.other_user_id);
      return reply.status(200).send({ conversation_id: id });
    },
  );

  app.get(
    "/api/v1/conversations/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: ConversationThreadResponse,
          401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope,
        },
        tags: ["messages"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      return reply.status(200).send(await deps.messages.getThread(userId, req.params.id));
    },
  );

  /**
   * DELETE /api/v1/conversations/:id
   *
   * Soft-leave the conversation from THE CALLER'S inbox. This is not a hard
   * delete of the thread — the other participant still sees their copy and
   * the message history is preserved. Mechanism: stamp `left_at = NOW()`
   * on the caller's `conversation_participants` row. The list endpoint
   * (GET /api/v1/conversations) filters `WHERE left_at IS NULL` so the
   * conversation drops out of this user's inbox.
   *
   * 204 on success, 403 if the caller is not an ACTIVE participant
   * (never joined, or already left).
   */
  app.delete(
    "/api/v1/conversations/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope,
        },
        tags: ["messages"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.messages.leave(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/conversations/:id/messages",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SendMessageRequest,
        response: {
          201: z.object({
            id: z.string().uuid(),
            conversation_id: z.string().uuid(),
            sender_user_id: z.string().uuid(),
            body: z.string(),
            attachment_url: z.string().nullable(),
            attachment_type: z.enum(["image", "voice"]).nullable(),
            created_at: z.string(),
          }),
          400: ErrorEnvelope, 401: ErrorEnvelope, 403: ErrorEnvelope,
        },
        tags: ["messages"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const msg = await deps.messages.send(userId, req.params.id, {
        body: req.body.body,
        attachment_url: req.body.attachment_url,
        attachment_type: req.body.attachment_type,
      });
      return reply.status(201).send(msg);
    },
  );

  app.post(
    "/api/v1/conversations/:id/read",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope,
        },
        tags: ["messages"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.messages.markRead(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/conversations/:id/typing",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ is_typing: z.boolean() }),
        response: {
          204: Empty,
          401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope,
        },
        tags: ["messages"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.messages.sendTypingStatus(userId, req.params.id, req.body.is_typing);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/messages/upload-image",
    {
      preHandler: authenticate,
      schema: {
        // Multipart body — Zod schema is not feasible; documented loosely.
        response: {
          200: UploadImageResponse,
          400: ErrorEnvelope, 401: ErrorEnvelope, 413: ErrorEnvelope,
        },
        tags: ["messages"],
        consumes: ["multipart/form-data"],
      },
    },
    async (req, reply) => {
      requireUserId(req);
      const file = await req.file();
      if (!file) {
        throw new ValidationError("No file uploaded — expected multipart field 'file'");
      }
      if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
        throw new ValidationError(`Unsupported image type: ${file.mimetype}`);
      }
      // Drain the stream BEFORE checking truncated — @fastify/multipart only
      // sets the flag once the body is consumed.
      const buf = await file.toBuffer();
      if (file.file.truncated) {
        return reply.status(413).send({
          error: { code: "VALIDATION_ERROR", message: "Image exceeds 8 MiB limit", request_id: req.id },
        });
      }
      await mkdir(deps.uploadDir, { recursive: true });
      const filename = `${randomUUID()}${extForMime(file.mimetype, file.filename)}`;
      const path = join(deps.uploadDir, filename);
      await writeFile(path, buf);

      // Build an absolute, HTTP-fetchable URL. @fastify/static serves
      // `deps.uploadDir` at `/uploads/*` — see server.ts. When the deploy
      // exposes a stable public origin we use it; otherwise fall back to
      // the inbound request's protocol+host (good enough for local dev).
      const origin = deps.publicBaseUrl ?? `${req.protocol}://${req.hostname}`;
      const url = `${origin.replace(/\/+$/, "")}/uploads/${filename}`;
      return reply.status(200).send({ url });
    },
  );

  // ─── Rankings ─────────────────────────────────────────────────────

  app.get(
    "/api/v1/rankings",
    {
      schema: {
        querystring: z.object({
          sport: z.string().default("padel"),
          limit: z.coerce.number().int().positive().max(100).optional(),
        }),
        response: { 200: RankingsResponse, 404: ErrorEnvelope },
        tags: ["rankings"],
      },
    },
    async (req, reply) => {
      return reply.status(200).send(
        await deps.social.rankings(req.query.sport, req.query.limit ?? 50),
      );
    },
  );

  // ─── Players ──────────────────────────────────────────────────────

  app.get(
    "/api/v1/players",
    {
      schema: {
        querystring: PlayersListQuery,
        response: { 200: PlayersListResponse, 400: ErrorEnvelope },
        tags: ["players"],
      },
    },
    async (req, reply) => {
      const viewerId = extractOptionalViewer(req, deps.jwtAccessSecret);
      const items = await deps.social.players(req.query, viewerId);
      return reply.status(200).send({ items });
    },
  );

  // ─── Tournaments ──────────────────────────────────────────────────
  // (moved to its own module — see src/modules/tournaments)
}
