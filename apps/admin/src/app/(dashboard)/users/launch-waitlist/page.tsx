"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Mail,
  Phone,
  RefreshCw,
  Rocket,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import {
  LAUNCH_WAITLIST_ROLES,
  LAUNCH_WAITLIST_STATUSES,
  useLaunchWaitlist,
  useUpdateLaunchWaitlistStatus,
  type LaunchWaitlistEntry,
  type LaunchWaitlistParams,
  type LaunchWaitlistRole,
  type LaunchWaitlistStatus,
} from "@/lib/admin-launch-waitlist";
import { Avatar, SelectBox } from "../lib";

const PAGE_SIZE = 25;

type StatusFilter = "all" | LaunchWaitlistStatus;
type RoleFilter = "all" | LaunchWaitlistRole;

// AZ source labels (the i18n layer maps AZ → RU/EN; unknown keys fall back).
const STATUS_LABEL: Record<LaunchWaitlistStatus, string> = {
  pending: "Gözləyir",
  invited: "Dəvət olunub",
  joined: "Qoşulub",
  declined: "İmtina edib",
};

const STATUS_PILL: Record<LaunchWaitlistStatus, string> = {
  pending: "bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border",
  invited: "bg-info/10 text-info ring-1 ring-inset ring-info/25",
  joined: "bg-accent/15 text-[#3f6b00] ring-1 ring-inset ring-accent/40",
  declined: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25",
};

const ROLE_LABEL: Record<LaunchWaitlistRole, string> = {
  player: "Oyunçu",
  venue: "Məkan",
  coach: "Məşqçi",
  other: "Digər",
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Hamısı" },
  ...LAUNCH_WAITLIST_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];

const ROLE_FILTERS: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "Rol: hamısı" },
  ...LAUNCH_WAITLIST_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
];

function roleLabel(role: string | null): string {
  if (role && (LAUNCH_WAITLIST_ROLES as readonly string[]).includes(role)) {
    return ROLE_LABEL[role as LaunchWaitlistRole];
  }
  return role || "—";
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-full border px-3.5 text-xs font-semibold transition ${
        active
          ? "border-ink bg-ink text-white shadow-sm"
          : "border-border bg-surface text-foregroundMuted hover:border-borderStrong hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: LaunchWaitlistStatus }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL[status]}`}
    >
      {t(STATUS_LABEL[status])}
    </span>
  );
}

