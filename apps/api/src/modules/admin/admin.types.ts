import { type DbHandle } from "../../shared/db/pool.js";
import { type NotificationsService } from "../social/notifications.service.js";
import { type AdminBookingStatusValue } from "./admin.schema.js";

export interface AdminServiceDeps {
  db: DbHandle;
  notifications: NotificationsService;
}

export interface AdminStats {
  total_users: number;
  users_last_7_days: number;
  games_this_week: number;
  games_completed_all_time: number;
  top_venues: { venue_id: string; venue_name: string; game_count: number }[];
  pending_reports: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string;
  admin_role: "admin" | "moderator" | null;
  deleted_at: string | null;
  created_at: string;
  games_played_total: number;
}

export interface AdminUsersPage {
  items: AdminUserRow[];
  total: number;
}

export type AdminGameStatus = "open" | "full" | "cancelled" | "completed";

export interface AdminGameRow {
  id: string;
  sport_id: string;
  sport_slug: string;
  host_user_id: string;
  host_display_name: string;
  host_photo_url: string | null;
  venue_id: string | null;
  venue_name: string | null;
  lat: number;
  lng: number;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  participants_count: number;
  status: AdminGameStatus;
  visibility: "public" | "invite";
  skill_min_elo: number | null;
  skill_max_elo: number | null;
  created_at: string;
  deleted_at: string | null;
}

export interface AdminGamesPage {
  items: AdminGameRow[];
  total: number;
  next_cursor: string | null;
}

export interface AdminGameParticipant {
  user_id: string;
  display_name: string;
  photo_url: string | null;
  status: "confirmed" | "cancelled" | "no_show" | "played";
  joined_at: string;
  status_changed_at: string;
}

export interface AdminGameAuditEntry {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminGameDetail extends AdminGameRow {
  notes: string | null;
  updated_at: string;
  participants: AdminGameParticipant[];
  status_changes: AdminGameAuditEntry[];
}

export interface AdminVenueOut {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  description: string | null;
  photo_url: string | null;
  is_partner: boolean;
  created_at: string;
}

export interface AdminCourtOut {
  id: string;
  venue_id: string;
  sport_id: string;
  sport_slug: string;
  name: string;
  hourly_price_minor: number;
  currency: string;
  created_at: string;
}

export type AdminTournamentStatus =
  | "announced"
  | "registration_open"
  | "registration_closed"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface AdminTournamentOut {
  id: string;
  name: string;
  description: string | null;
  sport_id: string;
  sport_slug?: string | null;
  sport_name?: string | null;
  venue_id: string | null;
  venue_name?: string | null;
  starts_at: string;
  ends_at: string;
  registration_deadline: string | null;
  max_squads: number;
  squad_size: number;
  entry_fee_minor: number;
  currency: string;
  status: AdminTournamentStatus;
  entries_count?: number;
  created_at: string;
}

export interface AdminTournamentsPage {
  items: AdminTournamentOut[];
  next_cursor: string | null;
}

export type AdminTournamentEntryStatus =
  | "pending"
  | "confirmed"
  | "withdrawn"
  | "disqualified";

export interface AdminTournamentEntryOut {
  id: string;
  tournament_id: string;
  captain_user_id: string;
  captain_display_name: string;
  captain_photo_url: string | null;
  squad_name: string;
  player_ids: string[];
  player_names: string[];
  status: AdminTournamentEntryStatus;
  created_at: string;
}

export interface AuditRowOut {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminBookingRow {
  id: string;
  game_id: string | null;
  court_id: string;
  court_name: string;
  user_id: string;
  booker_display_name: string;
  booker_email: string;
  venue_id: string;
  venue_name: string;
  starts_at: string;
  duration_minutes: number;
  total_minor: number;
  currency: string;
  status: AdminBookingStatusValue;
  idempotency_key: string;
  external_ref: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
}

export interface AdminBookingsPage {
  items: AdminBookingRow[];
  total: number;
}
