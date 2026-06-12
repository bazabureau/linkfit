"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type AuditEntry = {
  id: string;
  actor_user_id: string;
  actor_display_name?: string | null;
  action: string;
  entity: string;
  entity_id: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type AuditResponse = {
  items: AuditEntry[];
  total: number;
};

export const AUDIT_KEY = ["admin", "audit"] as const;

export function useAudit(pageSize = 50) {
  return useInfiniteQuery<AuditResponse>({
    queryKey: [...AUDIT_KEY, pageSize],
    queryFn: ({ pageParam }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
      });
      return api.get<AuditResponse>(`/api/v1/admin/audit?${params.toString()}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    staleTime: 15_000,
  });
}
