"use client";

import { useSyncExternalStore } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type AuditEntry = {
  id: string;
  // null for system-generated entries (no acting admin).
  actor_user_id: string | null;
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

/**
 * Audit log filters supported by the backend (`AdminOpsController::auditQuery`):
 *   - action          exact action slug match
 *   - entity          exact entity type match
 *   - actor_user_id   actor UUID
 *   - from / to       ISO timestamps (inclusive range on created_at)
 */
export type AuditFilters = {
  action?: string;
  entity?: string;
  actor_user_id?: string;
  from?: string;
  to?: string;
};

export const EMPTY_AUDIT_FILTERS: AuditFilters = {};

// ─── Shared filter store ──────────────────────────────────────────────────────
//
// The audit page owns the filter UI, but the data table (`AuditTable`) reads the
// audit query directly via `useAudit`. To keep both in sync without prop-drilling
// across component boundaries, filters live in a tiny external store. The store
// starts empty, so any caller that does not touch it (e.g. the dashboard recent
// activity feed) behaves exactly as before — no filters applied.

let currentFilters: AuditFilters = EMPTY_AUDIT_FILTERS;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setAuditFilters(next: AuditFilters) {
  // Drop empty values so the query key stays stable and the backend only
  // receives meaningful constraints.
  const cleaned: AuditFilters = {};
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && value !== null && value !== "") {
      cleaned[key as keyof AuditFilters] = value;
    }
  }
  currentFilters = cleaned;
  emit();
}

export function resetAuditFilters() {
  if (Object.keys(currentFilters).length === 0) return;
  currentFilters = EMPTY_AUDIT_FILTERS;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentFilters;
}

/** Subscribe to the live audit filters (used by the filter bar + table). */
export function useAuditFilters(): AuditFilters {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function countActiveAuditFilters(filters: AuditFilters): number {
  return Object.values(filters).filter(
    (v) => v !== undefined && v !== null && v !== "",
  ).length;
}

export const AUDIT_KEY = ["admin", "audit"] as const;

export function useAudit(pageSize = 50) {
  const filters = useAuditFilters();

  return useInfiniteQuery<AuditResponse>({
    // Filters are part of the key so the query refetches when they change.
    queryKey: [...AUDIT_KEY, pageSize, filters],
    queryFn: ({ pageParam }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
      });
      if (filters.action) params.set("action", filters.action);
      if (filters.entity) params.set("entity", filters.entity);
      if (filters.actor_user_id) params.set("actor_user_id", filters.actor_user_id);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
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
