"use client";

/**
 * Game detail — premium moderation surface: hero summary, host card,
 * manual status transitions, participants table and an audit timeline,
 * wired to the existing admin-games hooks (cancel / delete / update).
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import {
  ArrowLeft,
  CalendarClock,
  Gauge,
  Hash,
  Loader2,
  MapPin,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime, formatTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
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
import {
  Avatar,
  CapacityBar,
  Field,
  canCancel,
  canDelete,
  formatDuration,
  participantLabel,
  participantPillClass,
  sportLabel,
  statusDotClass,
  statusLabel,
  statusPillClass,
  visibilityLabel,
  type ParticipantStatus,
} from "../lib";

const STATUS_TRANSITIONS: Array<{ value: GameStatus; label: string }> = [
  { value: "open", label: "Açıq" },
  { value: "full", label: "Dolu" },
  { value: "completed", label: "Bitib" },
  { value: "cancelled", label: "Ləğv" },
];

const ACTION_LABELS: Record<string, string> = {
  "admin.game.cancel": "Admin tərəfindən ləğv edildi",
  "admin.game.update": "Admin tərəfindən yeniləndi",
  "admin.game.delete": "Admin tərəfindən silindi",
};

export default function GameDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const { data: game, isLoading, isError, refetch } = useAdminGameDetail(id);

  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState("");

  const cancelMut = useCancelAdminGame({
    onSuccess: () => {
      toast.success(t("Oyun ləğv edildi"), t("İştirakçılar bildiriş alacaq."));
      void refetch();
    },
    onError: (err) => toast.error(t("Ləğv alınmadı"), err.message),
  });
  const deleteMut = useDeleteAdminGame({
    onSuccess: () => {
      toast.success(t("Oyun silindi"), t("Oyun siyahılardan gizlədildi."));
      router.push("/games");
    },
    onError: (err) => toast.error(t("Silmək alınmadı"), err.message),
  });
  const updateMut = useUpdateAdminGame({
    onSuccess: () => {
      toast.success(t("Oyun yeniləndi"), t("Status dəyişdirildi."));
      void refetch();
    },
    onError: (err) => toast.error(t("Yeniləmə alınmadı"), err.message),
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !game) {
    return (
      <div className="space-y-5">
        <BackLink />
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface px-6 py-20 text-center shadow-card">
          <h2 className="font-display text-base font-bold text-danger">
            {t("Oyun yüklənmədi")}
          </h2>
          <p className="max-w-xs text-sm text-foregroundMuted">
            {t("API bağlantısını və admin sessiyasını yoxlayın.")}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            {t("Yenidən cəhd et")}
          </Button>
        </div>
      </div>
    );
  }

  const closable = canCancel(game.status);
  const deletable = canDelete(game.status);
  const distance = distanceFromBakuKm(game.lat, game.lng);

  return (
    <div className="space-y-5">
      <BackLink />

      {/* Hero ──────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-border bg-background text-3xl">
              {sportIcon(game.sport_slug)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[1.4rem] font-bold capitalize  text-foreground">
                  {t(sportLabel(game.sport_slug))} {t("oyunu")}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(game.status)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(game.status)}`} />
                  {t(statusLabel(game.status))}
                </span>
                {game.deleted_at ? (
                  <span className="inline-flex items-center rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold   text-danger">
                    {t("Silinib")}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-foregroundMuted">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {formatDate(game.starts_at)} · {formatTime(game.starts_at)} ·{" "}
                  {formatDuration(game.duration_minutes)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {game.venue_name ?? t("Sərbəst lokasiya")} ({distance} km {t("mərkəzdən")})
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  <code className="text-xs">{game.id.slice(0, 8)}</code>
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={!closable || cancelMut.isPending}
              onClick={() => {
                setCancelReason("");
                setConfirmCancel(true);
              }}
            >
              <X className="h-3.5 w-3.5" />
              {t("Məcburi ləğv")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!deletable || deleteMut.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("Sil")}
            </Button>
          </div>
        </div>

        {/* Metrics strip */}
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
          <Metric icon={Users} label={t("Tutum")}>
            <CapacityBar confirmed={game.participants_count} capacity={game.capacity} />
          </Metric>
          <Metric icon={Sparkles} label={t("Görünüş")}>
            <span className="text-sm font-semibold text-foreground">
              {visibilityLabel(game.visibility)}
            </span>
          </Metric>
          <Metric icon={Gauge} label={t("Elo aralığı")}>
            <span className="font-display text-sm font-bold tabular-nums text-foreground">
              {game.skill_min_elo ?? "—"} – {game.skill_max_elo ?? "—"}
            </span>
          </Metric>
        </div>
      </div>

      {/* Host + status transition ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card lg:col-span-2">
          <h2 className="text-[11px] font-semibold   text-foregroundMuted">
            {t("Host")}
          </h2>
          <div className="mt-3 flex items-center gap-3">
            <Avatar name={game.host_display_name} photoUrl={game.host_photo_url} size={48} />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">
                {game.host_display_name}
              </div>
              <code className="text-xs text-foregroundMuted">{game.host_user_id}</code>
            </div>
          </div>
          {game.notes ? (
            <div className="mt-4 rounded-xl border border-border bg-surfaceElevated/60 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold   text-foregroundMuted">
                <StickyNote className="h-3.5 w-3.5" />
                {t("Qeyd")}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm text-foreground">{game.notes}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold   text-foregroundMuted">
            <Sparkles className="h-3.5 w-3.5" />
            {t("Status dəyişimi")}
          </div>
          <p className="mt-2 text-xs text-foregroundMuted">
            {t("Yalnız data düzəlişi üçün. İştirakçıları xəbərdar etmək üçün qırmızı ləğv düyməsini istifadə edin.")}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {STATUS_TRANSITIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={opt.value === game.status ? "primary" : "secondary"}
                size="sm"
                disabled={
                  opt.value === game.status || updateMut.isPending || game.deleted_at !== null
                }
                onClick={() => updateMut.mutate({ id: game.id, data: { status: opt.value } })}
              >
                {t(opt.label)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Participants ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-display text-sm font-bold text-foreground">{t("İştirakçılar")}</h2>
          <span className="font-display text-sm font-bold tabular-nums text-foregroundMuted">
            {game.participants.length}
          </span>
        </div>
        {game.participants.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-foregroundMuted">
            {t("Hələ kimsə qoşulmayıb.")}
          </p>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="h-11 bg-surfaceElevated px-5 text-left text-[11px] font-semibold   text-foregroundMuted">
                    {t("Oyunçu")}
                  </th>
                  <th className="h-11 bg-surfaceElevated px-5 text-left text-[11px] font-semibold   text-foregroundMuted">
                    {t("İstifadəçi ID")}
                  </th>
                  <th className="h-11 bg-surfaceElevated px-5 text-left text-[11px] font-semibold   text-foregroundMuted">
                    {t("Qoşulub")}
                  </th>
                  <th className="h-11 bg-surfaceElevated px-5 text-right text-[11px] font-semibold   text-foregroundMuted">
                    {t("Status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {game.participants.map((p, index) => (
                  <tr
                    key={p.user_id}
                    className={`border-b border-border ${
                      index % 2 === 1 ? "bg-surfaceElevated/40" : "bg-surface"
                    }`}
                  >
                    <td className="px-5 py-3 align-middle">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={p.display_name} photoUrl={p.photo_url} size={30} />
                        <span className="font-medium text-foreground">{p.display_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <code className="text-xs text-foregroundMuted">{p.user_id.slice(0, 8)}</code>
                    </td>
                    <td className="px-5 py-3 align-middle tabular-nums text-foregroundMuted">
                      {formatDateTime(p.joined_at)}
                    </td>
                    <td className="px-5 py-3 text-right align-middle">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${participantPillClass(p.status as ParticipantStatus)}`}
                      >
                        {t(participantLabel(p.status as ParticipantStatus))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit timeline ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-foreground">
          {t("Audit tarixçəsi")}{" "}
          <span className="text-foregroundMuted">({game.status_changes.length})</span>
        </h2>
        {game.status_changes.length === 0 ? (
          <p className="mt-3 text-sm text-foregroundMuted">{t("Hələ admin əməliyyatı yoxdur.")}</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {game.status_changes.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </div>

      {/* Dialogs ───────────────────────────────────────────────────────── */}
      <Dialog
        open={confirmCancel}
        onOpenChange={(open) => !open && setConfirmCancel(false)}
        title={t("Oyunu ləğv et?")}
        description={t("Bütün təsdiqli iştirakçılar bildiriş alacaq. İstəsəniz səbəb qeyd edin.")}
        contentClassName="max-w-lg"
      >
        <div className="space-y-4">
          <Field label={t("Səbəb")} hint={t("Məsələn: məkan texniki səbəbə görə bağlıdır")}>
            <Textarea
              placeholder={t("Səbəb qeyd et")}
              value={cancelReason}
              maxLength={500}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              {t("Geri")}
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
              {cancelMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("Ləğv et")}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
        title={t("Oyunu sil?")}
        description={t("Oyun default siyahılardan gizlənəcək, audit və database qeydi saxlanacaq.")}
        contentClassName="max-w-lg"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t("Geri")}
          </Button>
          <Button
            variant="danger"
            disabled={deleteMut.isPending}
            onClick={() => {
              deleteMut.mutate({ id: game.id });
              setConfirmDelete(false);
            }}
          >
            {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("Sil")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ───────────────────────── Subcomponents ─────────────────────────

function BackLink(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Link
      href="/games"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-foregroundMuted transition hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t("Oyunlara qayıt")}
    </Link>
  );
}

function Metric({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Users;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold   text-foregroundMuted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 flex items-center">{children}</div>
    </div>
  );
}

function AuditEntry({ entry }: { entry: AdminGameAuditEntry }): React.JSX.Element {
  const { t } = useI18n();
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const metaPreview = formatMetadata(entry.metadata);
  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-accent bg-surface" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-foreground">{t(label)}</span>
        <span className="text-xs text-foregroundMuted">
          {entry.actor_display_name ?? t("sistem")} · {formatDateTime(entry.created_at)}
        </span>
      </div>
      {metaPreview ? <p className="mt-1 text-xs text-foregroundMuted">{metaPreview}</p> : null}
    </li>
  );
}

function formatMetadata(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") parts.push(`${k}=${JSON.stringify(v)}`);
    else parts.push(`${k}=${String(v)}`);
  }
  return parts.join(" · ");
}

function DetailSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div className="h-4 w-32 animate-pulse rounded bg-surfaceElevated" />
      <div className="h-44 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface lg:col-span-2" />
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface" />
      </div>
      <div className="h-48 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="h-32 animate-pulse rounded-2xl border border-border bg-surface" />
    </div>
  );
}
