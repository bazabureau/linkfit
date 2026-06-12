import { z } from "zod";

// ---------- KPIs / stats -------------------------------------------------

export const AdminStatsSchema = z.object({
  total_users: z.number().int().nonnegative(),
  users_last_7_days: z.number().int().nonnegative(),
  games_this_week: z.number().int().nonnegative(),
  games_completed_all_time: z.number().int().nonnegative(),
  top_venues: z.array(
    z.object({
      venue_id: z.string().uuid(),
      venue_name: z.string(),
      game_count: z.number().int().nonnegative(),
    }),
  ),
  pending_reports: z.number().int().nonnegative(),
});

// ---------- Users --------------------------------------------------------

export const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  display_name: z.string(),
  admin_role: z.enum(["admin", "moderator"]).nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  games_played_total: z.number().int().nonnegative(),
});

export const AdminUsersListQuery = z.object({
  q: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type AdminUsersListQuery = z.infer<typeof AdminUsersListQuery>;

export const AdminUsersListResponse = z.object({
  items: z.array(AdminUserSchema),
  total: z.number().int().nonnegative(),
});

export const SetRoleRequest = z.object({
  role: z.enum(["admin", "moderator"]).nullable(),
});
export type SetRoleRequest = z.infer<typeof SetRoleRequest>;

// ---------- Games --------------------------------------------------------

export const GameStatusEnum = z.enum(["open", "full", "cancelled", "completed"]);
export type GameStatusValue = z.infer<typeof GameStatusEnum>;

export const AdminGameRowSchema = z.object({
  id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  host_user_id: z.string().uuid(),
  host_display_name: z.string(),
  host_photo_url: z.string().nullable(),
  venue_id: z.string().uuid().nullable(),
  venue_name: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  starts_at: z.string(),
  duration_minutes: z.number().int().positive(),
  capacity: z.number().int().positive(),
  participants_count: z.number().int().nonnegative(),
  status: GameStatusEnum,
  visibility: z.enum(["public", "invite"]),
  skill_min_elo: z.number().int().nullable(),
  skill_max_elo: z.number().int().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type AdminGameRow = z.infer<typeof AdminGameRowSchema>;

export const AdminGamesListQuery = z.object({
  status: GameStatusEnum.optional(),
  sport: z.string().min(1).max(60).optional(),
  q: z.string().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  include_deleted: z.coerce.boolean().optional(),
});
export type AdminGamesListQuery = z.infer<typeof AdminGamesListQuery>;

export const AdminGamesListResponse = z.object({
  items: z.array(AdminGameRowSchema),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
});

export const AdminGameParticipantSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  status: z.enum(["confirmed", "cancelled", "no_show", "played"]),
  joined_at: z.string(),
  status_changed_at: z.string(),
});

export const AdminGameAuditEntrySchema = z.object({
  id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  actor_display_name: z.string().nullable(),
  action: z.string(),
  metadata: z.record(z.unknown()),
  created_at: z.string(),
});

export const AdminGameDetailSchema = AdminGameRowSchema.extend({
  notes: z.string().nullable(),
  updated_at: z.string(),
  participants: z.array(AdminGameParticipantSchema),
  status_changes: z.array(AdminGameAuditEntrySchema),
});
export type AdminGameDetail = z.infer<typeof AdminGameDetailSchema>;

export const AdminGameCancelRequest = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .optional()
  .default({});
export type AdminGameCancelRequest = z.infer<typeof AdminGameCancelRequest>;

export const AdminGameUpdateRequest = z
  .object({
    status: GameStatusEnum.optional(),
    capacity: z.number().int().min(2).max(64).optional(),
    notes: z.string().max(2000).nullable().optional(),
    skill_min_elo: z.number().int().min(0).max(4000).nullable().optional(),
    skill_max_elo: z.number().int().min(0).max(4000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type AdminGameUpdateRequest = z.infer<typeof AdminGameUpdateRequest>;

// ---------- Venues -------------------------------------------------------

export const AdminVenueSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  phone: z.string().nullable(),
  description: z.string().nullable(),
  photo_url: z.string().nullable(),
  is_partner: z.boolean(),
  created_at: z.string(),
});

export const CreateVenueRequest = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z.string().max(64).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  photo_url: z.string().url().max(1024).nullable().optional(),
  is_partner: z.boolean(),
});
export type CreateVenueRequest = z.infer<typeof CreateVenueRequest>;

export const UpdateVenueRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    address: z.string().min(1).max(500).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    phone: z.string().max(64).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    photo_url: z.string().url().max(1024).nullable().optional(),
    is_partner: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateVenueRequest = z.infer<typeof UpdateVenueRequest>;

// ---------- Admin Courts --------------------------------------------------

export const AdminCourtSchema = z.object({
  id: z.string().uuid(),
  venue_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  sport_slug: z.string(),
  name: z.string(),
  hourly_price_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  created_at: z.string(),
});

export const AdminCourtsListResponse = z.object({
  items: z.array(AdminCourtSchema),
});

export const CreateCourtRequest = z.object({
  sport_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  hourly_price_minor: z.number().int().nonnegative().max(100_000_00),
  currency: z.string().length(3).optional(),
});
export type CreateCourtRequest = z.infer<typeof CreateCourtRequest>;

export const UpdateCourtRequest = z
  .object({
    sport_id: z.string().uuid().optional(),
    name: z.string().min(1).max(120).optional(),
    hourly_price_minor: z.number().int().nonnegative().max(100_000_00).optional(),
    currency: z.string().length(3).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateCourtRequest = z.infer<typeof UpdateCourtRequest>;

// ---------- Tournaments --------------------------------------------------

const TournamentStatusEnum = z.enum([
  "announced",
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "cancelled",
]);

const TournamentEntryStatusEnum = z.enum([
  "pending",
  "confirmed",
  "withdrawn",
  "disqualified",
]);

export const AdminTournamentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  sport_id: z.string().uuid(),
  sport_slug: z.string().nullable().optional(),
  sport_name: z.string().nullable().optional(),
  venue_id: z.string().uuid().nullable(),
  venue_name: z.string().nullable().optional(),
  starts_at: z.string(),
  ends_at: z.string(),
  registration_deadline: z.string().nullable(),
  max_squads: z.number().int().positive(),
  squad_size: z.number().int().positive(),
  entry_fee_minor: z.number().int().nonnegative(),
  currency: z.string(),
  status: TournamentStatusEnum,
  entries_count: z.number().int().nonnegative().optional(),
  created_at: z.string(),
});

export const AdminTournamentsListQuery = z.object({
  status: TournamentStatusEnum.optional(),
  sport: z.string().min(1).max(60).optional(), // sport slug
  q: z.string().min(1).max(120).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type AdminTournamentsListQuery = z.infer<typeof AdminTournamentsListQuery>;

export const AdminTournamentsListResponse = z.object({
  items: z.array(AdminTournamentSchema),
  next_cursor: z.string().nullable(),
});

export const CreateTournamentRequest = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().optional(),
    sport_id: z.string().uuid(),
    venue_id: z.string().uuid().nullable().optional(),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    registration_deadline: z.string().datetime().nullable().optional(),
    max_squads: z.number().int().min(2).max(256),
    squad_size: z.number().int().min(1).max(20),
    entry_fee_minor: z.number().int().nonnegative(),
    currency: z.string().length(3),
    status: TournamentStatusEnum.optional(),
  })
  .superRefine((v, ctx) => {
    if (new Date(v.ends_at).getTime() <= new Date(v.starts_at).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ends_at must be after starts_at",
        path: ["ends_at"],
      });
    }
    if (
      v.registration_deadline !== undefined &&
      v.registration_deadline !== null &&
      new Date(v.registration_deadline).getTime() > new Date(v.starts_at).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "registration_deadline must be on or before starts_at",
        path: ["registration_deadline"],
      });
    }
  });
