"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Star,
  Search,
  MessageSquare,
  EyeOff,
  RotateCcw,
  AlertCircle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/date-format";

/** Inline debounce — avoids touching shared lib/hooks. */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface Review {
  id: string;
  venue_id: string;
  venue_name: string | null;
  author_user_id: string;
  display_name: string | null;
  author_photo_url: string | null;
  rating: number;
  body: string | null;
  review_photo_url: string | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
}

interface ReviewsResponse {
  items: Review[];
  total: number;
  summary: {
    avg_rating: number | null;
    active_count: number;
    removed_count: number;
  };
}

const partnerReviewKeys = {
  list: (rating: string, q: string) =>
    ["partner", "reviews", rating, q] as const,
};

function Stars({
  rating,
  size = "sm",
}: {
  rating: number;
  size?: "sm" | "lg";
}): React.JSX.Element {
  const cls = size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`${cls} ${
            i < rating
              ? "fill-warning text-warning"
              : "fill-transparent text-borderStrong"
          }`}
        />
      ))}
    </div>
  );
}

// ── Summary KPI card ─────────────────────────────────────────────────────────
function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  children,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone: "amber" | "accent" | "danger";
  children?: React.ReactNode;
}): React.JSX.Element {
  const toneMap = {
    amber: "bg-warning/10 text-warning ring-warning/20",
    accent: "bg-accent/10 text-accent ring-accent/20",
    danger: "bg-danger/10 text-danger ring-danger/20",
  } as const;
  return (
    <Card className="relative overflow-hidden p-5 shadow-card">
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-accent/[0.05] to-transparent blur-2xl" />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold   text-foregroundMuted">
          {label}
        </p>
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${toneMap[tone]}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="font-display text-[1.7rem] font-bold leading-none  text-foreground tabular-nums">
          {value}
        </span>
        {children}
      </div>
    </Card>
  );
}

const RATING_OPTIONS = ["all", "5", "4", "3", "2", "1"] as const;