export default function LaunchWaitlistPage(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();

  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [role, setRole] = React.useState<RoleFilter>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [offset, setOffset] = React.useState(0);

  const [detailFor, setDetailFor] = React.useState<LaunchWaitlistEntry | null>(null);
  const [declineFor, setDeclineFor] = React.useState<LaunchWaitlistEntry | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  // Debounce the free-text search into the applied filter (250ms).
  React.useEffect(() => {
    const id = setTimeout(() => setQ(searchInput.trim()), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Any filter change resets to the first page.
  React.useEffect(() => {
    setOffset(0);
  }, [status, role, q]);

  const params = React.useMemo<LaunchWaitlistParams>(
    () => ({
      status: status === "all" ? undefined : status,
      role: role === "all" ? undefined : role,
      q: q || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [status, role, q, offset],
  );

  const { data, isLoading, isError, isFetching, refetch } = useLaunchWaitlist(params);
  const items = React.useMemo(() => data?.items ?? [], [data]);
  const total = data?.pagination.total ?? 0;

  const updateStatus = useUpdateLaunchWaitlistStatus();

  function applyStatus(entry: LaunchWaitlistEntry, next: LaunchWaitlistStatus) {
    setPendingId(entry.id);
    updateStatus.mutate(
      { id: entry.id, status: next },
      {
        onSuccess: () => toast.success(t("Status yeniləndi"), STATUS_LABEL[next]),
        onError: (err) => toast.error(t("Status yenilənmədi"), err.message),
        onSettled: () => setPendingId(null),
      },
    );
  }

  function onStatusSelect(entry: LaunchWaitlistEntry, next: LaunchWaitlistStatus) {
    if (next === entry.status) return;
    // "declined" is the irreversible-feeling step → confirm first.
    if (next === "declined") {
      setDeclineFor(entry);
      return;
    }
    applyStatus(entry, next);
  }

  const hasFilters = status !== "all" || role !== "all" || q !== "";
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link
            href="/users"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-foregroundMuted transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("İstifadəçilər")}
          </Link>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <Rocket className="h-6 w-6 text-accent" />
            {t("Launch siyahısı")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Ön qeydiyyat (coming soon) leadlərini idarə edin və dəvət edin.")}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {t("Yenilə")}
        </Button>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("Ad və ya e-poçt ilə axtar")}
              aria-label={t("Launch siyahısında axtar")}
              className="h-10 border-transparent bg-surfaceElevated pl-9 pr-9"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
                aria-label={t("Təmizlə")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput("");
                setStatus("all");
                setRole("all");
              }}
            >
              <X className="h-3.5 w-3.5" />
              {t("Filterləri sıfırla")}
            </Button>
          ) : null}
        </div>

        <div className="mt-3 space-y-2.5 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 hidden min-w-[88px] text-xs font-semibold text-foregroundMuted sm:inline">
              {t("Status")}
            </span>
            {STATUS_FILTERS.map((option) => (
              <FilterChip
                key={option.value}
                active={status === option.value}
                onClick={() => setStatus(option.value)}
              >
                {t(option.label)}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 hidden min-w-[88px] text-xs font-semibold text-foregroundMuted sm:inline">
              {t("Rol")}
            </span>
            {ROLE_FILTERS.map((option) => (
              <FilterChip
                key={option.value}
                active={role === option.value}
                onClick={() => setRole(option.value)}
              >
                {t(option.label)}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">
              {t("Leadlər")}
            </h2>
            <p className="text-xs text-foregroundMuted">
              {total === 0 ? `0 ${t("göstərilir")}` : `${rangeStart}–${rangeEnd} / ${total}`}
            </p>
          </div>
          {isFetching && !isLoading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              <RefreshCw className="h-3 w-3 animate-spin" />
              {t("Yenilənir")}
            </span>
          ) : null}
        </div>

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10">
              <Rocket className="h-7 w-7 text-danger" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-danger">
                {t("Yükləmə xətası")}
              </h3>
              <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
                {t("Şəbəkəni və admin sessiyasını yoxlayın, sonra yenidən cəhd edin.")}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4" />
              {t("Yenidən cəhd et")}
            </Button>
          </div>
        ) : (
          <div className="w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {[
                    t("Lead"),
                    t("Telefon"),
                    t("Rol"),
                    t("Mənbə"),
                    t("Status"),
                    t("Tarix"),
                    "",
                  ].map((label, index, arr) => (
                    <th
                      key={index}
                      className={`sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold text-foregroundMuted ${
                        index === 0 ? "rounded-tl-2xl" : ""
                      } ${index === arr.length - 1 ? "rounded-tr-2xl text-right" : ""}`}
                    >
                      {label || t("Əməliyyat")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-border">
                      {Array.from({ length: 7 }).map((__, colIndex) => (
                        <td key={colIndex} className="px-4 py-3.5">
                          <div
                            className="h-4 animate-pulse rounded bg-surfaceElevated"
                            style={{ width: `${45 + ((colIndex * 17) % 45)}%` }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  items.map((entry, index) => {
                    const busy = pendingId === entry.id && updateStatus.isPending;
                    return (
                      <tr
                        key={entry.id}
                        className={`border-b border-border transition-colors ${
                          index % 2 === 1
                            ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
                            : "bg-surface hover:bg-surfaceElevated/70"
                        }`}
                      >
                        <td className="px-4 py-3 align-middle">
                          <div className="flex min-w-[220px] items-center gap-3">
                            <Avatar name={entry.name} vip={false} size="sm" />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-foreground">
                                {entry.name || t("Adsız")}
                              </div>
                              <div className="truncate text-xs text-foregroundMuted">
                                {entry.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-foregroundMuted">
                          {entry.phone || "—"}
                        </td>
                        <td className="px-4 py-3 align-middle text-foreground">
                          {roleLabel(entry.role)}
                        </td>
                        <td className="px-4 py-3 align-middle text-foregroundMuted">
                          {entry.source || "—"}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-2">
                            <StatusPill status={entry.status} />
                            <SelectBox
                              value={entry.status}
                              disabled={busy}
                              onChange={(value) =>
                                onStatusSelect(entry, value as LaunchWaitlistStatus)
                              }
                              aria-label={t("Statusu dəyiş")}
                              className="h-8 w-[140px] text-xs"
                            >
                              {LAUNCH_WAITLIST_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {t(STATUS_LABEL[s])}
                                </option>
                              ))}
                            </SelectBox>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="min-w-[120px] text-xs text-foregroundMuted">
                            {formatDate(entry.created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("Detallara bax")}
                              onClick={() => setDetailFor(entry)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {!isLoading && items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
                  <Rocket className="h-7 w-7 text-accent" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-foreground">
                    {t("Lead tapılmadı")}
                  </h3>
                  <p className="mt-1 max-w-xs text-sm text-foregroundMuted">
                    {t("Filterləri dəyişərək yenidən yoxlayın.")}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {!isError && total > PAGE_SIZE ? (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3 sm:flex-row">
            <p className="text-sm text-foregroundMuted">
              {t("Səhifə")}{" "}
              <span className="font-semibold text-foreground">{page}</span> / {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canPrev || isFetching}
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("Əvvəlki")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canNext || isFetching}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
              >
                {t("Növbəti")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Detail dialog */}
      <Dialog open={detailFor !== null} onOpenChange={(open) => !open && setDetailFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailFor?.name || t("Adsız")}</DialogTitle>
            <DialogDescription>{t("Launch lead detalları")}</DialogDescription>
          </DialogHeader>
          {detailFor ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={detailFor.status} />
                <span className="inline-flex items-center rounded-full bg-surfaceElevated px-2.5 py-1 text-xs font-semibold text-foregroundMuted ring-1 ring-inset ring-border">
                  {roleLabel(detailFor.role)}
                </span>
                {detailFor.locale ? (
                  <span className="inline-flex items-center rounded-full bg-surfaceElevated px-2.5 py-1 text-xs font-semibold uppercase text-foregroundMuted ring-1 ring-inset ring-border">
                    {detailFor.locale}
                  </span>
                ) : null}
              </div>
              <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4">
                <div className="flex items-start gap-3 py-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-foregroundMuted" />
                  <div className="min-w-0 break-words text-sm text-foreground">
                    {detailFor.email}
                  </div>
                </div>
                <div className="flex items-start gap-3 py-3">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-foregroundMuted" />
                  <div className="min-w-0 break-words text-sm text-foreground">
                    {detailFor.phone || t("Telefon yoxdur")}
                  </div>
                </div>
                <div className="py-3 text-sm">
                  <div className="text-[11px] font-semibold text-foregroundMuted">
                    {t("Mənbə")}
                  </div>
                  <div className="mt-0.5 text-foreground">{detailFor.source || "—"}</div>
                </div>
                {detailFor.message ? (
                  <div className="py-3 text-sm">
                    <div className="text-[11px] font-semibold text-foregroundMuted">
                      {t("Mesaj")}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                      {detailFor.message}
                    </p>
                  </div>
                ) : null}
                <div className="py-3 text-xs text-foregroundMuted">
                  {t("Qeydiyyat")}: {formatDateTime(detailFor.created_at)}
                  {detailFor.updated_at
                    ? ` · ${t("Yeniləndi")}: ${formatDateTime(detailFor.updated_at)}`
                    : ""}
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDetailFor(null)}>
              {t("Bağla")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline confirm */}
      <Dialog open={declineFor !== null} onOpenChange={(open) => !open && setDeclineFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Lead-i imtina et?")}</DialogTitle>
            <DialogDescription>
              {t("Bu lead 'İmtina edib' kimi işarələnəcək. Statusu sonradan dəyişə bilərsiniz.")}
            </DialogDescription>
          </DialogHeader>
          {declineFor ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surfaceElevated px-3 py-2.5">
              <Avatar name={declineFor.name} vip={false} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {declineFor.name || t("Adsız")}
                </div>
                <div className="truncate text-xs text-foregroundMuted">{declineFor.email}</div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeclineFor(null)}>
              {t("Ləğv et")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (declineFor) applyStatus(declineFor, "declined");
                setDeclineFor(null);
              }}
            >
              {t("İmtina et")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
