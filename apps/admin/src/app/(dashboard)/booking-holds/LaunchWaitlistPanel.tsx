"use client";

import * as React from "react";
import { Loader2, RefreshCw, Rocket, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  useLaunchWaitlist,
  useUpdateLaunchWaitlistEntry,
  type LaunchWaitlistStatus,
} from "./hooks";

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const STATUSES: LaunchWaitlistStatus[] = [
  "pending",
  "invited",
  "joined",
  "declined",
];

const ROLES = ["player", "venue", "coach", "other"] as const;

function statusVariant(
  s: LaunchWaitlistStatus,
): "success" | "info" | "neutral" | "warning" {
  if (s === "joined") return "success";
  if (s === "invited") return "info";
  if (s === "declined") return "warning";
  return "neutral";
}

const selectClass =
  "h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";

const COL_COUNT = 6;

export function LaunchWaitlistPanel(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = React.useState<LaunchWaitlistStatus | "">("");
  const [role, setRole] = React.useState("");
  const [q, setQ] = React.useState("");

  // Debounce the free-text search so we don't refetch on every keystroke.
  const [debouncedQ, setDebouncedQ] = React.useState("");
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const { data, isLoading, isError, isFetching, refetch } = useLaunchWaitlist({
    status: status || undefined,
    role: role || undefined,
    q: debouncedQ || undefined,
    limit: 100,
  });
  const update = useUpdateLaunchWaitlistEntry();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const items = data?.items ?? [];
  const total = data?.pagination.total ?? items.length;
  const hasFilters = status !== "" || role !== "" || q !== "";

  function setStatusFor(id: string, next: LaunchWaitlistStatus) {
    setPendingId(id);
    update.mutate(
      { id, status: next },
      {
        onSuccess: () => toast.success(t("Lead status updated")),
        onError: (err) =>
          toast.error(
            t("Could not update lead"),
            err instanceof Error ? err.message : t("Yenidən yoxlayın"),
          ),
        onSettled: () => setPendingId(null),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Name or email…")}
              className="h-9 pl-9 pr-9"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label={t("Təmizlə")}
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <select
            className={selectClass}
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as LaunchWaitlistStatus | "")
            }
          >
            <option value="">{t("All statuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">{t("All roles")}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(r)}
              </option>
            ))}
          </select>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus("");
                setRole("");
                setQ("");
              }}
            >
              <X className="h-3.5 w-3.5" />
              {t("Reset")}
            </Button>
          ) : null}
        </div>
        <Button
          variant="secondary"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {t("Refresh")}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-sm text-foregroundMuted">
        <Rocket className="h-4 w-4 text-accent" />
        <span>
          {t("Total leads")}:{" "}
          <span className="font-semibold text-foreground">{total}</span>
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Lead")}</TableHead>
              <TableHead>{t("Role")}</TableHead>
              <TableHead>{t("Source")}</TableHead>
              <TableHead>{t("Message")}</TableHead>
              <TableHead>{t("Joined at")}</TableHead>
              <TableHead className="text-right">{t("Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="py-10 text-center">
                  <p className="text-sm font-semibold text-danger">
                    {t("Could not load launch waitlist")}
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
                  {t("No launch signups")}
                </TableCell>
              </TableRow>
            ) : (
              items.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <p className="font-semibold text-foreground">
                      {lead.name ?? t("Adsız")}
                    </p>
                    <p className="text-xs text-foregroundMuted">{lead.email}</p>
                    {lead.phone ? (
                      <p className="text-xs text-foregroundMuted">{lead.phone}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    {lead.role ? t(lead.role) : "—"}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    {lead.source ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] text-foregroundMuted">
                    <span className="block truncate" title={lead.message ?? ""}>
                      {lead.message ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    {dt(lead.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Badge variant={statusVariant(lead.status)}>
                        {t(lead.status)}
                      </Badge>
                      <div className="relative">
                        <select
                          className={selectClass}
                          aria-label={t("Update status")}
                          value={lead.status}
                          disabled={update.isPending && pendingId === lead.id}
                          onChange={(e) =>
                            setStatusFor(
                              lead.id,
                              e.target.value as LaunchWaitlistStatus,
                            )
                          }
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(s)}
                            </option>
                          ))}
                        </select>
                        {update.isPending && pendingId === lead.id ? (
                          <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-foregroundMuted" />
                        ) : null}
                      </div>
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
