import { z } from "zod";

export const ParticipantStatusEnum = z.enum(["confirmed", "cancelled", "no_show", "played"]);
export const GameStatusEnum = z.enum(["open", "full", "cancelled", "completed"]);
export const GameVisibilityEnum = z.enum(["public", "invite"]);

export const ParticipantSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  status: ParticipantStatusEnum,
  joined_at: z.string(),
});

export const GameSummarySchema = z.object({
  id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  host_user_id: z.string().uuid(),
  host_display_name: z.string(),
  court_id: z.string().uuid().nullable(),
  venue_name: z.string().nullable(),
  venue_photo_url: z.string().nullable().optional(),
  lat: z.number(),
  lng: z.number(),
  starts_at: z.string(),
  duration_minutes: z.number().int().positive(),
  capacity: z.number().int().positive(),
  participants_count: z.number().int().nonnegative(),
  status: GameStatusEnum,
  visibility: GameVisibilityEnum,
  skill_min_elo: z.number().int().nullable(),
  skill_max_elo: z.number().int().nullable(),
  distance_km: z.number().nullable(),
});

export const GameDetailSchema = GameSummarySchema.extend({
  notes: z.string().nullable(),
  participants: z.array(ParticipantSchema),
  created_at: z.string(),
});

export const GamesListQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().positive().max(200).optional(),
    sport: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
  })
  .refine(
    (q) =>
      (q.lat === undefined && q.lng === undefined && q.radius_km === undefined) ||
      (q.lat !== undefined && q.lng !== undefined && q.radius_km !== undefined),
    { message: "lat, lng and radius_km must all be provided together" },
  );
export type GamesListQuery = z.infer<typeof GamesListQuery>;

export const GamesListResponse = z.object({
  items: z.array(GameSummarySchema),
  next_cursor: z.string().nullable(),
});

export const CreateGameRequest = z.object({
  sport_id: z.string().uuid(),
  court_id: z.string().uuid().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  starts_at: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(480),
  capacity: z.number().int().min(2).max(40).optional(),
  skill_min_elo: z.number().int().min(0).max(4000).nullable().optional(),
  skill_max_elo: z.number().int().min(0).max(4000).nullable().optional(),
  visibility: GameVisibilityEnum.optional(),
  notes: z.string().max(500).nullable().optional(),
  /**
   * Optional client-minted UUID, reused on retry. When a game with the same
   * key already exists for the same host, the create endpoint replays the
   * existing game instead of minting a duplicate — mirrors the bookings
   * idempotency contract. Omit it and every POST creates a fresh game.
   */
  idempotency_key: z.string().uuid().optional(),
});
export type CreateGameRequest = z.infer<typeof CreateGameRequest>;

export const UpdateGameRequest = z
  .object({
    starts_at: z.string().datetime().optional(),
    duration_minutes: z.number().int().min(15).max(480).optional(),
    skill_min_elo: z.number().int().min(0).max(4000).nullable().optional(),
    skill_max_elo: z.number().int().min(0).max(4000).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    cancel: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateGameRequest = z.infer<typeof UpdateGameRequest>;

/**
 * Wave-10 dedicated cancel endpoint. Host posts to
 * `POST /api/v1/games/:id/cancel` with an optional free-text reason. The
 * reason is forwarded into the participant push notifications so people
 * waiting on the game can see WHY it died ("rain", "court double-booked",
 * etc.) without having to chase the host on chat.
 *
 * Distinct from `UpdateGameRequest.cancel` — that path stays for backward
 * compatibility with the existing iOS PATCH-with-`cancel:true` shortcut.
 * New clients should hit the dedicated endpoint so the reason is captured.
 */
export const CancelGameRequest = z.object({
  reason: z.string().max(280).optional(),
});
export type CancelGameRequest = z.infer<typeof CancelGameRequest>;

/**
 * Wave-10 dedicated reschedule endpoint. Host PATCHes
 * `/api/v1/games/:id/reschedule` with a new `starts_at` and optional
 * `duration_minutes`. Returns the refreshed game detail so the client
 * can re-render in one round-trip. Validates that the new time is in
 * the future and that the game hasn't already started — moving an
 * already-played game forward in time would corrupt ratings + bookings.
 */
export const RescheduleGameRequest = z.object({
  starts_at: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(480).optional(),
});
export type RescheduleGameRequest = z.infer<typeof RescheduleGameRequest>;
