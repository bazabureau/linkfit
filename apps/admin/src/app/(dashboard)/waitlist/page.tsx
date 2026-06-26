"use client";

import * as React from "react";
import {
  AlertTriangle,
  BellRing,
  Check,
  ListChecks,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Undo2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useUpdateWaitlistEntry,
  useWaitlist,
  type WaitlistStatus,
} from "@/lib/admin-waitlist";
import {
  LAUNCH_WAITLIST_ROLES,
  LAUNCH_WAITLIST_STATUSES,
  useLaunchWaitlist,
  useUpdateLaunchWaitlistStatus,
  type LaunchWaitlistEntry,
  type LaunchWaitlistRole,
  type LaunchWaitlistStatus,
} from "@/lib/admin-launch-waitlist";

const dt = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const filterSelectCls =
  "h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground";

type Tab = "launch" | "court";

export default function WaitlistPage(): React.JSX.Element {
  const { t } = useI18n();
  // Default to the public "coming soon" launch sign-ups — that is what the
  // website feeds and what the operator expects to manage first. The original
  // court-booking waitlist is kept as a secondary tab.
  const [tab, setTab] = React.useState<Tab>("launch");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
        <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
          <ListChecks className="h-6 w-6 text-accent" />
          {t("Waitlist")}
        </h1>
        <p className="mt-1 text-sm text-foregroundMuted">
          {tab === "launch"
            ? t("People who signed up for early access on the website.")
            : t("Players waiting for a slot to free up on a court.")}
        </p>
      </div>

      <div className="flex w-fit gap-1 rounded-pill border border-border bg-surface p-1">
        {(["launch", "court"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium transition ${tab === key ? "bg-accent text-white" : "text-foregroundMuted hover:text-foreground"}`}
          >
            {key === "launch" ? t("Launch sign-ups") : t("Court waitlist")}
          </button>
        ))}
      </div>

      {tab === "launch" ? <LaunchTab /> : <CourtTab />}
    </div>
  );
}

// ───────────────────────────── Launch sign-ups ─────────────────────────────

const LAUNCH_STATUS_LABEL: Record<LaunchWaitlistStatus, string> = {
  pending: "Pending",
  invited: "Invited",
  joined: "Joined",
  declined: "Declined",
};

const LAUNCH_ROLE_LABEL: Record<string, string> = {
  player: "Player",
  venue: "Venue owner",
  coach: "Coach",
  other: "Other",
};

function launchStatusVariant(
  s: LaunchWaitlistStatus,
): "success" | "info" | "neutral" | "warning" {
  if (s === "joined") return "success";
  if (s === "invited") return "info";
  if (s === "pending") return "warning";
  return "neutral";
}

function LaunchTab(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = React.useState<LaunchWaitlistStatus | "">("");
  const [role, setRole] = React.useState<LaunchWaitlistRole | "">("");
  const [q, setQ] = React.useState("");
  const [confirm, setConfirm] = React.useState<LaunchWaitlistEntry | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useLaunchWaitlist({
    status: status || undefined,
    role: role || undefined,
    q: q.trim() || undefined,
    limit: 100,
  });
  const update = useUpdateLaunchWaitlistStatus();

  const items = data?.items ?? [];
  const total = data?.pagination.total ?? 0;
  const hasFilters = status !== "" || role !== "" || q.trim() !== "";

  function move(id: string, next: LaunchWaitlistStatus, okMsg: string): void {
    update.mutate(
      { id, status: next },
      {
        onSuccess: () => toast.success(t(okMsg)),
        onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={filterSelectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as LaunchWaitlistStatus | "")}
        >
          <option value="">{t("All statuses")}</option>
          {LAUNCH_WAITLIST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(LAUNCH_STATUS_LABEL[s])}
            </option>
          ))}
        </select>
        <select
          className={filterSelectCls}
          value={role}
          onChange={(e) => setRole(e.target.value as LaunchWaitlistRole | "")}
        >
          <option value="">{t("All roles")}</option>
          {LAUNCH_WAITLIST_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(LAUNCH_ROLE_LABEL[r] ?? r)}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search by name or email…")}
            className="h-9 w-56 pl-8"
          />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus("");
              setRole("");
              setQ("");
            }}
          >
            {t("Reset")}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!isError && (
            <span className="text-xs text-foregroundMuted">
              {t("Total")}: {total}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Name")}</TableHead>
              <TableHead>{t("Contact")}</TableHead>
              <TableHead>{t("Role")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Signed up")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="text-sm font-semibold text-danger">{t("Could not load waitlist")}</p>
                  <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-3">
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">
                  {t("Yüklənir")}…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">
                  {hasFilters ? t("No waitlist entries") : t("No sign-ups yet")}
                </TableCell>
              </TableRow>
            ) : (
              items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <p className="font-semibold text-foreground">{w.name ?? t("Adsız istifadəçi")}</p>
                    {w.message && (
                      <p className="mt-0.5 max-w-[260px] truncate text-xs text-foregroundMuted" title={w.message}>
                        {w.message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-foreground">{w.email}</p>
                    <p className="text-xs text-foregroundMuted">{w.phone ?? "—"}</p>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    {w.role ? t(LAUNCH_ROLE_LABEL[w.role] ?? w.role) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={launchStatusVariant(w.status)}>{t(LAUNCH_STATUS_LABEL[w.status])}</Badge>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{dt(w.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {(w.status === "pending" || w.status === "declined") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Invite")}
                          title={t("Invite")}
                          disabled={update.isPending}
                          onClick={() => move(w.id, "invited", "Marked as invited")}
                        >
                          <Mail className="h-3.5 w-3.5 text-info" />
                        </Button>
                      )}
                      {w.status === "invited" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Mark joined")}
                          title={t("Mark joined")}
                          disabled={update.isPending}
                          onClick={() => move(w.id, "joined", "Marked as joined")}
                        >
                          <Check className="h-3.5 w-3.5 text-accent" />
                        </Button>
                      )}
                      {(w.status === "pending" || w.status === "invited") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Decline")}
                          title={t("Decline")}
                          disabled={update.isPending}
                          onClick={() => setConfirm(w)}
                        >
                          <X className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      )}
                      {(w.status === "joined" || w.status === "declined") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Reset to pending")}
                          title={t("Reset to pending")}
                          disabled={update.isPending}
                          onClick={() => move(w.id, "pending", "Reset to pending")}
                        >
                          <Undo2 className="h-3.5 w-3.5 text-foregroundMuted" />
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

      {confirm && (
        <ConfirmDialog
          title={t("Decline sign-up")}
          message={t("«{name}» will be marked as declined. Continue?").replace(
            "{name}",
            confirm.name ?? confirm.email,
          )}
          confirmLabel={t("Decline")}
          pending={update.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            update.mutate(
              { id: confirm.id, status: "declined" },
              {
                onSuccess: () => {
                  toast.success(t("Marked as declined"));
                  setConfirm(null);
                },
                onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
              },
            )
          }
        />
      )}
    </div>
  );
}

// ──────────────────────────── Court booking waitlist ───────────────────────

const COURT_STATUSES: WaitlistStatus[] = ["active", "notified", "cancelled", "expired"];

function courtStatusVariant(s: WaitlistStatus): "success" | "info" | "neutral" | "warning" {
  if (s === "active") return "success";
  if (s === "notified") return "info";
  if (s === "expired") return "warning";
  return "neutral";
}

function CourtTab(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = React.useState<WaitlistStatus | "">("");
  const [date, setDate] = React.useState("");
  const { data, isLoading, isError, isFetching, refetch } = useWaitlist({
    status: status || undefined,
    date: date || undefined,
  });
  const update = useUpdateWaitlistEntry();
  const items = data?.items ?? [];

  function setStatusFor(id: string, next: WaitlistStatus, okMsg: string): void {
    update.mutate(
      { id, status: next },
      {
        onSuccess: () => toast.success(t(okMsg)),
        onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={filterSelectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as WaitlistStatus | "")}
        >
          <option value="">{t("All statuses")}</option>
          {COURT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-auto" />
        {(status || date) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus("");
              setDate("");
            }}
          >
            {t("Reset")}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {t("Refresh")}
        </Button>
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
            {isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center">
                  <p className="text-sm font-semibold text-danger">{t("Could not load waitlist")}</p>
                  <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-3">
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">
                  {t("Yüklənir")}…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">
                  {t("No waitlist entries")}
                </TableCell>
              </TableRow>
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
                  <TableCell>
                    <Badge variant={courtStatusVariant(w.status)}>{t(w.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {w.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Mark notified")}
                          title={t("Mark notified")}
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
                          title={t("Cancel")}
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

// ─────────────────────────────── Confirm modal ─────────────────────────────

/** Shared confirm modal for negative/terminal actions (no global ConfirmDialog component exists). */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-danger" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-foregroundMuted">{message}</p>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("Ləğv")}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
