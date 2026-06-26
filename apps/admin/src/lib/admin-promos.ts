"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export type PromoStatus = "active" | "inactive" | "archived";
export type PromoDiscountType = "percent" | "fixed";

export interface PromoCode {
  id: string;
  code: string;
  title: string | null;
  description: string | null;
  discount_type: PromoDiscountType;
  /** Percent (1-100) for `percent`, integer minor units for `fixed`. */
  discount_value: number;
  currency: string | null;
  min_amount_minor: number;
  max_discount_minor: number | null;
  max_redemptions: number | null;
  per_user_limit: number;
  status: PromoStatus;
  starts_at: string | null;
  ends_at: string | null;
  redemptions_count: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string | null;
}

/** A single redemption of a promo code, surfaced in the usage view. */
export interface PromoRedemption {
  id: string;
  booking_id: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  discount_minor: number;
  booking_status: string | null;
  created_at: string | null;
}

/** Full promo record returned by the show endpoint, including recent usage. */
export interface PromoCodeDetail extends PromoCode {
  recent_redemptions: PromoRedemption[];
}

export interface PromoCodesResponse {
  items: PromoCode[];
  pagination: { limit: number; offset: number; total: number };
}

export interface PromoCodesParams {
  q?: string;
  status?: PromoStatus;
  limit?: number;
  offset?: number;
}

export interface PromoPayload {
  code: string;
  title?: string | null;
  description?: string | null;
  discount_type: PromoDiscountType;
  discount_value: number;
  currency?: string | null;
  min_amount_minor?: number;
  max_discount_minor?: number | null;
  max_redemptions?: number | null;
  per_user_limit?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: PromoStatus;
}

function qs(params: object): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const promoKeys = {
  all: ["admin", "promo-codes"] as const,
  list: (p: PromoCodesParams) => [...promoKeys.all, "list", p] as const,
  detail: (id: string) => [...promoKeys.all, "detail", id] as const,
};

export function usePromoCodes(
  params: PromoCodesParams = {},
): UseQueryResult<PromoCodesResponse> {
  return useQuery({
    queryKey: promoKeys.list(params),
    queryFn: () => api.get<PromoCodesResponse>(`/api/v1/admin/promo-codes${qs(params)}`),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function usePromoCode(
  id: string | null,
): UseQueryResult<PromoCodeDetail> {
  return useQuery({
    queryKey: promoKeys.detail(id ?? ""),
    queryFn: () => api.get<PromoCodeDetail>(`/api/v1/admin/promo-codes/${id}`),
    enabled: id != null,
    staleTime: 10_000,
  });
}

export function useCreatePromoCode(): UseMutationResult<PromoCode, Error, PromoPayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post<PromoCode>("/api/v1/admin/promo-codes", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: promoKeys.all }),
  });
}

export function useUpdatePromoCode(): UseMutationResult<
  PromoCode,
  Error,
  { id: string; data: Partial<PromoPayload> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      api.patch<PromoCode>(`/api/v1/admin/promo-codes/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: promoKeys.all }),
  });
}

export function useDeletePromoCode(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete<void>(`/api/v1/admin/promo-codes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: promoKeys.all }),
  });
}
