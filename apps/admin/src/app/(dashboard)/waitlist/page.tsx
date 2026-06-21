"use client";

import * as React from "react";
import { BellRing, ListChecks, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useUpdateWaitlistEntry,
  useWaitlist,
  type WaitlistStatus,
} from "@/lib/admin-waitlist";

const dt = (iso: string) =>
  new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUSES: WaitlistStatus[] = ["active", "notified", "cancelled", "expired"];

function statusVariant(s: WaitlistStatus): "success" | "info" | "neutral" | "warning" {
  if (s === "active") return "success";
  if (s === "notified") return "info";
  if (s === "expired") return "warning";
  return "neutral";
}

export default function WaitlistPage(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = React.useState<WaitlistStatus | "">("");
  const [date, setDate] = React.useState("");
  const { data, isLoading, isFetching, refetch } = useWaitlist({
    status: status || undefined,
    date: date || undefined,
  });
  const update = useUpdateWaitlistEntry();
  const items = data?.items ?? [];

  function setStatusFor(id: string, next: WaitlistStatus, okMsg: string) {
    update.mutate(
      { id, status: next },
      { onSuccess: () => toast.success(t(okMsg)), onError: () => toast.error(t("Alınmadı")) },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <ListChecks className="h-6 w-6 text-accent" />
            {t("Waitlist")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Players waiting for a slot to free up on a court.")}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {t("Refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" value={status} onChange={(e) => setStatus(e.target.value as WaitlistStatus | "")}>
          <option value="">{t("All statuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-auto" />
        {(status || date) && (
          <Button variant="ghost" size="sm" onClick={() => { setStatus(""); setDate(""); }}>{t("Reset")}</Button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Player")}</TableHead>
              <TableHead>{t("Court")}</TableHead>
              <TableHead>{t("Requested slot")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("No waitlist entries")}</TableCell></TableRow>
            ) : (
              items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <p className="font-semibold text-foreground">{w.user.display_name ?? t("Adsız istifadəçi")}</p>
                    <p className="text-xs text-foregroundMuted">{w.user.email ?? "—"}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-foreground">{w.court_name}</p>
                    <p className="text-xs text-foregroundMuted">{w.venue_name}</p>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    {dt(w.starts_at)} · {w.duration_minutes} {t("min")}
                  </TableCell>
                  <TableCell><Badge variant={statusVariant(w.status)}>{t(w.status)}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {w.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Mark notified")}
                          disabled={update.isPending}
                          onClick={() => setStatusFor(w.id, "notified", "Marked as notified")}
                        >
                          <BellRing className="h-3.5 w-3.5 text-info" />
                        </Button>
                      )}
                      {(w.status === "active" || w.status === "notified") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Cancel")}
                          disabled={update.isPending}
                          onClick={() => setStatusFor(w.id, "cancelled", "Waitlist entry cancelled")}
                        >
                          <X className="h-3.5 w-3.5 text-danger" />
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
    </div>
  );
}
