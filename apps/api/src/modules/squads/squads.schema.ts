import { z } from "zod";

/**
 * Zod schemas for the squads module surface.
 *
 * Pricing-style nullability: response shapes use `.nullable()` (the
 * column may be NULL) while request shapes use `.nullable().optional()`
 * so callers can either omit the key or explicitly send `null` to
 * clear it. The split matches the convention used by `games.schema.ts`.
 */

export const SquadMemberRoleEnum = z.enum(["owner", "member"]);
export const SquadMemberStatusEnum = z.enum(["pending", "active"]);

export const SquadMemberSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  role: SquadMemberRoleEnum,
  status: SquadMemberStatusEnum,
  joined_at: z.string(),
});
export type SquadMemberOut = z.infer<typeof SquadMemberSchema>;

export const SquadSummarySchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  photo_url: z.string().nullable(),
  max_size: z.number().int().min(2).max(16),
  member_count: z.number().int().nonnegative(),
  created_at: z.string(),
});
export type SquadSummary = z.infer<typeof SquadSummarySchema>;

/** Detailed view with members list. Returned by GET /:id and any write op. */
export const SquadDetailSchema = SquadSummarySchema.extend({
  members: z.array(SquadMemberSchema),
});
export type SquadDetail = z.infer<typeof SquadDetailSchema>;

export const MeSquadsResponse = z.object({
  squads: z.array(SquadSummarySchema),
});

export const CreateSquadRequest = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(500).nullable().optional(),
  photo_url: z.string().url().max(2000).nullable().optional(),
  max_size: z.number().int().min(2).max(16),
});
export type CreateSquadRequest = z.infer<typeof CreateSquadRequest>;

export const UpdateSquadRequest = z
  .object({
    name: z.string().min(2).max(50).optional(),
    description: z.string().max(500).nullable().optional(),
    photo_url: z.string().url().max(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateSquadRequest = z.infer<typeof UpdateSquadRequest>;

export const InviteSquadRequest = z.object({
  user_id: z.string().uuid(),
});
export type InviteSquadRequest = z.infer<typeof InviteSquadRequest>;

/** Querystring for GET /:id/games — optional ISO-8601 `since` cutoff. */
export const SquadGamesQuery = z.object({
  since: z.string().datetime().optional(),
});
export type SquadGamesQuery = z.infer<typeof SquadGamesQuery>;

/**
 * Game item returned by /squads/:id/games. Keeps the wire shape narrow:
 * iOS only needs enough to render a card and deep-link into the game
 * detail. We include `squad_members_attending` so the UI can render
 * the "3 / 4 attending" pill without a follow-up query.
 */
export const SquadGameItemSchema = z.object({
  id: z.string().uuid(),
  sport_slug: z.string(),
  host_user_id: z.string().uuid(),
  host_display_name: z.string(),
  venue_name: z.string().nullable(),
  starts_at: z.string(),
  duration_minutes: z.number().int().positive(),
  status: z.enum(["open", "full", "cancelled", "completed"]),
  squad_members_attending: z.number().int().nonnegative(),
});
export type SquadGameItem = z.infer<typeof SquadGameItemSchema>;

export const SquadGamesResponse = z.object({
  games: z.array(SquadGameItemSchema),
});
