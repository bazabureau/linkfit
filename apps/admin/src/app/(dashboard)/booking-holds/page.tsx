"use client";

import * as React from "react";
import { Hourglass, RefreshCw, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { useBookingHolds } from "@/lib/admin-booking-holds";

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

function expiresInLabel(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "expired";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export default function BookingHoldsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [includeExpired, setIncludeExpired] = React.useState(false);
  const { data, isLoading, isError, isFetching, refetch } = useBookingHolds({ include_expired: includeExpired, limit: 100 });
  const items = data?.items ?? [];

  // Tick every second so the expiry countdown stays live.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeCount = items.filter((h) => !h.expired).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <Hourglass className="h-6 w-6 text-accent" />
            {t("Booking holds")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Temporary slot reservations held during checkout before payment.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-foregroundMuted">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="h-4 w-4 rounded border-border accent-accent" />
            {t("Include expired")}
          </label>
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-foregroundMuted">
        <Timer className="h-4 w-4 text-accent" />
        <span>{t("Active holds")}: <span className="font-semibold text-foreground">{activeCount}</span></span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Player")}</TableHead>
              <TableHead>{t("Court")}</TableHead>
              <TableHead>{t("Slot")}</TableHead>
              <TableHead>{t("Source")}</TableHead>
              <TableHead>{t("Expires in")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="text-sm font-semibold text-danger">{t("Could not load booking holds")}</p>
                  <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-3">
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("No active holds")}</TableCell></TableRow>
            ) : (
              items.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <p className="font-semibold text-foreground">{h.user_name ?? t("Adsız istifadəçi")}</p>
                    <p className="text-xs text-foregroundMuted">{h.user_email ?? "—"}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-foreground">{h.court_name ?? "—"}</p>
                    <p className="text-xs text-foregroundMuted">{h.venue_name ?? "—"}</p>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    {dt(h.starts_at)} · {h.duration_minutes} {t("min")}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{h.source}</TableCell>
                  <TableCell className="tabular-nums">
                    {h.expired ? (
                      <span className="text-foregroundMuted">{t("expired")}</span>
                    ) : (
                      <span className="font-semibold text-foreground">{expiresInLabel(h.expires_at, now)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={h.expired ? "neutral" : "success"}>{h.expired ? t("expired") : t("Holding")}</Badge>
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
