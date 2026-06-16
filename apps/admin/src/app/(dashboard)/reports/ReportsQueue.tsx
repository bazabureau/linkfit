"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Gamepad2,
  MapPin,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AdminReport,
  type ReportStatus,
  useReports,
  useReviewReport,
} from "@/lib/admin-reports";

type Filter = ReportStatus | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "reviewed", label: "Reviewed" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

const PAGE_SIZE = 25;

export function ReportsQueue() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminReport | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useReports({
    status: filter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(0);
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                filter === f.key
                  ? "bg-accent text-black"
                  : "bg-surfaceElevated text-foreground hover:bg-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {isError ? (
        <Card className="border-danger/40 bg-danger/10">
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-danger" />
              <p className="text-sm text-foreground">Failed to load reports.</p>
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
              <TableHead className="min-w-24">ID</TableHead>
              <TableHead className="min-w-36">Reporter</TableHead>
              <TableHead className="min-w-20 text-center">Target</TableHead>
              <TableHead className="min-w-36">Target ID</TableHead>
              <TableHead className="min-w-64">Reason</TableHead>
              <TableHead className="min-w-28">Status</TableHead>
              <TableHead className="min-w-36">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <div className="h-4 w-full animate-pulse rounded bg-surfaceElevated" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <ShieldAlert className="h-8 w-8 text-foregroundMuted" />
                    <p className="text-sm text-foregroundMuted">
                      No {filter === "all" ? "" : filter} reports.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((r) => (
                <TableRow
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-mono text-xs text-foregroundMuted">
                    {shortId(r.id)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foreground">
                    {shortId(r.reporter_user_id)}
                  </TableCell>
                  <TableCell className="text-center">
                    <TargetIcon kind={r.target_kind} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foregroundMuted">
                    {shortId(r.target_id)}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm text-foreground">
                    {r.reason}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-xs text-foregroundMuted">
                    {formatRelative(r.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-col gap-3 text-sm text-foregroundMuted sm:flex-row sm:items-center sm:justify-between">
        <span>
          {total === 0
            ? "—"
            : `${page * PAGE_SIZE + 1}–${Math.min(
                (page + 1) * PAGE_SIZE,
                total,
              )} of ${total}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 0 || isLoading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages - 1 || isLoading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ReportDetailDialog
        report={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function ReportDetailDialog({
  report,
  onClose,
}: {
  report: AdminReport | null;
  onClose: () => void;
}) {
  const review = useReviewReport();
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setNotes(report?.notes ?? "");
  }, [report?.id, report?.notes]);

  if (!report) return null;

  const submit = async (status: "reviewed" | "dismissed") => {
    try {
      await review.mutateAsync({ id: report.id, status, notes });
      toast.success(
        status === "reviewed" ? "Report reviewed" : "Report dismissed",
        { description: `Report ${shortId(report.id)} updated.` },
      );
      onClose();
    } catch (e) {
      toast.error("Failed to update report", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Report {shortId(report.id)}
          </DialogTitle>
          <DialogDescription>
            Submitted {formatRelative(report.created_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <DetailRow label="Reporter">
              <span className="font-mono text-xs break-all">
                {report.reporter_user_id}
              </span>
            </DetailRow>
            <DetailRow label="Status">
              <StatusBadge status={report.status} />
            </DetailRow>
            <DetailRow label="Target type">
              <span className="inline-flex items-center gap-1.5 capitalize">
                <TargetIcon kind={report.target_kind} />
                {report.target_kind}
              </span>
            </DetailRow>
            <DetailRow label="Target ID">
              <a
                href={targetHref(report.target_kind, report.target_id)}
                className="font-mono text-xs text-accent hover:underline break-all"
              >
                {report.target_id}
              </a>
            </DetailRow>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foregroundMuted">
              Reason
            </p>
            <div className="whitespace-pre-wrap rounded-lg border border-border bg-surfaceElevated p-3 text-sm text-foreground">
              {report.reason || (
                <span className="text-foregroundMuted">
                  (no reason provided)
                </span>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="report-notes"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-foregroundMuted"
            >
              Moderator notes
            </label>
            <Textarea
              id="report-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context for this decision…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => submit("dismissed")}
            disabled={review.isPending}
          >
            <X className="mr-1.5 h-4 w-4" />
            Dismiss
          </Button>
          <Button
            onClick={() => submit("reviewed")}
            disabled={review.isPending}
          >
            <Check className="mr-1.5 h-4 w-4" />
            Mark reviewed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-foregroundMuted">
        {label}
      </p>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function TargetIcon({ kind }: { kind: string }) {
  const cls = "h-4 w-4 text-foregroundMuted";
  switch (kind) {
    case "user":
      return <User className={cls} />;
    case "game":
      return <Gamepad2 className={cls} />;
    case "venue":
      return <MapPin className={cls} />;
    case "message":
      return <MessageSquare className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

function StatusBadge({ status }: { status: ReportStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="warning">Pending</Badge>;
    case "reviewed":
      return <Badge variant="success">Reviewed</Badge>;
    case "dismissed":
      return <Badge variant="neutral">Dismissed</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
}

function shortId(id: string) {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatRelative(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

function targetHref(kind: string, id: string) {
  switch (kind) {
    case "user":
      return `/users/${id}`;
    case "game":
      return `/games/${id}`;
    case "venue":
      return `/venues/${id}`;
    default:
      return "#";
  }
}
