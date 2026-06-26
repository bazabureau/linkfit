"use client";

import * as React from "react";
import { Ban, RefreshCw, RotateCw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "../venues/detail-ui";
import {
  useCancelPushJob,
  usePushJobs,
  useRetryPushJob,
  type PushJob,
  type PushJobsSummary,
  type PushJobStatus,
} from "@/lib/admin-push-jobs";

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

const STATUSES: PushJobStatus[] = ["pending", "retry", "processing", "sent", "failed", "cancelled", "skipped"];

function statusVariant(s: PushJobStatus): "success" | "warning" | "danger" | "info" | "neutral" {
  if (s === "sent") return "success";
  if (s === "failed") return "danger";
  if (s === "retry" || s === "pending") return "warning";
  if (s === "processing") return "info";
  return "neutral";
}

const CANCELLABLE: PushJobStatus[] = ["pending", "retry", "processing"];

export default function PushJobsPage(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = React.useState<PushJobStatus | "">("");
  const [cancelFor, setCancelFor] = React.useState<PushJob | null>(null);
  const { data, isLoading, isError, isFetching, refetch } = usePushJobs({ status: status || undefined, limit: 100 });
  const retry = useRetryPushJob();
  const cancel = useCancelPushJob();
  const items = data?.items ?? [];
  const summary = data?.summary;

  function handleCancel() {
    if (!cancelFor) return;
    const target = cancelFor;
    setCancelFor(null);
    cancel.mutate(target.id, {
      onSuccess: () => toast.success(t("Push job cancelled")),
      onError: () => toast.error(t("Alınmadı")),
    });
  }

  const stats: { key: keyof PushJobsSummary; label: string; tone: "warning" | "info" | "success" | "danger" | "neutral" }[] = [
    { key: "pending", label: "pending", tone: "warning" },
    { key: "retry", label: "retry", tone: "warning" },
    { key: "processing", label: "processing", tone: "info" },
    { key: "sent_24h", label: "Sent (24h)", tone: "success" },
    { key: "failed", label: "failed", tone: "danger" },
    { key: "cancelled", label: "cancelled", tone: "neutral" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <Send className="h-6 w-6 text-accent" />
            {t("Push jobs")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Outgoing push notification queue — retry or cancel pending jobs.")}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {t("Refresh")}
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <StatPill key={s.key} label={t(s.label)} value={summary?.[s.key]} tone={s.tone} />
        ))}
      </section>
      <p className="text-xs text-foregroundMuted">
        {t("Deferred")}: <span className="font-semibold text-foreground">{summary?.deferred ?? "—"}</span>
        {" · "}
        {t("Skipped")}: <span className="font-semibold text-foreground">{summary?.skipped ?? "—"}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" value={status} onChange={(e) => setStatus(e.target.value as PushJobStatus | "")}>
          <option value="">{t("All statuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Notification")}</TableHead>
              <TableHead>{t("Recipient")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Attempts")}</TableHead>
              <TableHead>{t("Scheduled")}</TableHead>
              <TableHead>{t("Sent")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <p className="text-sm text-danger">{t("Yenidən yoxlayın")}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("No push jobs")}</TableCell></TableRow>
            ) : (
              items.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="max-w-[280px]">
                    <p className="truncate font-semibold text-foreground">{j.title}</p>
                    <p className="truncate text-xs text-foregroundMuted">{j.body}</p>
                    {j.error && <p className="mt-0.5 truncate text-xs text-danger">{j.error}</p>}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    <p className="text-sm text-foreground">{j.user_display_name ?? t("Adsız istifadəçi")}</p>
                    <p className="text-xs">{j.user_email ?? "—"}</p>
                  </TableCell>
                  <TableCell><Badge variant={statusVariant(j.status)}>{t(j.status)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums text-foregroundMuted">{j.attempts ?? 0}</TableCell>
                  <TableCell className="text-foregroundMuted">{dt(j.available_at)}</TableCell>
                  <TableCell className="text-foregroundMuted">{dt(j.sent_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("Retry")}
                        disabled={retry.isPending}
                        onClick={() =>
                          retry.mutate(j.id, {
                            onSuccess: () => toast.success(t("Push job re-queued")),
                            onError: () => toast.error(t("Alınmadı")),
                          })
                        }
                      >
                        <RotateCw className="h-3.5 w-3.5 text-info" />
                      </Button>
                      {CANCELLABLE.includes(j.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Cancel")}
                          disabled={cancel.isPending}
                          onClick={() => setCancelFor(j)}
                        >
                          <Ban className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={cancelFor !== null}
        title={t("Cancel this push job?")}
        description={cancelFor ? cancelFor.title : ""}
        confirmLabel={t("Cancel")}
        danger
        busy={cancel.isPending}
        onOpenChange={(open) => !open && setCancelFor(null)}
        onConfirm={handleCancel}
      />
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone: "warning" | "info" | "success" | "danger" | "neutral";
}): React.JSX.Element {
  const toneCls = {
    warning: "border-warning/30 bg-warning/10 text-warning",
    info: "border-info/30 bg-info/10 text-info",
    success: "border-accent/30 bg-accent/10 text-[#3f6b00]",
    danger: "border-danger/30 bg-danger/10 text-danger",
    neutral: "border-border bg-surfaceElevated text-foreground",
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneCls}`}>
      <p className="text-[11px] font-semibold capitalize opacity-80">{label}</p>
      <p className="mt-1 font-display text-lg font-bold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}
