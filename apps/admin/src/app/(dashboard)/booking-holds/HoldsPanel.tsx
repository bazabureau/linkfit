"use client";

import * as React from "react";
import { Loader2, RefreshCw, Timer, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { useBookingHolds, type BookingHold } from "@/lib/admin-booking-holds";
import { useReleaseBookingHold } from "./hooks";

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function expiresInLabel(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "expired";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

const COL_COUNT = 7;

export function HoldsPanel(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [includeExpired, setIncludeExpired] = React.useState(false);
  const { data, isLoading, isError, isFetching, refetch } = useBookingHolds({
    include_expired: includeExpired,
    limit: 100,
  });
  const items = data?.items ?? [];

  const release = useReleaseBookingHold();
  const [target, setTarget] = React.useState<BookingHold | null>(null);

  // Tick every second so the expiry countdown stays live.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeCount = items.filter((h) => !h.expired).length;

  function confirmRelease() {
    if (!target) return;
    release.mutate(
      { id: target.id },
      {
        onSuccess: () => {
          toast.success(t("Hold released"));
          setTarget(null);
        },
        onError: (err) =>
          toast.error(
            t("Could not release hold"),
            err instanceof Error ? err.message : t("Yenidən yoxlayın"),
          ),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-foregroundMuted">
          <Timer className="h-4 w-4 text-accent" />
          <span>
            {t("Active holds")}:{" "}
            <span className="font-semibold text-foreground">{activeCount}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-foregroundMuted">
            <input
              type="checkbox"
              checked={includeExpired}
              onChange={(e) => setIncludeExpired(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            {t("Include expired")}
          </label>
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </Button>
        </div>
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
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="py-10 text-center">
                  <p className="text-sm font-semibold text-danger">
                    {t("Could not load booking holds")}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void refetch()}
                    className="mt-3"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={COL_COUNT}
                  className="py-10 text-center text-foregroundMuted"
                >
                  {t("Yüklənir")}…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COL_COUNT}
                  className="py-10 text-center text-foregroundMuted"
                >
                  {t("No active holds")}
                </TableCell>
              </TableRow>
            ) : (
              items.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <p className="font-semibold text-foreground">
                      {h.user_name ?? t("Adsız istifadəçi")}
                    </p>
                    <p className="text-xs text-foregroundMuted">
                      {h.user_email ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-foreground">{h.court_name ?? "—"}</p>
                    <p className="text-xs text-foregroundMuted">
                      {h.venue_name ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    {dt(h.starts_at)} · {h.duration_minutes} {t("min")}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{h.source}</TableCell>
                  <TableCell className="tabular-nums">
                    {h.expired ? (
                      <span className="text-foregroundMuted">{t("expired")}</span>
                    ) : (
                      <span className="font-semibold text-foreground">
                        {expiresInLabel(h.expires_at, now)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={h.expired ? "neutral" : "success"}>
                      {h.expired ? t("expired") : t("Holding")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("Release hold")}
                      title={t("Release hold")}
                      disabled={release.isPending}
                      onClick={() => setTarget(h)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !release.isPending) setTarget(null);
        }}
        title={t("Release hold")}
        contentClassName="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              {t(
                "This frees the held slot immediately so it can be booked again. This cannot be undone.",
              )}
            </span>
          </div>
          {target ? (
            <div className="rounded-xl border border-border bg-surfaceElevated px-3 py-2.5 text-sm text-foregroundMuted">
              <span className="font-semibold text-foreground">
                {target.user_name ?? t("Adsız istifadəçi")}
              </span>{" "}
              · {target.court_name ?? "—"} · {dt(target.starts_at)}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={release.isPending}
              onClick={() => setTarget(null)}
            >
              {t("Bağla")}
            </Button>
            <Button
              variant="danger"
              disabled={release.isPending}
              onClick={confirmRelease}
            >
              {release.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {t("Release hold")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
