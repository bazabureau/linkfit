import {
  type GameStatus,
  type GameVisibility,
  type ParticipantStatus,
} from "../../shared/db/types.js";

export interface Participant {
  user_id: string;
  display_name: string;
  photo_url: string | null;
  status: ParticipantStatus;
  joined_at: string;
}

export interface GameSummary {
  id: string;
  sport_id: string;
  sport_slug: string;
  host_user_id: string;
  host_display_name: string;
  court_id: string | null;
  venue_name: string | null;
  venue_photo_url: string | null;
  lat: number;
  lng: number;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  participants_count: number;
  status: GameStatus;
  visibility: GameVisibility;
  skill_min_elo: number | null;
  skill_max_elo: number | null;
  distance_km: number | null;
}

export interface GameDetail extends GameSummary {
  notes: string | null;
  participants: Participant[];
  created_at: string;
}
