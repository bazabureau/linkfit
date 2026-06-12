"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type AuditEntry, useAudit } from "@/lib/admin-audit";

export function AuditTable() {
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAudit(50);

  const entries: AuditEntry[] = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.items),
    [data],
  );

  const total = data?.pages?.[0]?.total ?? 0;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const triggerNext = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) triggerNext();
      },
      { rootMargin: "200px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [triggerNext]);

  return (
    <div className="space-y-4">
      {isError ? (
        <Card className="border-danger/40 bg-danger/10">
          <CardContent className="flex items-center justify-between gap-4 py-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-danger" />
              <p className="text-sm text-foreground">
                Failed to load audit log.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Timestamp</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && entries.length === 0 ? (
              [...Array(8)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(5)].map((__, j) => (
                    <TableCell key={j}>
                      <div className="h-4 w-full animate-pulse rounded bg-surfaceElevated" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <Activity className="h-8 w-8 text-foregroundMuted" />
                    <p className="text-sm text-foregroundMuted">
                      No audit entries yet.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => <AuditRow key={entry.id} entry={entry} />)
            )}
          </TableBody>
        </Table>
      </Card>

      <div
        ref={sentinelRef}
        className="flex items-center justify-center gap-3 py-4 text-sm text-foregroundMuted"
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
        ) : entries.length > 0 ? (
          <span>
            End of log · {entries.length} of {total}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata =
    entry.metadata !== null &&
    entry.metadata !== undefined &&
    typeof entry.metadata === "object" &&
    Object.keys(entry.metadata).length > 0;

  return (
    <>
      <TableRow
        onClick={() => hasMetadata && setExpanded((e) => !e)}
        className={hasMetadata ? "cursor-pointer" : ""}
      >
        <TableCell>
          <div className="flex flex-col">
            <span className="text-xs text-foreground">
              {formatTimestamp(entry.created_at)}
            </span>
            <span className="text-[11px] text-foregroundMuted">
              {formatRelative(entry.created_at)}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="text-sm text-foreground">
              {entry.actor_display_name ?? "Unknown actor"}
            </span>
            <span className="font-mono text-[11px] text-foregroundMuted break-all">
              {entry.actor_user_id}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <ActionBadge action={entry.action} />
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="text-sm text-foreground">{entry.entity}</span>
            <span className="font-mono text-[11px] text-foregroundMuted break-all">
              {entry.entity_id}
            </span>
          </div>
        </TableCell>
        <TableCell>
          {hasMetadata ? (
            expanded ? (
              <ChevronDown className="h-4 w-4 text-foregroundMuted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-foregroundMuted" />
            )
          ) : null}
        </TableCell>
      </TableRow>
      {hasMetadata && expanded ? (
        <TableRow className="bg-background/50">
          <TableCell colSpan={5}>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surfaceElevated p-3 font-mono text-xs leading-relaxed text-foreground">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function ActionBadge({ action }: { action: string }) {
  const lower = action.toLowerCase();
  let variant: "success" | "warning" | "danger" | "info" | "neutral" =
    "neutral";
  if (lower.includes("create") || lower.includes("add")) variant = "success";
  else if (lower.includes("delete") || lower.includes("remove"))
    variant = "danger";
  else if (lower.includes("update") || lower.includes("edit"))
    variant = "info";
  else if (lower.includes("review") || lower.includes("dismiss"))
    variant = "warning";
  return <Badge variant={variant}>{action}</Badge>;
}

function formatTimestamp(iso: string) {
  try {
    return format(new Date(iso), "MMM d, yyyy HH:mm:ss");
  } catch {
    return iso;
  }
}

function formatRelative(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}
