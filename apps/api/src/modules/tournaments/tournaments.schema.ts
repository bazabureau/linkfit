import { z } from "zod";

// ─── Status enum ──────────────────────────────────────────────────────

export const TournamentStatusEnum = z.enum([
  "announced",
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "cancelled",
]);

export const TournamentEntryStatusEnum = z.enum([
  "pending",
  "confirmed",
  "withdrawn",
  "disqualified",
]);

// ─── Summary (list rows) ──────────────────────────────────────────────

export const TournamentSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  venue_id: z.string().uuid().nullable(),
  venue_name: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  registration_deadline: z.string().nullable(),
  max_squads: z.number().int().positive(),
  squad_size: z.number().int().positive(),
  entry_fee_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: TournamentStatusEnum,
  entries_count: z.number().int().nonnegative(),
});

export const TournamentsListResponse = z.object({
  items: z.array(TournamentSummarySchema),
});

export const TournamentsListQuery = z.object({
  status: TournamentStatusEnum.optional(),
  sport: z.string().min(1).max(40).optional(),
  // Logical filter buckets the iOS app uses ("upcoming|live|past") to map
  // multiple raw statuses behind a single chip. Coexists with `status`.
  bucket: z.enum(["upcoming", "live", "past"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().max(10_000).optional(),
});
export type TournamentsListQuery = z.infer<typeof TournamentsListQuery>;

// ─── "My tournaments" query ───────────────────────────────────────────

export const MyTournamentsQuery = z.object({
  // Same buckets as the public list endpoint. Default behavior (no bucket)
  // returns every tournament the caller has an active entry in.
  bucket: z.enum(["upcoming", "live", "past"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().max(10_000).optional(),
});
export type MyTournamentsQuery = z.infer<typeof MyTournamentsQuery>;

// ─── Entry payload ────────────────────────────────────────────────────

export const TournamentEntrySchema = z.object({
  id: z.string().uuid(),
  tournament_id: z.string().uuid(),
  captain_user_id: z.string().uuid(),
  captain_display_name: z.string(),
  captain_photo_url: z.string().nullable(),
  squad_name: z.string(),
  player_ids: z.array(z.string().uuid()),
  player_names: z.array(z.string()),
  status: TournamentEntryStatusEnum,
  created_at: z.string(),
});

// ─── Detail ───────────────────────────────────────────────────────────

export const TournamentDetailSchema = TournamentSummarySchema.extend({
  entries: z.array(TournamentEntrySchema),
  my_entry: TournamentEntrySchema.nullable(),
  can_register: z.boolean(),
  registration_blocked_reason: z.string().nullable(),
});

// ─── Mutation bodies ──────────────────────────────────────────────────

export const RegisterSquadRequest = z.object({
  squad_name: z.string().min(2).max(80),
  player_ids: z.array(z.string().uuid()).max(19), // captain not included
});
export type RegisterSquadRequest = z.infer<typeof RegisterSquadRequest>;
