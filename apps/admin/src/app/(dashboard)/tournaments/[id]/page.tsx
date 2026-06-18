"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Hourglass,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  PlayCircle,
  RotateCcw,
  Trash2,
  Trophy,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import {
  formatDateRange,
  formatMoney,
  useDeleteTournament,
  useRemoveTournamentEntry,
  useTournament,
  useTournamentEntries,
  useUpdateTournament,
  useUpdateTournamentEntry,
  type TournamentEntry,
  type TournamentEntryStatus,
  type TournamentStatus,
} from "@/lib/admin-tournaments";
import {
  ENTRY_STATUS_AZ,
  entryDotClass,
  entryPillClass,
  initials,
  isTerminalStatus,
  statusDotClass,
  statusLabel,
  statusPillClass,
} from "../lib";

interface ErrorWithStatus {
  status?: number;
  message?: string;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as ErrorWithStatus;
    if (e.message) return e.message;
  }
  return fallback;
}

type ConfirmAction =
  | { kind: "status"; status: TournamentStatus; label: string }
  | { kind: "cancel" }
  | { kind: "remove-squad"; entry: TournamentEntry }
  | { kind: "set-entry-status"; entry: TournamentEntry; status: TournamentEntryStatus; label: string }
  | null;

export default function TournamentDetailPage(): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: tournament, isLoading, isError } = useTournament(id);
  const { data: entries = [], isLoading: entriesLoading } = useTournamentEntries(id);

  const updateMut = useUpdateTournament();
  const cancelMut = useDeleteTournament();
  const removeMut = useRemoveTournamentEntry();
  const entryStatusMut = useUpdateTournamentEntry();

  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction>(null);

  const anyMutating =
    updateMut.isPending ||
    cancelMut.isPending ||
    removeMut.isPending ||
    entryStatusMut.isPending;

  if (isLoading) {
    return <DetailSkeleton />;
  }
  if (isError || !tournament) {
    return (
      <div className="space-y-5">
        <BackLink t={t} />
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-16 text-center">
          <XCircle className="h-8 w-8 text-danger" />
          <p className="text-sm font-medium text-foreground">{t("Turnir yüklənmədi.")}</p>
        </div>
      </div>
    );
  }

  const terminal = isTerminalStatus(tournament.status);
  const activeSquads = entries.filter((e) => e.status !== "withdrawn").length;

  const doUpdateStatus = async (next: TournamentStatus, label: string) => {
    try {
      await updateMut.mutateAsync({ id, data: { status: next } });
      toast.success(label, tournament.name);
    } catch (err) {
      toast.error(t("Status dəyişmədi"), getErrorMessage(err, t("Yenidən yoxlayın")));
    }
  };

  const doCancel = async () => {
    try {
      await cancelMut.mutateAsync(id);
      toast.success(t("Turnir ləğv edildi"), tournament.name);
      router.push("/tournaments");
    } catch (err) {
      toast.error(t("Ləğv alınmadı"), getErrorMessage(err, t("Yenidən yoxlayın")));
    }
  };

  const doRemove = async (entry: TournamentEntry) => {
    try {
      await removeMut.mutateAsync({ tournamentId: id, entryId: entry.id });
      toast.success(t("Komanda silindi"), entry.squad_name);
    } catch (err) {
      toast.error(t("Silmə alınmadı"), getErrorMessage(err, t("Yenidən yoxlayın")));
    }
  };

  const doSetEntryStatus = async (
    entry: TournamentEntry,
    status: TournamentEntryStatus,
    label: string,
  ) => {
    try {
      await entryStatusMut.mutateAsync({ tournamentId: id, entryId: entry.id, status });
      toast.success(label, entry.squad_name);
    } catch (err) {
      toast.error(t("Yeniləmə alınmadı"), getErrorMessage(err, t("Yenidən yoxlayın")));
    }
  };

  const confirm = async () => {
    if (!confirmAction) return;
    if (confirmAction.kind === "status") {
      await doUpdateStatus(confirmAction.status, confirmAction.label);
    } else if (confirmAction.kind === "cancel") {
      await doCancel();
    } else if (confirmAction.kind === "remove-squad") {
      await doRemove(confirmAction.entry);
    } else if (confirmAction.kind === "set-entry-status") {
      await doSetEntryStatus(confirmAction.entry, confirmAction.status, confirmAction.label);
    }
    setConfirmAction(null);
  };

  const isDanger =
    confirmAction?.kind === "cancel" ||
    confirmAction?.kind === "remove-squad" ||
    (confirmAction?.kind === "set-entry-status" && confirmAction.status === "disqualified");

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <BackLink t={t} />
        <Button asChild>
          <Link href={`/tournaments/${id}/edit`}>
            <Pencil className="h-4 w-4" />
            {t("Redaktə et")}
          </Link>
        </Button>
      </div>

      {/* Hero card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-ink text-accent">
              <Trophy className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[1.5rem] font-bold leading-tight  text-foreground">
                  {tournament.name}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(tournament.status)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(tournament.status)}`} />
                  {t(statusLabel(tournament.status))}
                </span>
              </div>
              <p className="mt-1 text-sm text-foregroundMuted">
                {tournament.sport_name ?? tournament.sport_slug ?? "—"}
              </p>
              {tournament.description ? (
                <p className="mt-3 max-w-2xl whitespace-pre-line text-sm text-foregroundMuted">
                  {tournament.description}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t("Tarixlər")} icon={CalendarClock}>
            {formatDateRange(tournament.starts_at, tournament.ends_at)}
          </Stat>
          <Stat label={t("Məkan")} icon={MapPin}>
            {tournament.venue_name ?? t("Onlayn / Təyin olunmayıb")}
          </Stat>
          <Stat label={t("İştirak haqqı")} icon={CircleDollarSign}>
            {formatMoney(tournament.entry_fee_minor, tournament.currency)}
          </Stat>
          <Stat label={t("Komandalar")} icon={Users}>
            <span className="font-display font-bold tabular-nums">
              {tournament.entries_count ?? activeSquads}
            </span>{" "}
            / {tournament.max_squads}
          </Stat>
          <Stat label={t("Komanda ölçüsü")} icon={Users}>
            {tournament.squad_size} {t("oyunçu")}
          </Stat>
          <Stat label={t("Qeydiyyat son tarixi")} icon={Hourglass}>
            {tournament.registration_deadline
              ? formatDateTime(tournament.registration_deadline)
              : "—"}
          </Stat>
        </div>
      </div>

      {/* Lifecycle actions */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <h2 className="font-display text-sm font-bold text-foreground">{t("Sürətli əməliyyatlar")}</h2>
        <p className="mt-0.5 text-xs text-foregroundMuted">
          {t("Turniri öz həyat dövrü boyunca irəli apar.")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={terminal || tournament.status !== "registration_open" || anyMutating}
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "registration_closed",
                label: t("Qeydiyyat bağlandı"),
              })
            }
          >
            <XCircle className="h-3.5 w-3.5" />
            {t("Qeydiyyatı bağla")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={
              terminal ||
              tournament.status === "in_progress" ||
              tournament.status === "registration_open" ||
              anyMutating
            }
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "registration_open",
                label: t("Qeydiyyat açıldı"),
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("Qeydiyyatı aç")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={terminal || tournament.status === "in_progress" || anyMutating}
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "in_progress",
                label: t("Turnir başladı"),
              })
            }
          >
            <PlayCircle className="h-3.5 w-3.5" />
            {t("Turniri başlat")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={terminal || anyMutating}
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "completed",
                label: t("Turnir tamamlandı"),
              })
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("Tamamlandı et")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={terminal || anyMutating}
            onClick={() => setConfirmAction({ kind: "cancel" })}
          >
            <XCircle className="h-3.5 w-3.5" />
            {t("Turniri ləğv et")}
          </Button>
        </div>
      </div>

      {/* Registered squads */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-sm font-bold text-foreground">
              {t("Qeydiyyatlı komandalar")}
            </h2>
            <p className="text-xs text-foregroundMuted">
              {entriesLoading
                ? t("Yüklənir…")
                : `${activeSquads} ${t("aktiv")} · ${entries.length} ${t("ümumi")}`}
            </p>
          </div>
        </div>

        <div className="divide-y divide-border">
          {entriesLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-surfaceElevated" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10">
                <Users className="h-6 w-6 text-accent" />
              </div>
              <p className="text-sm text-foregroundMuted">
                {t("Hələ heç bir komanda qeydiyyatdan keçməyib.")}
              </p>
            </div>
          ) : (
            entries.map((entry) => {
              const isWithdrawn = entry.status === "withdrawn";
              const isConfirmed = entry.status === "confirmed";
              const isDisqualified = entry.status === "disqualified";
              return (
                <div
                  key={entry.id}
                  className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surfaceElevated/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-accent">
                      {entry.captain_photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.captain_photo_url}
                          alt={entry.captain_display_name}
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        initials(entry.captain_display_name)
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {entry.squad_name}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${entryPillClass(entry.status)}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${entryDotClass(entry.status)}`} />
                          {t(ENTRY_STATUS_AZ[entry.status])}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-foregroundMuted">
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="h-3 w-3" />
                          {t("Kapitan")}: {entry.captain_display_name}
                        </span>
                        {entry.captain_email ? (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {entry.captain_email}
                          </span>
                        ) : null}
                      </div>
                      {entry.player_names.length > 0 ? (
                        <p className="mt-1 truncate text-xs text-foregroundMuted">
                          {t("Oyunçular")}: {entry.player_names.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!isConfirmed && !isWithdrawn ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={anyMutating}
                        onClick={() =>
                          setConfirmAction({
                            kind: "set-entry-status",
                            entry,
                            status: "confirmed",
                            label: t("Komanda təsdiqləndi"),
                          })
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("Təsdiqlə")}
                      </Button>
                    ) : null}
                    {!isDisqualified && !isWithdrawn ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={anyMutating}
                        onClick={() =>
                          setConfirmAction({
                            kind: "set-entry-status",
                            entry,
                            status: "disqualified",
                            label: t("Komanda diskvalifikasiya edildi"),
                          })
                        }
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {t("Diskvalifikasiya")}
                      </Button>
                    ) : null}
                    {!isWithdrawn ? (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={anyMutating}
                        onClick={() => setConfirmAction({ kind: "remove-squad", entry })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("Sil")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => (open ? null : setConfirmAction(null))}
        title={confirmTitle(confirmAction, t)}
        description={confirmDescription(confirmAction, t)}
        contentClassName="max-w-md"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmAction(null)} disabled={anyMutating}>
            {t("Bağla")}
          </Button>
          <Button
            variant={isDanger ? "danger" : "primary"}
            onClick={() => void confirm()}
            disabled={anyMutating}
          >
            {anyMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Təsdiqlə")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function confirmTitle(action: ConfirmAction, t: (s: string) => string): string {
  if (action?.kind === "cancel") return t("Turniri ləğv et?");
  if (action?.kind === "remove-squad") return t("Komandanı sil?");
  if (action?.kind === "set-entry-status") {
    return action.status === "confirmed" ? t("Komandanı təsdiqlə?") : t("Komandanı diskvalifikasiya et?");
  }
  return t("Status dəyişikliyini təsdiqlə");
}

function confirmDescription(action: ConfirmAction, t: (s: string) => string): string {
  if (action?.kind === "cancel") {
    return t("Turnir ləğv edilmiş kimi işarələnəcək. Bu geri qaytarıla bilməz.");
  }
  if (action?.kind === "remove-squad") {
    return `${action.entry.squad_name} ${t("geri çəkiləcək. Kapitana bildiriş göndəriləcək.")}`;
  }
  if (action?.kind === "set-entry-status") {
    return action.status === "confirmed"
      ? `${action.entry.squad_name} ${t("bracket üçün təsdiqlənmiş kimi işarələnəcək.")}`
      : `${action.entry.squad_name} ${t("diskvalifikasiya ediləcək və bracketdən çıxarılacaq.")}`;
  }
  if (action?.kind === "status") {
    return `${t("Statusu dəyişdir")}: ${action.label}`;
  }
  return "";
}

function BackLink({ t }: { t: (s: string) => string }): React.JSX.Element {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href="/tournaments">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("Bütün turnirlər")}
      </Link>
    </Button>
  );
}

function Stat({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="bg-surface p-4">
      <div className="flex items-center gap-1.5 text-foregroundMuted">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[10px] font-semibold  ">{label}</p>
      </div>
      <p className="mt-1.5 text-sm font-medium text-foreground">{children}</p>
    </div>
  );
}

function DetailSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-surfaceElevated" />
      <div className="h-44 animate-pulse rounded-2xl bg-surfaceElevated" />
      <div className="h-28 animate-pulse rounded-2xl bg-surfaceElevated" />
      <div className="h-64 animate-pulse rounded-2xl bg-surfaceElevated" />
    </div>
  );
}