export type CreateTournamentRequest = z.infer<typeof CreateTournamentRequest>;

export const UpdateTournamentRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    sport_id: z.string().uuid().optional(),
    venue_id: z.string().uuid().nullable().optional(),
    starts_at: z.string().datetime().optional(),
    ends_at: z.string().datetime().optional(),
    registration_deadline: z.string().datetime().nullable().optional(),
    max_squads: z.number().int().min(2).max(256).optional(),
    squad_size: z.number().int().min(1).max(20).optional(),
    entry_fee_minor: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    status: TournamentStatusEnum.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  })
  .superRefine((v, ctx) => {
    if (
      v.starts_at !== undefined &&
      v.ends_at !== undefined &&
      new Date(v.ends_at).getTime() <= new Date(v.starts_at).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ends_at must be after starts_at",
        path: ["ends_at"],
      });
    }
  });
export type UpdateTournamentRequest = z.infer<typeof UpdateTournamentRequest>;

// ---------- Tournament entries (admin view) ------------------------------

export const AdminTournamentEntrySchema = z.object({
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

export const AdminTournamentEntriesResponse = z.object({
  items: z.array(AdminTournamentEntrySchema),
});

// Reports schemas moved to modules/reports/reports.schema.ts.

// ---------- Audit log ----------------------------------------------------

export const AuditLogRowSchema = z.object({
  id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  actor_display_name: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  created_at: z.string(),
});

export const AuditListQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type AuditListQuery = z.infer<typeof AuditListQuery>;

export const AuditListResponse = z.object({
  items: z.array(AuditLogRowSchema),
});

// ---------- Admin Bookings ------------------------------------------------

export const AdminBookingStatusEnum = z.enum([
  "pending_payment",
  "partially_paid",
  "paid",
  "cancelled",
  "refunded",
  "failed",
]);
export type AdminBookingStatusValue = z.infer<typeof AdminBookingStatusEnum>;

export const AdminBookingRowSchema = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid().nullable(),
  court_id: z.string().uuid(),
  court_name: z.string(),
  user_id: z.string().uuid(),
  booker_display_name: z.string(),
  booker_email: z.string(),
  venue_id: z.string().uuid(),
  venue_name: z.string(),
  starts_at: z.string(),
  duration_minutes: z.number().int().positive(),
  total_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: AdminBookingStatusEnum,
  idempotency_key: z.string(),
  external_ref: z.string().nullable(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
});
export type AdminBookingRow = z.infer<typeof AdminBookingRowSchema>;

export const AdminBookingsListQuery = z.object({
  status: AdminBookingStatusEnum.optional(),
  venue_id: z.string().uuid().optional(),
  court_id: z.string().uuid().optional(),
  q: z.string().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type AdminBookingsListQuery = z.infer<typeof AdminBookingsListQuery>;

export const AdminBookingsListResponse = z.object({
  items: z.array(AdminBookingRowSchema),
  total: z.number().int().nonnegative(),
});

// ---------- Pagination defaults ------------------------------------------

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

