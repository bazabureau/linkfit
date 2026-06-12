"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  Hourglass,
  MapPin,
  Pencil,
  PlayCircle,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  TOURNAMENT_STATUS_LABEL,
  formatDateRange,
  formatMoney,
  useDeleteTournament,
  useRemoveTournamentEntry,
  useTournament,
  useTournamentEntries,
  useUpdateTournament,
  type TournamentEntry,
  type TournamentStatus,
} from "@/lib/admin-tournaments";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "neutral";

function statusVariant(status: TournamentStatus): BadgeVariant {
  switch (status) {
    case "registration_open":
      return "success";
    case "in_progress":
      return "info";
    case "registration_closed":
      return "warning";
    case "completed":
      return "neutral";
    case "cancelled":
      return "error";
    default:
      return "default";
  }
}

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

export default function TournamentDetailPage(): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: tournament, isLoading, isError } = useTournament(id);
  const { data: entries = [], isLoading: entriesLoading } = useTournamentEntries(id);

  const updateMut = useUpdateTournament();
  const cancelMut = useDeleteTournament();
  const removeMut = useRemoveTournamentEntry();

  const [confirmAction, setConfirmAction] = React.useState<
    | { kind: "status"; status: TournamentStatus; label: string }
    | { kind: "cancel" }
    | { kind: "remove-squad"; entry: TournamentEntry }
    | null
  >(null);

  if (isLoading) {
    return (
      <Card className="p-6 text-sm text-foregroundMuted">Loading tournament…</Card>
    );
  }
  if (isError || !tournament) {
    return (
      <Card className="p-6 text-sm text-danger">Could not load tournament.</Card>
    );
  }

  const isTerminal =
    tournament.status === "completed" || tournament.status === "cancelled";

  const doUpdateStatus = async (next: TournamentStatus, label: string) => {
    try {
      await updateMut.mutateAsync({ id, data: { status: next } });
      toast.success(label, tournament.name);
    } catch (err) {
      toast.error("Status change failed", getErrorMessage(err, "Could not update"));
    }
  };

  const doCancel = async () => {
    try {
      await cancelMut.mutateAsync(id);
      toast.success("Tournament cancelled", tournament.name);
      router.push("/tournaments");
    } catch (err) {
      toast.error("Cancel failed", getErrorMessage(err, "Could not cancel"));
    }
  };

  const doRemove = async (entry: TournamentEntry) => {
    try {
      await removeMut.mutateAsync({ tournamentId: id, entryId: entry.id });
      toast.success("Squad removed", entry.squad_name);
    } catch (err) {
      toast.error("Remove failed", getErrorMessage(err, "Could not remove squad"));
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
    }
    setConfirmAction(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/tournaments">
            <ArrowLeft className="h-3.5 w-3.5" />
            All tournaments
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/tournaments/${id}/edit`}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Link>
        </Button>
      </div>

      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">
                {tournament.name}
              </h1>
              <Badge variant={statusVariant(tournament.status)}>
                {TOURNAMENT_STATUS_LABEL[tournament.status]}
              </Badge>
            </div>
            {tournament.description ? (
              <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-foregroundMuted">
                {tournament.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Sport" icon={Users}>
            {tournament.sport_name ?? tournament.sport_slug ?? "—"}
          </Stat>
          <Stat label="Dates" icon={Calendar}>
            {formatDateRange(tournament.starts_at, tournament.ends_at)}
          </Stat>
          <Stat label="Venue" icon={MapPin}>
            {tournament.venue_name ?? "Online / TBD"}
          </Stat>
          <Stat label="Entry fee" icon={CircleDollarSign}>
            {formatMoney(tournament.entry_fee_minor, tournament.currency)}
          </Stat>
          <Stat label="Capacity" icon={Users}>
            {(tournament.entries_count ?? entries.filter((e) => e.status !== "withdrawn").length)}
            {" / "}
            {tournament.max_squads} squads
          </Stat>
          <Stat label="Squad size" icon={Users}>
            {tournament.squad_size} players
          </Stat>
          <Stat label="Registration deadline" icon={Hourglass}>
            {tournament.registration_deadline
              ? new Date(tournament.registration_deadline).toLocaleString()
              : "—"}
          </Stat>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-foreground">Quick actions</h2>
        <p className="text-sm text-foregroundMuted">
          Move the tournament forward through its lifecycle.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isTerminal || tournament.status !== "registration_open"}
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "registration_closed",
                label: "Registration closed",
              })
            }
          >
            <XCircle className="h-3.5 w-3.5" />
            Close registration
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={
              isTerminal ||
              tournament.status === "in_progress" ||
              tournament.status === "registration_open"
            }
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "registration_open",
                label: "Registration open",
              })
            }
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Open registration
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={
              isTerminal ||
              tournament.status === "in_progress"
            }
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "in_progress",
                label: "Tournament started",
              })
            }
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Start tournament
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={isTerminal}
            onClick={() =>
              setConfirmAction({
                kind: "status",
                status: "completed",
                label: "Tournament completed",
              })
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark complete
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={isTerminal}
            onClick={() => setConfirmAction({ kind: "cancel" })}
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel tournament
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Registered squads
            </h2>
            <p className="text-sm text-foregroundMuted">
              {entriesLoading
                ? "Loading…"
                : `${entries.filter((e) => e.status !== "withdrawn").length} active · ${entries.length} total`}
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {!entriesLoading && entries.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-surfaceElevated p-6 text-center text-sm text-foregroundMuted">
              No squads have registered yet.
            </p>
          )}
          {entries.map((entry) => {
            const isWithdrawn = entry.status === "withdrawn";
            return (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surfaceElevated p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {entry.squad_name}
                    </p>
                    <Badge
                      variant={
                        entry.status === "confirmed"
                          ? "success"
                          : entry.status === "pending"
                            ? "default"
                            : "neutral"
                      }
                    >
                      {entry.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-foregroundMuted">
                    Captain: {entry.captain_display_name}
                    {entry.player_names.length > 0 && (
                      <>
                        {" · "}
                        Players: {entry.player_names.join(", ")}
                      </>
                    )}
                  </p>
                </div>
                {!isWithdrawn && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() =>
                      setConfirmAction({ kind: "remove-squad", entry })
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => (open ? null : setConfirmAction(null))}
        title={
          confirmAction?.kind === "cancel"
            ? "Cancel tournament?"
            : confirmAction?.kind === "remove-squad"
              ? "Remove squad?"
              : "Confirm status change"
        }
        description={
          confirmAction?.kind === "cancel"
            ? "Marks the tournament as cancelled. This can't be undone."
            : confirmAction?.kind === "remove-squad"
              ? `${confirmAction.entry.squad_name} will be withdrawn. Captain will be notified.`
              : confirmAction?.kind === "status"
                ? `Move to "${TOURNAMENT_STATUS_LABEL[confirmAction.status]}"?`
                : ""
        }
      >
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setConfirmAction(null)}
            disabled={
              updateMut.isPending || cancelMut.isPending || removeMut.isPending
            }
          >
            Cancel
          </Button>
          <Button
            variant={
              confirmAction?.kind === "cancel" ||
              confirmAction?.kind === "remove-squad"
                ? "danger"
                : "primary"
            }
            onClick={() => void confirm()}
            disabled={
              updateMut.isPending || cancelMut.isPending || removeMut.isPending
            }
          >
            Confirm
          </Button>
        </div>
      </Dialog>
    </div>
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
    <div className="rounded-xl border border-border bg-surfaceElevated p-4">
      <div className="flex items-center gap-2 text-foregroundMuted">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[11px] uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-1.5 text-sm font-medium text-foreground">{children}</p>
    </div>
  );
}
