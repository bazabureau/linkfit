import { z } from "zod";
import { GameStatusEnum, GameVisibilityEnum } from "../games/games.schema.js";

/** Server-side enum mirroring the `game_invitation_status` Postgres type. */
export const InvitationStatusEnum = z.enum([
  "pending",
  "accepted",
  "declined",
  "expired",
]);

/**
 * Lightweight game preview embedded in each invitation row. Mirrors the
 * subset of `GameSummary` an invitee actually needs to make an accept/decline
 * decision — sport, when, where, capacity. Kept narrow on purpose so the list
 * endpoint stays cheap.
 */
export const InvitationGamePreviewSchema = z.object({
  id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  host_user_id: z.string().uuid(),
  host_display_name: z.string(),
  court_id: z.string().uuid().nullable(),
  venue_name: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  starts_at: z.string(),
  duration_minutes: z.number().int().positive(),
  capacity: z.number().int().positive(),
  participants_count: z.number().int().nonnegative(),
  status: GameStatusEnum,
  visibility: GameVisibilityEnum,
});
export type InvitationGamePreview = z.infer<typeof InvitationGamePreviewSchema>;

export const InvitationSchema = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid(),
  inviter_user_id: z.string().uuid(),
  inviter_display_name: z.string(),
  inviter_photo_url: z.string().nullable(),
  invitee_user_id: z.string().uuid(),
  status: InvitationStatusEnum,
  created_at: z.string(),
  responded_at: z.string().nullable(),
  game: InvitationGamePreviewSchema,
});
export type InvitationOut = z.infer<typeof InvitationSchema>;

export const CreateInvitationRequest = z.object({
  invitee_user_id: z.string().uuid(),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

/**
 * Batch-invite payload — used by the post-create-game "send invites to
 * followers" sheet on iOS. Keeps a 1-call shape so the client doesn't have
 * to fan out N POSTs and reconcile partial failures itself; the server
 * returns counts (`sent` = newly-created invites, `blocked` = already-in /
 * duplicate / self / closed-game, summed across the batch).
 */
export const BatchInviteRequest = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(50),
});
export type BatchInviteRequest = z.infer<typeof BatchInviteRequest>;

export const BatchInviteResponse = z.object({
  sent: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type BatchInviteResponse = z.infer<typeof BatchInviteResponse>;

export const InvitationsListQuery = z.object({
  status: InvitationStatusEnum.optional(),
});
export type InvitationsListQuery = z.infer<typeof InvitationsListQuery>;

export const InvitationsListResponse = z.object({
  items: z.array(InvitationSchema),
});

/**
 * Response from POST /invitations/:id/accept. Reports the game the user is
 * now in so the client can navigate or refresh without an extra round-trip.
 */
export const AcceptInvitationResponse = z.object({
  invitation: InvitationSchema,
  game_id: z.string().uuid(),
});

export const DeclineInvitationResponse = z.object({
  invitation: InvitationSchema,
});
