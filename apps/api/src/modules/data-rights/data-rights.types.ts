export interface AccountDeletionRequest {
  /** Stable identifier — equal to `user_id` because the table's PK is the
   *  user. Surfaced as `id` so the iOS client (which models the row as a
   *  generic resource with `let id: String`) can decode without a custom
   *  CodingKeys mapping. */
  id: string;
  user_id: string;
  status: "scheduled" | "cancelled" | "completed";
  /** ISO timestamp of when the deletion was requested. Mirrors
   *  `scheduled_at` in iOS terminology — same value, both keys are
   *  populated for backward compatibility with older clients. */
  requested_at: string;
  scheduled_at: string;
  hard_delete_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
}

export interface DataExportRequest {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "ready" | "failed";
  download_url: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

/** Shape of the JSON file produced for a /data-export call. Each collection
 *  is capped at 10k rows; when the cap kicks in `_truncated` flips to true
 *  so the consumer knows the dataset is partial. */
export interface DataExportPayload {
  exported_at: string;
  user_id: string;
  profile: unknown;
  games_hosted: { rows: unknown[]; _truncated: boolean };
  game_participation: { rows: unknown[]; _truncated: boolean };
  ratings: { rows: unknown[]; _truncated: boolean };
  bookings: { rows: unknown[]; _truncated: boolean };
  messages_sent: { rows: unknown[]; _truncated: boolean };
  notifications: { rows: unknown[]; _truncated: boolean };
  follows: { rows: unknown[]; _truncated: boolean };
  reports_filed: { rows: unknown[]; _truncated: boolean };
  tournament_entries: { rows: unknown[]; _truncated: boolean };
  memberships: { rows: unknown[]; _truncated: boolean };
  feed_events: { rows: unknown[]; _truncated: boolean };
}
