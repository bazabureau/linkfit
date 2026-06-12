"use client";

/**
 * Game detail — hero + host card + participants + audit timeline + the
 * primary moderation actions (force-cancel, soft-delete, manual status
 * transition via the existing PATCH /admin/games/:id endpoint).
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Hash,
  MapPin,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  distanceFromBakuKm,
  sportIcon,
  useAdminGameDetail,
  useCancelAdminGame,
  useDeleteAdminGame,
  useUpdateAdminGame,
  type AdminGameAuditEntry,
  type GameStatus,
} from "@/lib/admin-games";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Avatar,
  CapacityBar,
  StatusBadge,
} from "../GamesTable";

const STATUS_TRANSITIONS: { value: GameStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "full", label: "Full" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function GameDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const toast = useToast();
  const { data: game, isLoading, isError, refetch } = useAdminGameDetail(id);

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const cancelMut = useCancelAdminGame({
    onSuccess: () => {
      toast.success("Cancelled", "Players have been notified.");
      void refetch();
    },
    onError: (err) => toast.error("Cancel failed", err.message),
  });
  const deleteMut = useDeleteAdminGame({
    onSuccess: () => {
      toast.success("Deleted", "Game soft-deleted.");
      router.push("/games");
    },
    onError: (err) => toast.error("Delete failed", err.message),
  });
  const updateMut = useUpdateAdminGame({
    onSuccess: () => {
      toast.success("Updated", "Game record saved.");
      void refetch();
    },
    onError: (err) => toast.error("Update failed", err.message),
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !game) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent>
            <p className="text-sm text-danger">Failed to load game.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canCancel = game.status === "open" || game.status === "full";
  const canDelete = game.status === "cancelled" || game.status === "completed";
  const distance = distanceFromBakuKm(game.lat, game.lng);

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Hero ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-3xl">
              {sportIcon(game.sport_slug)}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl capitalize">
                  {game.sport_slug.replace(/_/g, " ")} game
                </CardTitle>
                <StatusBadge status={game.status} />
                {game.deleted_at ? (
                  <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] uppercase tracking-wider text-danger">
                    Soft-deleted
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-foregroundMuted">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {formatDateTime(game.starts_at)} · {game.duration_minutes} min
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {game.venue_name ?? "Free location"} ({distance} km from centre)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  <code className="text-xs">{game.id.slice(0, 8)}</code>
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={!canCancel || cancelMut.isPending}
              onClick={() => {
                setCancelReason("");
                setConfirmCancel(true);
              }}
            >
              <X className="h-3.5 w-3.5" /> Force-cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canDelete || deleteMut.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Soft-delete
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-0 md:grid-cols-3">
          <Metric label="Capacity">
            <CapacityBar
              confirmed={game.participants_count}
              capacity={game.capacity}
            />
          </Metric>
          <Metric label="Visibility">
            <span className="text-sm text-foreground capitalize">{game.visibility}</span>
          </Metric>
          <Metric label="Elo window">
            <span className="text-sm text-foreground tabular-nums">
              {game.skill_min_elo ?? "—"} – {game.skill_max_elo ?? "—"}
            </span>
          </Metric>
        </CardContent>
      </Card>

      {/* Host + status transition ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wider text-foregroundMuted">
              Host
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <Avatar name={game.host_display_name} photoUrl={game.host_photo_url} size={48} />
              <div className="flex flex-col">
                <span className="text-base font-medium text-foreground">
                  {game.host_display_name}
                </span>
                <code className="text-xs text-foregroundMuted">{game.host_user_id}</code>
              </div>
            </div>
            {game.notes ? (
              <div className="mt-4 rounded-lg border border-border bg-surfaceElevated/40 p-3 text-sm text-foreground">
                <span className="text-[11px] uppercase tracking-wider text-foregroundMuted">
                  Notes
                </span>
                <p className="mt-1 whitespace-pre-line">{game.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wider text-foregroundMuted">
              Manual status transition
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-3 text-xs text-foregroundMuted">
              Use sparingly — for data fixes only. Cancel via the red button to
              also notify players.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_TRANSITIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={opt.value === game.status ? "primary" : "secondary"}
                  size="sm"
                  disabled={opt.value === game.status || updateMut.isPending || game.deleted_at !== null}
                  onClick={() => updateMut.mutate({ id: game.id, data: { status: opt.value } })}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {opt.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Participants ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider text-foregroundMuted">
            Participants ({game.participants.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {game.participants.length === 0 ? (
            <div className="p-6 text-sm text-foregroundMuted">No one has joined yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {game.participants.map((p) => (
                  <TableRow key={p.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar name={p.display_name} photoUrl={p.photo_url} />
                        <span className="text-sm text-foreground">{p.display_name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-foregroundMuted">{p.user_id.slice(0, 8)}</code>
                    </TableCell>
                    <TableCell className="text-sm text-foregroundMuted tabular-nums">
                      {formatDateTime(p.joined_at)}
                    </TableCell>
                    <TableCell>
                      <ParticipantBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Audit timeline ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider text-foregroundMuted">
            Audit timeline ({game.status_changes.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {game.status_changes.length === 0 ? (
            <p className="text-sm text-foregroundMuted">No admin actions recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {game.status_changes.map((entry) => (
                <AuditEntry key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Dialogs ───────────────────────────────────────────────────────── */}
      <Dialog open={confirmCancel} onOpenChange={(open) => !open && setConfirmCancel(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force-cancel game?</DialogTitle>
            <DialogDescription>
              All confirmed participants will receive a notification. Optionally
              include a reason so they know why.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="e.g. Court flooded"
            value={cancelReason}
            maxLength={500}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={cancelMut.isPending}
              onClick={() => {
                const reason = cancelReason.trim();
                cancelMut.mutate({ id: game.id, reason: reason || undefined });
                setConfirmCancel(false);
              }}
            >
              {cancelMut.isPending ? "Cancelling…" : "Yes, cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft-delete game?</DialogTitle>
            <DialogDescription>
              Hidden from listings; the underlying record stays in the database
              with `deleted_at` set.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={deleteMut.isPending}
              onClick={() => {
                deleteMut.mutate({ id: game.id });
                setConfirmDelete(false);
              }}
            >
              {deleteMut.isPending ? "Deleting…" : "Yes, delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────── Subcomponents ─────────────────────────

function BackLink(): JSX.Element {
  return (
    <Link
      href="/games"
      className="inline-flex items-center gap-1 text-sm text-foregroundMuted hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to games
    </Link>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated/40 p-3">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-foregroundMuted">
        {label}
      </div>
      {children}
    </div>
  );
}

function ParticipantBadge({
  status,
}: {
  status: "confirmed" | "cancelled" | "no_show" | "played";
}): JSX.Element {
  switch (status) {
    case "confirmed":
      return (
        <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
          Confirmed
        </span>
      );
    case "played":
      return (
        <span className="inline-flex items-center rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
          Played
        </span>
      );
    case "no_show":
      return (
        <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
          No-show
        </span>
      );
    case "cancelled":
    default:
      return (
        <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
          Cancelled
        </span>
      );
  }
}

function AuditEntry({ entry }: { entry: AdminGameAuditEntry }): JSX.Element {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const metaPreview = formatMetadata(entry.metadata);
  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-accent bg-surface" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-foregroundMuted">
          by {entry.actor_display_name ?? "system"} · {formatDateTime(entry.created_at)}
        </span>
      </div>
      {metaPreview ? (
        <p className="mt-1 text-xs text-foregroundMuted">{metaPreview}</p>
      ) : null}
    </li>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "admin.games.cancel": "Force-cancelled by admin",
  "admin.games.update": "Updated by admin",
  "admin.games.soft_delete": "Soft-deleted by admin",
};

function formatMetadata(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") parts.push(`${k}=${JSON.stringify(v)}`);
    else parts.push(`${k}=${String(v)}`);
  }
  return parts.join(" · ");
}

function DetailSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="h-4 w-32 animate-pulse rounded bg-border" />
      <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface md:col-span-2" />
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface" />
      </div>
      <div className="h-48 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="h-32 animate-pulse rounded-2xl border border-border bg-surface" />
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
