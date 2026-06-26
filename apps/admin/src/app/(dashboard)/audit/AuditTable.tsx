"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { type AuditEntry, useAudit, useAuditFilters } from "@/lib/admin-audit";
import { API_BASE_URL, apiHeaders } from "@/lib/api";
import {
  actionDotClass,
  actionPillClass,
  actionTone,
  entityLabel,
  formatRelative,
  formatTimestamp,
  initials,
} from "./lib";

function ActionPill({ action }: { action: string }): React.JSX.Element {
  const tone = actionTone(action);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${actionPillClass(tone)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${actionDotClass(tone)}`} />
      {action}
    </span>
  );
}

function StatTile({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number;
  loading?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <span className="text-[11px] font-semibold   text-foregroundMuted">
        {label}
      </span>
      {loading ? (
        <div className="mt-3 h-7 w-16 animate-pulse rounded-md bg-surfaceElevated" />
      ) : (
        <p className="mt-2 font-display text-[1.6rem] font-bold leading-none tabular-nums text-foreground">
          {value}
        </p>
      )}
    </div>
  );
}

const COL_COUNT = 5;

function RowSkeleton(): React.JSX.Element {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: COL_COUNT }).map((_, index) => (
        <td key={index} className="px-4 py-3.5">
          <div
            className="h-4 animate-pulse rounded bg-surfaceElevated"
            style={{ width: index === COL_COUNT - 1 ? 16 : `${45 + ((index * 19) % 45)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const hasMetadata =
    entry.metadata !== null &&
    entry.metadata !== undefined &&
    typeof entry.metadata === "object" &&
    Object.keys(entry.metadata).length > 0;

  return (
    <>
      <tr
        onClick={() => hasMetadata && setExpanded((value) => !value)}
        className={`group border-b border-border bg-surface transition-colors hover:bg-surfaceElevated/70 ${
          hasMetadata ? "cursor-pointer" : ""
        }`}
      >
        {/* Timestamp */}
        <td className="px-4 py-3 align-middle">
          <div className="min-w-[150px]">
            <div className="text-sm font-medium text-foreground">
              {formatTimestamp(entry.created_at)}
            </div>
            <div className="text-xs text-foregroundMuted">
              {formatRelative(entry.created_at)}
            </div>
          </div>
        </td>

        {/* Actor */}
        <td className="px-4 py-3 align-middle">
          <div className="flex min-w-[200px] items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-accent">
              {initials(entry.actor_display_name)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {entry.actor_display_name ?? "Unknown actor"}
              </div>
              <div className="truncate font-mono text-[11px] text-foregroundMuted">
                {entry.actor_user_id}
              </div>
            </div>
          </div>
        </td>

        {/* Action */}
        <td className="px-4 py-3 align-middle">
          <ActionPill action={entry.action} />
        </td>

        {/* Entity */}
        <td className="px-4 py-3 align-middle">
          <div className="min-w-[180px]">
            <div className="text-sm font-medium text-foreground">
              {entityLabel(entry.entity)}
            </div>
            <div className="truncate font-mono text-[11px] text-foregroundMuted">
              {entry.entity_id}
            </div>
          </div>
        </td>

        {/* Expand affordance */}
        <td className="px-4 py-3 text-right align-middle">
          {hasMetadata ? (
            <span className="inline-grid h-7 w-7 place-items-center rounded-lg text-foregroundMuted transition group-hover:bg-surface">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
          ) : null}
        </td>
      </tr>
      {hasMetadata && expanded ? (
        <tr className="border-b border-border bg-surfaceElevated/40">
          <td colSpan={COL_COUNT} className="px-4 py-3">
            <pre className="overflow-x-auto rounded-xl border border-border bg-ink p-3.5 font-mono text-xs leading-relaxed text-accent/90">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function AuditTable(): React.JSX.Element {
  const toast = useToast();
  const filters = useAuditFilters();
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAudit(50);

  const entries: AuditEntry[] = React.useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.items),
    [data],
  );

  const total = data?.pages?.[0]?.total ?? 0;
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = React.useState(false);

  // Lightweight insight strip derived from what is already loaded.
  const insights = React.useMemo(() => {
    const actors = new Set<string>();
    const entities = new Set<string>();
    let destructive = 0;
    for (const entry of entries) {
      if (entry.actor_user_id) actors.add(entry.actor_user_id);
      if (entry.entity) entities.add(entry.entity);
      if (actionTone(entry.action) === "danger") destructive += 1;
    }
    return { actors: actors.size, entities: entities.size, destructive };
  }, [entries]);

  const exportCsv = React.useCallback(async () => {
    setExporting(true);
    try {
      // Keep the CSV export in sync with the active filter bar — the backend
      // export endpoint honours the same query params as the audit list.
      const params = new URLSearchParams();
      if (filters.action) params.set("action", filters.action);
      if (filters.entity) params.set("entity", filters.entity);
      if (filters.actor_user_id) params.set("actor_user_id", filters.actor_user_id);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const query = params.toString();
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/audit/export${query ? `?${query}` : ""}`,
        { headers: apiHeaders(), credentials: "include" },
      );
      if (!response.ok) throw new Error("Export file could not be generated");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `linkfit-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready", "Audit log CSV downloaded.");
    } catch (error) {
      toast.error(
        "Export failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }, [toast, filters]);

  const triggerNext = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) triggerNext();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [triggerNext]);

  const headClass =
    "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

  return (
    <div className="space-y-5">
      {/* Insight strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total entries" value={total} loading={isLoading && !data} />
        <StatTile label="Loaded" value={entries.length} loading={isLoading && !data} />
        <StatTile label="Actors" value={insights.actors} loading={isLoading && !data} />
        <StatTile
          label="Destructive"
          value={insights.destructive}
          loading={isLoading && !data}
        />
      </div>

      {isError ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-danger" />
            <p className="text-sm text-foreground">Failed to load audit log.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">Activity feed</h2>
            <p className="text-xs text-foregroundMuted">
              {total > 0
                ? `${entries.length} of ${total} loaded`
                : isLoading
                  ? "Loading…"
                  : "No entries"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && !isFetchingNextPage ? (
              <span className="hidden items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info sm:inline-flex">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Refreshing
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportCsv()}
              disabled={exporting}
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting…" : "CSV"}
            </Button>
          </div>
        </div>

        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={`${headClass} rounded-tl-2xl`}>Timestamp</th>
                <th className={headClass}>Actor</th>
                <th className={headClass}>Action</th>
                <th className={headClass}>Entity</th>
                <th className={`${headClass} w-12 rounded-tr-2xl`} />
              </tr>
            </thead>
            <tbody>
              {isLoading && entries.length === 0 ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : (
                entries.map((entry) => <AuditRow key={entry.id} entry={entry} />)
              )}
            </tbody>
          </table>

          {!isLoading && entries.length === 0 && !isError ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
                <Activity className="h-7 w-7 text-accent" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-foreground">
                  No audit entries
                </h3>
                <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
                  Try adjusting the filters or check back later.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Infinite-load footer */}
        {entries.length > 0 ? (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center gap-3 border-t border-border px-5 py-4 text-sm text-foregroundMuted"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading more…
              </>
            ) : hasNextPage ? (
              <Button variant="secondary" size="sm" onClick={() => triggerNext()}>
                Load more
              </Button>
            ) : (
              <span>
                End of log · {entries.length} of {total}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
