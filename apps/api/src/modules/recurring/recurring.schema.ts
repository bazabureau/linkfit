import { z } from "zod";

/**
 * Schemas for the recurring game-series feature. Kept in its own module so
 * we don't have to extend the global `Database` Kysely type — the service
 * uses raw `sql` queries which work on `Executor` directly.
 */

export const SeriesStatusEnum = z.enum(["active", "cancelled"]);
export type SeriesStatus = z.infer<typeof SeriesStatusEnum>;

/** Postgres EXTRACT(DOW) convention: 0=Sunday … 6=Saturday. */
export const DayOfWeek = z.number().int().min(0).max(6);

/** HH:MM or HH:MM:SS — matches a Postgres TIME literal. */
const TimeOfDay = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);

export const CreateSeriesRequest = z.object({
  sport_id:         z.string().uuid(),
  court_id:         z.string().uuid().nullable().optional(),
  lat:              z.number().min(-90).max(90),
  lng:              z.number().min(-180).max(180),
  day_of_week:      DayOfWeek,
  time_of_day:      TimeOfDay,
  duration_minutes: z.number().int().min(15).max(480),
  capacity:         z.number().int().min(2).max(40),
  occurrences:      z.number().int().min(1).max(12),
  // Optional explicit anchor; defaults to "today" on the server. The first
  // materialized game is the first day_of_week occurrence at-or-after this.
  starts_on:        z.string().date().optional(),
  notes:            z.string().max(500).nullable().optional(),
});
export type CreateSeriesRequest = z.infer<typeof CreateSeriesRequest>;

export const SeriesGameSummary = z.object({
  id:                z.string().uuid(),
  occurrence_number: z.number().int().positive(),
  starts_at:         z.string(),
  status:            z.enum(["open", "full", "cancelled", "completed"]),
  participants_count: z.number().int().nonnegative(),
  capacity:          z.number().int().positive(),
});

export const SeriesDetailSchema = z.object({
  id:               z.string().uuid(),
  host_user_id:     z.string().uuid(),
  sport_id:         z.string().uuid(),
  sport_slug:       z.string(),
  court_id:         z.string().uuid().nullable(),
  venue_name:       z.string().nullable(),
  lat:              z.number(),
  lng:              z.number(),
  day_of_week:      z.number().int().min(0).max(6),
  time_of_day:      z.string(),
  duration_minutes: z.number().int().positive(),
  capacity:         z.number().int().positive(),
  occurrences:      z.number().int().positive(),
  starts_on:        z.string(),
  ends_on:          z.string(),
  status:           SeriesStatusEnum,
  notes:            z.string().nullable(),
  created_at:       z.string(),
  games:            z.array(SeriesGameSummary),
});

export const CancelSeriesRequest = z.object({
  /** 1-indexed occurrence — cancel this slot AND every later one. */
  from_occurrence: z.number().int().min(1).max(52),
});
export type CancelSeriesRequest = z.infer<typeof CancelSeriesRequest>;

export const CancelSeriesResponse = z.object({
  cancelled_count: z.number().int().nonnegative(),
});
