"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type TopVenue = {
  id: string;
  name: string;
  game_count: number;
};

export type AdminStats = {
  users_total: number;
  users_new_7d: number;
  games_this_week: number;
  games_completed_total: number;
  top_venues: TopVenue[];
  pending_reports: number;
};

export const ADMIN_STATS_KEY = ["admin", "stats"] as const;

export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: ADMIN_STATS_KEY,
    queryFn: () => api.get<AdminStats>("/api/v1/admin/stats"),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
