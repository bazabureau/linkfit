"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "./api";

export interface OperationsHealth {
  generated_at: string;
  apns: {
    configured: boolean;
    production: boolean;
    bundle_id_set: boolean;
    key_id_set: boolean;
    team_id_set: boolean;
    private_key_readable: boolean;
  };
  push_queue: {
    pending: number;
    retry: number;
    processing: number;
    deferred: number;
    sent_24h: number;
    failed: number;
    cancelled: number;
    skipped: number;
    oldest_pending_at: string | null;
  };
  reminders: {
    games_sent_24h: number;
    bookings_sent_24h: number;
    games_due_next_2h: number;
    bookings_due_next_2h: number;
  };
  media: {
    disk: string;
    assets_total: number;
    deleted_pending_cleanup: number;
    bytes_total: number;
  };
  timers: {
    expected: Record<string, string>;
  };
}

export const operationsKeys = {
  health: ["admin", "operations", "health"] as const,
};

export function useOperationsHealth(): UseQueryResult<OperationsHealth> {
  return useQuery({
    queryKey: operationsKeys.health,
    queryFn: () => api.get<OperationsHealth>("/api/v1/admin/operations"),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}
