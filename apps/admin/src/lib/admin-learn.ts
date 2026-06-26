"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";

// ---------- Types ----------
export interface AdminCoach {
  id: string;
  display_name: string;
  photo_url: string | null;
  bio: string | null;
  rating: number | null;
  years_experience: number | null;
  hourly_rate_minor: number | null;
  currency: string | null;
  sport_id: string | null;
  sport_slug: string | null;
  venue_id: string | null;
  venue_name: string | null;
  is_active: boolean;
}

export interface AdminLesson {
  id: string;
  coach_id: string;
  coach_name: string | null;
  title: string;
  description: string | null;
  kind: string;
  sport_id: string | null;
  sport_slug: string | null;
  level_label: string | null;
  starts_at: string | null;
  duration_minutes: number;
  capacity: number;
  booked_count: number;
  spots_left: number;
  price_minor: number | null;
  currency: string | null;
  status: string;
  venue_id: string | null;
  venue_name: string | null;
  court_id: string | null;
  court_name: string | null;
}

export interface CoachPayload {
  venue_id: string;
  display_name: string;
  sport_id?: string | null;
  bio?: string | null;
  photo_url?: string | null;
  hourly_rate_minor?: number | null;
  currency?: string | null;
  years_experience?: number | null;
  rating?: number | null;
  is_active?: boolean;
}

export interface LessonPayload {
  venue_id: string;
  coach_id: string;
  sport_id: string;
  title: string;
  description?: string | null;
  kind?: string;
  level_label?: string | null;
  court_id?: string | null;
  starts_at: string;
  duration_minutes: number;
  capacity?: number;
  price_minor?: number | null;
  currency?: string | null;
  status?: string;
}

export interface RosterEntry {
  id: string;
  display_name: string | null;
  photo_url: string | null;
  status: string;
  booked_at: string | null;
}

export interface LessonRoster {
  items: RosterEntry[];
  booked_count: number;
}

export interface SportOption { id: string; slug: string; name: string }
export interface VenueOption { id: string; name: string }

const learnKeys = {
  coaches: (f: Record<string, string>) => ["admin", "coaches", f] as const,
  lessons: (f: Record<string, string>) => ["admin", "lessons", f] as const,
  roster: (id: string) => ["admin", "lessons", id, "bookings"] as const,
};

function qs(filters: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ---------- Lookups ----------
export function useSportOptions(): UseQueryResult<SportOption[]> {
  return useQuery({
    queryKey: ["sports"],
    queryFn: async () => (await api.get<{ items: SportOption[] }>("/api/v1/sports")).items ?? [],
    staleTime: 60 * 60 * 1000,
  });
}

export function useVenueOptions(): UseQueryResult<VenueOption[]> {
  return useQuery({
    queryKey: ["venue-options"],
    queryFn: async () => (await api.get<{ items: VenueOption[] }>("/api/v1/venues?limit=200")).items ?? [],
    staleTime: 10 * 60 * 1000,
  });
}

// ---------- Coaches ----------
export function useAdminCoaches(filters: Record<string, string> = {}): UseQueryResult<AdminCoach[]> {
  return useQuery({
    queryKey: learnKeys.coaches(filters),
    queryFn: async () => (await api.get<{ items: AdminCoach[] }>(`/api/v1/admin/coaches${qs(filters)}`)).items ?? [],
  });
}

export function useCreateCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CoachPayload) => api.post<AdminCoach>("/api/v1/admin/coaches", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "coaches"] }),
  });
}

export function useUpdateCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CoachPayload> }) =>
      api.put<AdminCoach>(`/api/v1/admin/coaches/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "coaches"] }),
  });
}

export function useDeleteCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/admin/coaches/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "coaches"] });
      qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
    },
  });
}

// ---------- Lessons ----------
export function useAdminLessons(filters: Record<string, string> = {}): UseQueryResult<AdminLesson[]> {
  return useQuery({
    queryKey: learnKeys.lessons(filters),
    queryFn: async () => (await api.get<{ items: AdminLesson[] }>(`/api/v1/admin/lessons${qs(filters)}`)).items ?? [],
  });
}

export function useCreateLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LessonPayload) => api.post<AdminLesson>("/api/v1/admin/lessons", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "lessons"] }),
  });
}

export function useUpdateLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LessonPayload> }) =>
      api.put<AdminLesson>(`/api/v1/admin/lessons/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "lessons"] }),
  });
}

export function useDeleteLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/admin/lessons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "lessons"] }),
  });
}

// ---------- Lesson roster (booked players) ----------
export function useLessonRoster(lessonId: string | null): UseQueryResult<LessonRoster> {
  return useQuery({
    queryKey: lessonId ? learnKeys.roster(lessonId) : (["admin", "lessons", "roster", "none"] as const),
    queryFn: () => api.get<LessonRoster>(`/api/v1/admin/lessons/${lessonId}/bookings`),
    enabled: Boolean(lessonId),
  });
}
