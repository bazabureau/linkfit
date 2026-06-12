import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { ValidationError } from "../../shared/errors/AppError.js";
import { type StoriesService } from "./stories.service.js";
import {
  CreatedStorySchema,
  CreateStoryBody,
  Empty,
  ErrorEnvelope,
  StoriesFeedResponse,
  StoryReactBody,
  StoryReactionStateResponse,
  StoryReplyBody,
  StoryReplyResponse,
  StoryViewersResponse,
  UploadStoryImageResponse,
} from "./stories.schema.js";

export interface StoriesRouteDeps {
  service: StoriesService;
  jwtAccessSecret: string;
  /** Where uploaded story media is written. Served by `@fastify/static`
   *  at `/uploads/*` from the server bootstrap. */
  uploadDir: string;
  /** Public origin used when building absolute media URLs. When unset
   *  the route falls back to the request's reported origin — fine for
   *  local dev, not safe behind a proxy. Mirrors the social module. */
  publicBaseUrl: string | undefined;
}

// Image MIME allowlist mirrors the messages/upload-image surface so the
// iOS composer's existing pre-upload checks Just Work for stories too.
// Stories v1 accepts images only; video uploads will land in a follow-up.
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MiB — matches messages/upload-image.

function extForMime(mime: string, originalName: string | undefined): string {
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

/**
 * Mounts the `/api/v1/stories*` surface. Stories are Instagram-style
 * 24-hour ephemeral posts surfaced on the iOS home page.
 *
 * Endpoints:
 *   POST   /api/v1/stories                     — create a story
 *   POST   /api/v1/stories/upload-image        — multipart bytes -> URL
 *   GET    /api/v1/stories/feed                — bucketed feed for viewer
 *   POST   /api/v1/stories/:id/view            — record a view (204, idempotent)
 *   GET    /api/v1/stories/:id/viewers         — author-only viewer list
 *   POST   /api/v1/stories/:id/react           — upsert caller's reaction
 *   DELETE /api/v1/stories/:id/react           — remove caller's reaction
 *   DELETE /api/v1/stories/:id                 — author-only delete
 *
 * `@fastify/multipart` is registered globally by the social module before
 * stories, so `req.file()` is available here without a second registration
 * (the plugin's `fileSize` limit covers both surfaces — both cap at 8 MiB).
 */
export function registerStoriesRoutes(app: LinkfitServer, deps: StoriesRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // ─── Create a story ──────────────────────────────────────────────────
  // Wave-12 extends the body with optional `overlays` (text/sticker
  // entries persisted into `stories.overlays` JSONB) and `mentions`
  // (`{user_id, x, y}` triples that the service normalizes into
  // `story_mentions` after a bidirectional `user_blocks` filter, then
  // pushes a `story.mention` notification to each surviving target).
  // Both fields are wire-optional; pre-Wave-12 clients keep working
  // unchanged.
  app.post(
    "/api/v1/stories",
    {
      preHandler: authenticate,
      schema: {
        body: CreateStoryBody,
        response: {
          201: CreatedStorySchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const story = await deps.service.create(userId, req.body);
      return reply.status(201).send(story);
    },
  );

  // ─── Upload media (multipart) ────────────────────────────────────────
  // Parallel to /messages/upload-image so the stories module stays
  // self-contained. Bytes land in `${uploadDir}/stories/<uuid><ext>` and
  // are exposed via the same `@fastify/static` mount at `/uploads/*`.
  app.post(
    "/api/v1/stories/upload-image",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: UploadStoryImageResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          413: ErrorEnvelope,
        },
        tags: ["stories"],
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
      // Drain the stream BEFORE inspecting truncated — @fastify/multipart
      // only flips the flag once the body is fully consumed.
      const buf = await file.toBuffer();
      if (file.file.truncated || buf.byteLength > MAX_IMAGE_BYTES) {
        return reply.status(413).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Image exceeds 8 MiB limit",
            request_id: req.id,
          },
        });
      }
      const storiesDir = join(deps.uploadDir, "stories");
      await mkdir(storiesDir, { recursive: true });
      const filename = `${randomUUID()}${extForMime(file.mimetype, file.filename)}`;
      const path = join(storiesDir, filename);
      await writeFile(path, buf);

      const origin = deps.publicBaseUrl ?? `${req.protocol}://${req.hostname}`;
      const url = `${origin.replace(/\/+$/, "")}/uploads/stories/${filename}`;
      return reply.status(200).send({ url });
    },
  );

  // ─── Feed (bucketed by author) ───────────────────────────────────────
  app.get(
    "/api/v1/stories/feed",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: StoriesFeedResponse,
          401: ErrorEnvelope,
        },
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const viewerId = requireUserId(req);
      const feed = await deps.service.feedForViewer(viewerId);
      return reply.status(200).send(feed);
    },
  );

  // ─── Mark a story as viewed (idempotent) ─────────────────────────────
  app.post(
    "/api/v1/stories/:id/view",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const viewerId = requireUserId(req);
      await deps.service.markViewed(req.params.id, viewerId);
      return reply.status(204).send({});
    },
  );

  // ─── Viewer list (author-only) ───────────────────────────────────────
  app.get(
    "/api/v1/stories/:id/viewers",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: StoryViewersResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.listViewers(req.params.id, userId);
      return reply.status(200).send(payload);
    },
  );

  // ─── Add / replace caller's reaction ─────────────────────────────────
  // Idempotent upsert keyed on (story_id, caller). A POST with a different
  // emoji from the same user REPLACES the prior one (one reaction per
  // user per story). The response carries the fresh aggregate counts
  // plus the caller's own `my_reaction` so the iOS bar updates without
  // a refetch.
  app.post(
    "/api/v1/stories/:storyId/react",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ storyId: z.string().uuid() }),
        body: StoryReactBody,
        response: {
          200: StoryReactionStateResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const state = await deps.service.react(
        req.params.storyId,
        userId,
        req.body.emoji,
      );
      return reply.status(200).send(state);
    },
  );

  // ─── Remove caller's reaction ────────────────────────────────────────
  // Idempotent. Deleting when no reaction is set is a no-op (still 200
  // with the current state). `my_reaction` in the response is always
  // null after a successful DELETE — the wire schema covers it as
  // nullable so no extra narrowing is needed on the client.
  app.delete(
    "/api/v1/stories/:storyId/react",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ storyId: z.string().uuid() }),
        response: {
          200: StoryReactionStateResponse,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const state = await deps.service.unreact(req.params.storyId, userId);
      return reply.status(200).send(state);
    },
  );

  // ─── Reply to a story (Wave-13) ──────────────────────────────────────
  // Instagram-style "reply to story" — the viewer types a freeform body
  // which the server fans out as a 1-to-1 DM to the story author, with
  // a "↩ Story reply: " sentinel prefix preserving story context in the
  // persisted message. Reuses the existing MessagesService.send() pipe
  // for the push + SSE fan-out, so the author gets the same banner +
  // live-thread update they'd see for a manual DM.
  //
  // Returns `(conversation_id, message_id)` so the iOS client can
  // deep-link straight into the resulting thread on success.
  //
  // Errors:
  //   400 — empty body / author replying to own story
  //   404 — story expired, never existed, OR viewer blocked by author
  //         (block target stays opaque vs. 403)
  app.post(
    "/api/v1/stories/:id/reply",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: StoryReplyBody,
        response: {
          200: StoryReplyResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const viewerId = requireUserId(req);
      const result = await deps.service.replyToStory(
        req.params.id,
        viewerId,
        req.body.body,
      );
      return reply.status(200).send(result);
    },
  );

  // ─── Delete (author-only) ────────────────────────────────────────────
  app.delete(
    "/api/v1/stories/:id",
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
        tags: ["stories"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.remove(req.params.id, userId);
      return reply.status(204).send({});
    },
  );
}
