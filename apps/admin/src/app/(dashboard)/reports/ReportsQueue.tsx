"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useReports,
  useReviewReport,
  type AdminReport,
} from "@/lib/admin-reports";
import {
  ReportFilters,
  type ReasonFilter,
  type StatusFilter,
  type TargetFilter,
} from "./ReportFilters";
import { ReportsTable } from "./ReportsTable";
import { ReportDrawer } from "./ReportDrawer";
import { StatCards, type ReportStats } from "./StatCards";
import { REPORT_STATUS_AZ, PAGE_SIZE, isReportOverdue, shortId } from "./lib";

function useDebouncedValue<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function ReportsQueue(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();

  const [status, setStatus] = React.useState<StatusFilter>("pending");
  const [reason, setReason] = React.useState<ReasonFilter>("all");
  const [targetKind, setTargetKind] = React.useState<TargetFilter>("all");
  const [q, setQ] = React.useState("");
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const debouncedQuery = useDebouncedValue(q);
  const [page, setPage] = React.useState(0);
  const [drawer, setDrawer] = React.useState<AdminReport | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [quickReview, setQuickReview] = React.useState<{
    report: AdminReport;
    next: "reviewed" | "dismissed";
  } | null>(null);

  const reviewMut = useReviewReport();

  // Reset to first page whenever any server-side filter changes.
  React.useEffect(() => {
    setPage(0);
  }, [status, reason, targetKind, debouncedQuery]);

  const { data, isLoading, isError, isFetching, refetch } = useReports({
    status,
    reason,
    target_kind: targetKind,
    q: debouncedQuery.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  // The backend applies status / reason / target_kind / q server-side, so the
  // page already holds exactly the rows we render.
  const allItems = React.useMemo(() => data?.items ?? [], [data]);
  // "Overdue (pending >24h)" is a client-side narrowing of the already-fetched
  // page — the list API has no age query param. It therefore filters within the
  // current page only (pagination is hidden while it is active).
  const items = React.useMemo(
    () => (overdueOnly ? allItems.filter(isReportOverdue) : allItems),
    [allItems, overdueOnly],
  );
  const total = data?.total ?? 0;

  // Stat cards summarise the current filtered page.
  const stats = React.useMemo<ReportStats>(
    () =>
      allItems.reduce<ReportStats>(
        (acc, r) => {
          acc.total += 1;
          if (r.status === "pending") acc.pending += 1;
          if (r.status === "reviewed") acc.reviewed += 1;
          if (r.status === "dismissed") acc.dismissed += 1;
          return acc;
        },
        { total: 0, pending: 0, reviewed: 0, dismissed: 0 },
      ),
    [allItems],
  );

  // Keep the open drawer synced with the freshest row.
  React.useEffect(() => {
    if (!drawer) return;
    const fresh = allItems.find((r) => r.id === drawer.id);
    if (fresh && fresh !== drawer) setDrawer(fresh);
  }, [allItems, drawer]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE + allItems.length);

  function openDrawer(report: AdminReport) {
    setDrawer(report);
    setDrawerOpen(true);
  }

  async function runQuickReview() {
    if (!quickReview) return;
    const { report, next } = quickReview;
    try {
      await reviewMut.mutateAsync({ id: report.id, status: next, notes: report.notes ?? undefined });
      toast.success(
        next === "reviewed" ? t("Şikayətə baxıldı") : t("Şikayət rədd edildi"),
        report.reason || `#${shortId(report.id)}`,
      );
      setQuickReview(null);
    } catch (error) {
      toast.error(
        t("Şikayət yenilənmədi"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  }

  const emptyHint = overdueOnly
    ? t("24 saatdan çox gözləyən şikayət yoxdur.")
    : status === "all"
      ? t("Filterləri dəyişərək yenidən yoxlayın.")
      : `${t("Bu statusda şikayət yoxdur")}: ${t(REPORT_STATUS_AZ[status])}`;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <StatCards stats={stats} loading={isLoading && !data} />

      {/* Filters */}
      <ReportFilters
        status={status}
        reason={reason}
        targetKind={targetKind}
        q={q}
        overdueOnly={overdueOnly}
        onStatusChange={setStatus}
        onReasonChange={setReason}
        onTargetKindChange={setTargetKind}
        onQueryChange={setQ}
        onOverdueChange={setOverdueOnly}
        onReset={() => {
          setStatus("pending");
          setReason("all");
          setTargetKind("all");
          setQ("");
          setOverdueOnly(false);
        }}
      />

      {/* Error banner */}
      {isError ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-danger" />
            <p className="text-sm font-medium text-foreground">{t("Şikayətlər yüklənmədi.")}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            {t("Yenidən cəhd et")}
          </Button>
        </div>
      ) : null}

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">
              {t("Moderasiya növbəsi")}
            </h2>
            <p className="text-xs text-foregroundMuted">
              {overdueOnly
                ? `${items.length} ${t("gecikən şikayət")}`
                : total === 0
                  ? `0 ${t("göstərilir")}`
                  : `${rangeStart}–${rangeEnd} / ${total}`}
            </p>
          </div>
          {isFetching ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("Yenilənir")}
            </span>
          ) : null}
        </div>

        <ReportsTable
          reports={items}
          loading={isLoading}
          filterLabel={emptyHint}
          actions={{
            onOpen: openDrawer,
            onReview: (report, next) => setQuickReview({ report, next }),
          }}
        />

        {total > PAGE_SIZE && !overdueOnly ? (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3 sm:flex-row">
            <p className="text-sm text-foregroundMuted">
              {t("Səhifə")}{" "}
              <span className="font-semibold text-foreground">{page + 1}</span> / {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0 || isLoading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("Əvvəlki")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages - 1 || isLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("Növbəti")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Detail slide-over */}
      <ReportDrawer report={drawer} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Quick-review confirm */}
      <Dialog
        open={quickReview !== null}
        onOpenChange={(open) => (open ? null : setQuickReview(null))}
        title={
          quickReview?.next === "reviewed"
            ? t("Şikayətə baxıldı kimi işarələ?")
            : t("Şikayəti rədd et?")
        }
        description={
          quickReview?.next === "reviewed"
            ? t("Şikayət həll edilmiş kimi qeyd olunacaq.")
            : t("Şikayət tədbir görülmədən bağlanacaq.")
        }
        contentClassName="max-w-md"
      >
        <div className="space-y-4">
          {quickReview ? (
            <div className="rounded-xl border border-border bg-surfaceElevated px-3 py-2.5 text-sm text-foregroundMuted">
              <span className="font-semibold text-foreground">
                {quickReview.report.reason || `#${shortId(quickReview.report.id)}`}
              </span>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setQuickReview(null)}
              disabled={reviewMut.isPending}
            >
              {t("Bağla")}
            </Button>
            <Button
              variant={quickReview?.next === "dismissed" ? "danger" : "primary"}
              onClick={() => void runQuickReview()}
              disabled={reviewMut.isPending}
            >
              {reviewMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("Təsdiqlə")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
