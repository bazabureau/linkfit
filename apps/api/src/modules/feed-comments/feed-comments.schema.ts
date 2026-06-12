import { z } from "zod";

/**
 * Wire-shape contracts for the feed comments module.
 *
 * The body cap mirrors the DB CHECK constraint (1..500 chars). The min-1 +
 * trim semantics live in the parser — an empty / whitespace-only body
 * returns 400 here before it can hit the DB.
 *
 * `next_cursor` is opaque base64url-encoded JSON. The iOS client treats it
 * as a blob — just pass the value verbatim back as `?cursor=…` on the next
 * page request. `total` is the all-time comment count for the event, so iOS
 * can show "127 comments" on the feed card without paging through every
 * page just to count.
 */

// Standard error envelope shape used across the API.
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export const CommentBodySchema = z.string().trim().min(1).max(500);

export const PostCommentBodySchema = z.object({
  body: CommentBodySchema,
});

export const CommentOutSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  user_display_name: z.string(),
  user_avatar_url: z.string().nullable(),
  body: z.string(),
  created_at: z.string(),
});

export const CommentsPageSchema = z.object({
  comments: z.array(CommentOutSchema),
  next_cursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export const CommentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const EventIdParamSchema = z.object({
  eventId: z.string().uuid(),
});

export const CommentIdParamSchema = z.object({
  commentId: z.string().uuid(),
});

export type CommentOut = z.infer<typeof CommentOutSchema>;
export type CommentsPage = z.infer<typeof CommentsPageSchema>;
