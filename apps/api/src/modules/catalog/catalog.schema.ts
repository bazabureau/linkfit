import { z } from "zod";

export const SportSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  min_players: z.number().int().positive(),
  max_players: z.number().int().positive(),
});

export const CourtSchema = z.object({
  id: z.string().uuid(),
  venue_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  name: z.string(),
  hourly_price_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export const VenueSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  is_partner: z.boolean(),
  phone: z.string().nullable(),
  description: z.string().nullable(),
  photo_url: z.string().nullable(),
  /// Full set of gallery photos. The first element mirrors `photo_url`
  /// so existing single-image consumers stay correct.
  photo_urls: z.array(z.string()).default([]),
  rating_avg: z.number().nullable(),
  rating_count: z.number().int().nonnegative(),
  distance_km: z.number().nullable(),
});

export const VenueDetailSchema = VenueSchema.extend({
  courts: z.array(CourtSchema),
});

export const VenuesListQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().positive().max(200).optional(),
    sport: z.string().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .refine(
    (q) =>
      (q.lat === undefined && q.lng === undefined && q.radius_km === undefined) ||
      (q.lat !== undefined && q.lng !== undefined && q.radius_km !== undefined),
    { message: "lat, lng and radius_km must all be provided together" },
  );
export type VenuesListQuery = z.infer<typeof VenuesListQuery>;

export const VenuesListResponse = z.object({
  items: z.array(VenueSchema),
});

export const SportsListResponse = z.object({
  items: z.array(SportSchema),
});
