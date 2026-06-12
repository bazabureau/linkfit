import { z } from "zod";

/**
 * Shared Zod schemas for the venue-reviews routes. Kept in a dedicated file
 * so the route module stays focused on plumbing — and so the shapes can
 * land 1:1 in the OpenAPI spec via fastify-type-provider-zod.
 */

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export const Empty = z.object({}).strict();

/** Review author projection embedded inside list rows. */
export const ReviewAuthorSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
});

export const VenueReviewSchema = z.object({
  id: z.string().uuid(),
  venue_id: z.string().uuid(),
  author: ReviewAuthorSchema,
  rating: z.number().int().min(1).max(5),
  body: z.string().nullable(),
  photo_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const VenueReviewsPageSchema = z.object({
  items: z.array(VenueReviewSchema),
  next_cursor: z.string().nullable(),
});

export const VenueReviewsListQuery = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  cursor: z.string().optional(),
  /**
   * Sort order. `recent` = newest first (default — feels right for an
   * activity surface). `highest` = highest stars first, tie-broken by most
   * recent so two 5-star reviews don't shuffle on each page.
   */
  sort: z.enum(["recent", "highest"]).optional(),
});

export const UpsertVenueReviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(2_000).optional(),
  photo_url: z.string().url().max(2_048).optional(),
});

/** Histogram returned by the rating-summary endpoint — keyed 1..5. */
export const RatingHistogramSchema = z.object({
  "1": z.number().int().nonnegative(),
  "2": z.number().int().nonnegative(),
  "3": z.number().int().nonnegative(),
  "4": z.number().int().nonnegative(),
  "5": z.number().int().nonnegative(),
});

export const VenueRatingSummarySchema = z.object({
  venue_id: z.string().uuid(),
  avg_rating: z.number().nullable(),
  review_count: z.number().int().nonnegative(),
  histogram: RatingHistogramSchema,
});

export type VenueReview = z.infer<typeof VenueReviewSchema>;
export type VenueReviewsPage = z.infer<typeof VenueReviewsPageSchema>;
export type UpsertVenueReviewInput = z.infer<typeof UpsertVenueReviewBody>;
export type VenueRatingSummary = z.infer<typeof VenueRatingSummarySchema>;
export type ReviewSort = "recent" | "highest";
