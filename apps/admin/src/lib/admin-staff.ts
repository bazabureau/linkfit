"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export type StaffRole = "admin" | "moderator";

/** Permission keys mirrored from the backend `normalizeAdminStaffPermissions`. */
export const STAFF_PERMISSION_KEYS = [
  "dashboard",
  "users",
  "staff",
  "venues",
  "courts",
  "bookings",
  "games",
  "tournaments",
  "reports",
  "reviews",
  "operations",
  "media",
  "push_jobs",
  "revenue",
] as const;

export type StaffPermissionKey = (typeof STAFF_PERMISSION_KEYS)[number];
export type StaffPermissions = Record<StaffPermissionKey, boolean>;

export interface StaffAccount {
  id: string;
  email: string;
  display_name: string;
  admin_role: StaffRole;
  staff_title: string | null;
  staff_permissions: StaffPermissions;
  deleted_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface StaffListResponse {
  items: StaffAccount[];
}

export interface CreateStaffPayload {
  email: string;
  display_name: string;
  password: string;
  role: StaffRole;
  staff_title?: string | null;
  staff_permissions?: Partial<StaffPermissions> | null;
}

export interface UpdateStaffPayload {
  email?: string;
  display_name?: string;
  password?: string;
  role?: StaffRole;
  staff_title?: string | null;
  staff_permissions?: Partial<StaffPermissions> | null;
  restore?: boolean;
}

export const staffKeys = {
  all: ["admin", "staff"] as const,
};

export function useStaffAccounts(): UseQueryResult<StaffAccount[]> {
  return useQuery({
    queryKey: staffKeys.all,
    queryFn: async () => (await api.get<StaffListResponse>("/api/v1/admin/staff")).items ?? [],
    staleTime: 15_000,
  });
}

export function useCreateStaffAccount(): UseMutationResult<
  StaffAccount,
  Error,
  CreateStaffPayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post<StaffAccount>("/api/v1/admin/staff", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }),
  });
}

export function useUpdateStaffAccount(): UseMutationResult<
  StaffAccount,
  Error,
  { id: string; data: UpdateStaffPayload }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.patch<StaffAccount>(`/api/v1/admin/staff/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }),
  });
}

export function useDeleteStaffAccount(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete<void>(`/api/v1/admin/staff/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }),
  });
}