export default function ReviewsPage(): React.JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();

  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);

  const [confirmRemove, setConfirmRemove] = useState<Review | null>(null);

  const queryString = useMemo(() => {
    const usp = new URLSearchParams();
    if (ratingFilter !== "all") usp.set("rating", ratingFilter);
    if (debouncedQ.trim()) usp.set("q", debouncedQ.trim());
    usp.set("limit", "100");
    const s = usp.toString();
    return s ? `?${s}` : "";
  }, [ratingFilter, debouncedQ]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: partnerReviewKeys.list(ratingFilter, debouncedQ),
    queryFn: () =>
      api.get<ReviewsResponse>(`/api/v1/partner/reviews${queryString}`),
    staleTime: 20_000,
  });

  const removeMut = useMutation({
    mutationFn: (id: string) =>
      api.post<Review>(`/api/v1/partner/reviews/${id}/remove`, {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["partner", "reviews"] }),
  });
  const restoreMut = useMutation({
    mutationFn: (id: string) =>
      api.post<Review>(`/api/v1/partner/reviews/${id}/restore`, {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["partner", "reviews"] }),
  });

  const reviews = useMemo(() => data?.items ?? [], [data]);
  const summary = data?.summary;

  // Rating distribution across the currently loaded reviews — drives the
  // mini histogram next to the average score.
  const distribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0]; // index 0 → 1 star … index 4 → 5 star
    for (const r of reviews) {
      const idx = Math.min(5, Math.max(1, Math.round(r.rating))) - 1;
      const cur = counts[idx] ?? 0;
      counts[idx] = cur + 1;
    }
    const max = counts.reduce((m, c) => Math.max(m, c), 0);
    return { counts, max, total: reviews.length };
  }, [reviews]);

  const handleRemove = async (): Promise<void> => {
    if (!confirmRemove) return;
    const target = confirmRemove;
    setConfirmRemove(null);
    try {
      await removeMut.mutateAsync(target.id);
      toast.success(
        "Rəy gizlədildi",
        `${target.display_name ?? "İstifadəçi"} rəyi artıq mobil tətbiqdə görünmür.`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz", message || "Rəyi gizlətmək mümkün olmadı.");
    }
  };

  const handleRestore = async (review: Review): Promise<void> => {
    try {
      await restoreMut.mutateAsync(review.id);
      toast.success(
        "Rəy bərpa edildi",
        `${review.display_name ?? "İstifadəçi"} rəyi yenidən görünür.`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz", message || "Rəyi bərpa etmək mümkün olmadı.");
    }
  };

  const showEmpty = !isLoading && !isError && reviews.length === 0;

  return (
    <div className="space-y-7">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <MessageSquare className="h-[18px] w-[18px]" />
            </span>
            <h1 className="font-display text-[1.6rem] font-bold  text-foreground">
              Rəylər
            </h1>
          </div>
          <p className="max-w-xl text-sm text-foregroundMuted">
            Oyunçuların məkanınız haqqında rəylərini izləyin və uyğunsuz rəyləri
            gizlədin.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5 self-start"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Yenilə
        </Button>
      </header>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          label="Orta Reytinq"
          value={
            summary?.avg_rating != null
              ? Number(summary.avg_rating).toFixed(1)
              : "—"
          }
          icon={Star}
          tone="amber"
        >
          {summary?.avg_rating != null ? (
            <div className="mb-1">
              <Stars rating={Math.round(Number(summary.avg_rating))} size="lg" />
            </div>
          ) : null}
        </Kpi>
        <Kpi
          label="Aktiv Rəy"
          value={summary?.active_count ?? 0}
          icon={MessageSquare}
          tone="accent"
        />
        <Kpi
          label="Gizlədilmiş"
          value={summary?.removed_count ?? 0}
          icon={EyeOff}
          tone="danger"
        />
      </div>

      {/* ── Rating distribution (loaded set) ── */}
      {distribution.total > 0 ? (
        <Card className="p-5 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 fill-warning text-warning" />
            <h3 className="text-sm font-semibold text-foreground">
              Reytinq Paylanması
            </h3>
            <span className="text-xs text-foregroundMuted">
              ({distribution.total} rəy)
            </span>
          </div>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((starVal) => {
              const count = distribution.counts[starVal - 1] ?? 0;
              const pct =
                distribution.max > 0 ? (count / distribution.max) * 100 : 0;
              return (
                <button
                  key={starVal}
                  type="button"
                  onClick={() =>
                    setRatingFilter(
                      ratingFilter === String(starVal) ? "all" : String(starVal),
                    )
                  }
                  className={`flex w-full items-center gap-3 rounded-md px-1.5 py-1 transition-colors hover:bg-surfaceElevated ${
                    ratingFilter === String(starVal) ? "bg-surfaceElevated" : ""
                  }`}
                >
                  <span className="flex w-7 shrink-0 items-center gap-0.5 text-xs font-semibold text-foregroundMuted tabular-nums">
                    {starVal}
                    <Star className="h-3 w-3 fill-warning text-warning" />
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surfaceElevated">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-warning/70 to-warning transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-xs font-medium text-foregroundMuted tabular-nums">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* ── Filters ── */}
      <Card className="flex flex-col gap-3 p-4 shadow-card sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rəy mətni və ya müəllif adı ilə axtar…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surfaceElevated p-1">
          {RATING_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setRatingFilter(opt)}
              className={`flex items-center gap-0.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                ratingFilter === opt
                  ? "bg-accent text-accent-ink"
                  : "text-foregroundMuted hover:bg-background hover:text-foreground"
              }`}
            >
              {opt === "all" ? (
                "Hamısı"
              ) : (
                <>
                  {opt}
                  <Star
                    className={`h-3 w-3 ${
                      ratingFilter === opt
                        ? "fill-accent-ink text-accent-ink"
                        : "fill-warning text-warning"
                    }`}
                  />
                </>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* ── Reviews list ── */}
      {isError ? (
        <Card className="flex flex-col items-center justify-center gap-4 py-20 text-center shadow-card">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/15">
            <AlertCircle className="h-7 w-7 text-danger" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-base font-bold text-foreground">
              Rəylər yüklənmədi
            </h3>
            <p className="text-sm text-foregroundMuted">
              Məlumatı almaq mümkün olmadı. Yenidən cəhd edin.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Yenidən cəhd et
          </Button>
        </Card>
      ) : showEmpty ? (
        <Card className="flex flex-col items-center justify-center gap-4 py-20 text-center shadow-card">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/15">
            <MessageSquare className="h-7 w-7 text-accent" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-base font-bold text-foreground">
              Rəy tapılmadı
            </h3>
            <p className="text-sm text-foregroundMuted">
              Seçilmiş filtrlərə uyğun rəy yoxdur.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="p-5 shadow-card">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surfaceElevated" />
                    <div className="flex-1 space-y-2.5">
                      <div className="h-4 w-40 animate-pulse rounded bg-surfaceElevated" />
                      <div className="h-3 w-full animate-pulse rounded bg-surfaceElevated" />
                      <div className="h-3 w-2/3 animate-pulse rounded bg-surfaceElevated" />
                    </div>
                  </div>
                </Card>
              ))
            : reviews.map((review) => {
                const isRemoved = review.removed_at != null;
                return (
                  <Card
                    key={review.id}
                    className={`group relative overflow-hidden p-5 shadow-card transition-colors ${
                      isRemoved
                        ? "border-danger/30 bg-danger/[0.03]"
                        : "hover:border-borderStrong"
                    }`}
                  >
                    {/* Lime rail on active, danger rail on removed */}
                    <span
                      className={`absolute inset-y-0 left-0 w-0.5 ${
                        isRemoved ? "bg-danger/50" : "bg-accent/0 group-hover:bg-accent/60"
                      } transition-colors`}
                    />
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-surfaceElevated text-sm font-bold text-accent ring-1 ring-border">
                          {review.author_photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={review.author_photo_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (review.display_name ?? "?").charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">
                              {review.display_name ?? "İstifadəçi"}
                            </span>
                            <Stars rating={review.rating} />
                            {isRemoved ? (
                              <Badge
                                variant="danger"
                                className="gap-1 text-[9px]  "
                              >
                                <EyeOff className="h-2.5 w-2.5" />
                                Gizlədilib
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[11px] text-foregroundMuted tabular-nums">
                            {formatDate(review.created_at)}
                          </p>
                          {review.body ? (
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                              {review.body}
                            </p>
                          ) : (
                            <p className="mt-2 flex items-center gap-1.5 text-sm italic text-foregroundMuted">
                              <MessageSquare className="h-3.5 w-3.5" />
                              Mətn qeyd edilməyib.
                            </p>
                          )}
                          {review.review_photo_url ? (
                            <a
                              href={review.review_photo_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={review.review_photo_url}
                                alt="Rəy şəkli"
                                className="max-h-40 rounded-xl border border-border object-cover transition-opacity hover:opacity-90"
                              />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isRemoved ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => handleRestore(review)}
                            disabled={restoreMut.isPending}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Bərpa et
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-foregroundMuted hover:bg-danger/10 hover:text-danger"
                            onClick={() => setConfirmRemove(review)}
                            disabled={removeMut.isPending}
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                            Gizlət
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
        </div>
      )}

      {/* ── Remove confirmation ── */}
      <Dialog
        open={confirmRemove !== null}
        onOpenChange={(open) => (open ? null : setConfirmRemove(null))}
        title="Rəyi gizlət"
      >
        <div className="space-y-5 pt-2">
          {confirmRemove ? (
            <div className="rounded-xl border border-border bg-surfaceElevated p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  {confirmRemove.display_name ?? "İstifadəçi"}
                </span>
                <Stars rating={confirmRemove.rating} />
              </div>
              {confirmRemove.body ? (
                <p className="mt-2 line-clamp-3 text-sm text-foregroundMuted">
                  {confirmRemove.body}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-3 rounded-xl border border-danger/25 bg-danger/[0.06] p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <EyeOff className="h-[18px] w-[18px]" />
            </span>
            <p className="text-sm leading-relaxed text-foregroundMuted">
              Bu rəyi gizlətmək istədiyinizə əminsiniz? Rəy mobil tətbiqdə artıq
              görünməyəcək, lakin sonradan bərpa edilə bilər.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmRemove(null)}
              disabled={removeMut.isPending}
            >
              İmtina
            </Button>
            <Button
              variant="danger"
              onClick={handleRemove}
              disabled={removeMut.isPending}
            >
              {removeMut.isPending ? "Gizlədilir..." : "Bəli, gizlət"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
