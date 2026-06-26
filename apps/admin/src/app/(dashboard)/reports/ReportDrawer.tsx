"use client";

import * as React from "react";
import {
  ArrowUpRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Hash,
  History,
  Layers,
  Loader2,
  ShieldAlert,
  ShieldOff,
  StickyNote,
  User,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import {
  useDeactivateUser,
  useModerationUser,
  useReportDetail,
  useReviewReport,
  type ReportTargetSummary,
  type ReportTargetUserRef,
} from "@/lib/admin-reports";
import {
  REPORT_STATUS_AZ,
  TargetIcon,
  formatRelative,
  reasonLabel,
  reporterLabel,
  statusDotClass,
  statusPillClass,
  targetHref,
  targetLabel,
  type AdminReportRow,
} from "./lib";

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Hash;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surfaceElevated text-foregroundMuted">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold   text-foregroundMuted">
          {label}
        </div>
        <div className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</div>
      </div>
    </div>
  );
}

/** Display name + email for an embedded actor on a target preview. */
function ActorLine({ actor }: { actor: ReportTargetUserRef }): React.JSX.Element {
  return (
    <span className="text-foreground">
      {actor.display_name || actor.email || actor.id}
      {actor.email && actor.display_name ? (
        <span className="ml-1 text-xs text-foregroundMuted">· {actor.email}</span>
      ) : null}
    </span>
  );
}

/** Card summarising the reported content (varies by `target.kind`). */
function TargetPreview({ target }: { target: ReportTargetSummary }): React.JSX.Element {
  const { t } = useI18n();
  const actor =
    target.host ?? target.sender ?? target.author ?? target.actor ?? target.owner ?? null;
  const text = target.body ?? target.caption ?? target.notes ?? null;

  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  if (actor) facts.push({ label: t("Müəllif"), value: <ActorLine actor={actor} /> });
  if (target.venue) facts.push({ label: t("Məkan"), value: target.venue.name ?? "—" });
  if (target.status) facts.push({ label: t("Status"), value: t(String(target.status)) });
  if (target.type) facts.push({ label: t("Tip"), value: String(target.type) });
  if (typeof target.rating === "number")
    facts.push({ label: t("Reytinq"), value: `${target.rating} ★` });
  if (target.court_name) facts.push({ label: t("Kort"), value: target.court_name });
  if (target.starts_at)
    facts.push({ label: t("Başlama"), value: formatDateTime(target.starts_at) });
  if (target.created_at)
    facts.push({ label: t("Yaradılıb"), value: formatDateTime(target.created_at) });

  return (
    <div className="my-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="text-[11px] font-semibold   text-foregroundMuted">
        {t("Şikayət olunan məzmun")}
      </div>
      {facts.length > 0 ? (
        <dl className="mt-2 grid gap-1.5">
          {facts.map((fact, index) => (
            <div key={index} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="shrink-0 text-foregroundMuted">{fact.label}</dt>
              <dd className="min-w-0 break-words text-right font-medium text-foreground">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {text ? (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-surfaceElevated px-3 py-2 text-sm text-foreground">
          {text}
        </p>
      ) : null}
      {target.url || target.media_url ? (
        <a
          href={(target.url ?? target.media_url) as string}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
        >
          {t("Medianı aç")}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
      {!facts.length && !text && !target.url && !target.media_url ? (
        <p className="mt-2 text-sm text-foregroundMuted">{t("Önizləmə mövcud deyil.")}</p>
      ) : null}
    </div>
  );
}

export function ReportDrawer({
  report,
  open,
  onClose,
}: {
  report: AdminReportRow | null;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const toast = useToast();
  const review = useReviewReport();
  const deactivate = useDeactivateUser();
  const [notes, setNotes] = React.useState("");
  const [shown, setShown] = React.useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = React.useState(false);

  // Full detail (target preview + same-target context + audit) for the open row.
  const detailQuery = useReportDetail(open ? (report?.id ?? null) : null);
  const detail = detailQuery.data;

  // Moderation profile for a reported user, so we can show context + deactivate.
  const isUserTarget = report?.target_kind === "user";
  const moderationUser = useModerationUser(
    open && isUserTarget ? (report?.target_id ?? null) : null,
  );

  React.useEffect(() => {
    setNotes(report?.notes ?? "");
  }, [report?.id, report?.notes]);

  React.useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    return undefined;
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !report) return null;

  const href = targetHref(report.target_kind, report.target_id);
  const hasLink = href !== "#";
  const pending = report.status === "pending";

  const target = detail?.target ?? null;
  const samePending = detail?.same_target_pending_count ?? 0;
  const recent = detail?.recent_same_target_reports ?? [];
  const audit = detail?.audit ?? [];

  // Already-deactivated state comes from either the moderation profile or the
  // resolved user target blob.
  const deactivated = Boolean(
    moderationUser.data?.deleted_at ?? (target?.kind === "user" ? target.deleted_at : null),
  );
  const targetIsStaff =
    moderationUser.data?.admin_role === "admin" ||
    moderationUser.data?.admin_role === "moderator";

  const submit = async (status: "reviewed" | "dismissed") => {
    try {
      await review.mutateAsync({ id: report.id, status, notes });
      toast.success(
        status === "reviewed" ? t("Şikayətə baxıldı") : t("Şikayət rədd edildi"),
        report.reason || undefined,
      );
      onClose();
    } catch (error) {
      toast.error(
        t("Şikayət yenilənmədi"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  };

  const runDeactivate = async () => {
    try {
      await deactivate.mutateAsync({ id: report.target_id });
      toast.success(t("İstifadəçi deaktiv edildi"));
      setConfirmDeactivate(false);
    } catch (error) {
      toast.error(
        t("İstifadəçi deaktiv edilmədi"),
        error instanceof Error ? error.message : t("Yenidən yoxlayın"),
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim */}
      <button
        type="button"
        aria-label={t("Bağla")}
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-background shadow-lift transition-transform duration-300 ease-out sm:max-w-lg ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-warning/12 text-warning">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-display text-base font-bold text-foreground">
                {t("Şikayət")} · {t(targetLabel(report.target_kind))}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(report.status)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(report.status)}`} />
                  {t(REPORT_STATUS_AZ[report.status])}
                </span>
                {samePending > 1 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                    <Layers className="h-3 w-3" />
                    {samePending} {t("açıq şikayət")}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted">{formatRelative(report.created_at)}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Bağla")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foregroundMuted transition hover:bg-surfaceElevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {/* Reason highlight */}
          <div className="my-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="text-[11px] font-semibold   text-foregroundMuted">
              {t("Səbəb")}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
              {report.reason ? (
                t(reasonLabel(report.reason))
              ) : (
                <span className="text-foregroundMuted">{t("(səbəb göstərilməyib)")}</span>
              )}
            </p>
          </div>

          <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4 shadow-card">
            <Row icon={TargetIconWrapper(report.target_kind)} label={t("Şikayət olunan məzmun")}>
              <div className="flex items-center gap-2">
                <span>{t(targetLabel(report.target_kind))}</span>
                {hasLink ? (
                  <a
                    href={href}
                    className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
                  >
                    {report.target_id}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="break-all font-mono text-xs text-foregroundMuted">
                    {report.target_id}
                  </span>
                )}
              </div>
            </Row>
            <Row icon={User} label={t("Şikayətçi")}>
              <div>
                <div>{reporterLabel(report)}</div>
                <div className="break-all font-mono text-[11px] text-foregroundMuted">
                  {report.reporter?.email ?? report.reporter_user_id}
                </div>
              </div>
            </Row>
            <Row icon={Hash} label={t("Şikayət ID")}>
              <span className="break-all font-mono text-xs">{report.id}</span>
            </Row>
            <Row icon={CalendarClock} label={t("Tarix")}>
              {formatDateTime(report.created_at)}
            </Row>
            {report.notes ? (
              <Row icon={StickyNote} label={t("Moderator qeydi")}>
                {report.notes}
              </Row>
            ) : null}
          </div>

          {/* Target preview (skips `user` — shown in the moderation card instead) */}
          {detailQuery.isLoading ? (
            <div className="my-3 flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foregroundMuted shadow-card">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("Detallar yüklənir…")}
            </div>
          ) : target && target.kind !== "user" ? (
            <TargetPreview target={target} />
          ) : null}

          {/* Reported user moderation card + deactivate */}
          {isUserTarget ? (
            <div className="my-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold   text-foregroundMuted">
                  {t("Şikayət olunan istifadəçi")}
                </div>
                {deactivated ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                    <ShieldOff className="h-3 w-3" />
                    {t("Deaktiv edilib")}
                  </span>
                ) : null}
              </div>

              {moderationUser.isLoading ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-foregroundMuted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("Yüklənir")}…
                </div>
              ) : moderationUser.isError ? (
                <p className="mt-2 text-sm text-danger">{t("İstifadəçi yüklənmədi")}</p>
              ) : moderationUser.data ? (
                <div className="mt-2 space-y-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {moderationUser.data.display_name || t("Adsız")}
                    </div>
                    <div className="break-all font-mono text-[11px] text-foregroundMuted">
                      {moderationUser.data.email ?? report.target_id}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center rounded-full bg-surfaceElevated px-2 py-0.5 text-[11px] font-semibold text-foregroundMuted ring-1 ring-inset ring-border">
                      {t("Alınan şikayət")}: {moderationUser.data.reports_received_count}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-surfaceElevated px-2 py-0.5 text-[11px] font-semibold text-foregroundMuted ring-1 ring-inset ring-border">
                      {t("Verilən şikayət")}: {moderationUser.data.reports_filed_count}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-surfaceElevated px-2 py-0.5 text-[11px] font-semibold text-foregroundMuted ring-1 ring-inset ring-border">
                      {t("Oyunlar")}: {moderationUser.data.games_played_total}
                    </span>
                  </div>
                  {moderationUser.data.suspended_at ? (
                    <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                      {t("Hesab dayandırılıb")}
                      {moderationUser.data.suspension_reason
                        ? `: ${moderationUser.data.suspension_reason}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3">
                {deactivated ? (
                  <p className="text-xs text-foregroundMuted">
                    {t("Bu hesab artıq deaktiv edilib.")}
                  </p>
                ) : (
                  <>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmDeactivate(true)}
                      disabled={moderationUser.isLoading || deactivate.isPending}
                    >
                      <UserX className="h-4 w-4" />
                      {t("İstifadəçini deaktiv et")}
                    </Button>
                    {targetIsStaff ? (
                      <p className="mt-1.5 text-[11px] text-foregroundMuted">
                        {t("Yalnız admin işçi hesabını deaktiv edə bilər.")}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}

          {/* Recent same-target reports */}
          {recent.length > 1 ? (
            <div className="my-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center gap-2 text-[11px] font-semibold   text-foregroundMuted">
                <Layers className="h-3.5 w-3.5" />
                {t("Eyni hədəf üzrə şikayətlər")} ({recent.length})
              </div>
              <ul className="mt-2 divide-y divide-border">
                {recent.slice(0, 6).map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-foreground">
                      {item.reason ? t(reasonLabel(item.reason)) : t("(səbəb göstərilməyib)")}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPillClass(item.status)}`}
                      >
                        {t(REPORT_STATUS_AZ[item.status])}
                      </span>
                      <span className="text-[11px] text-foregroundMuted">
                        {formatRelative(item.created_at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Audit trail */}
          {audit.length > 0 ? (
            <div className="my-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center gap-2 text-[11px] font-semibold   text-foregroundMuted">
                <History className="h-3.5 w-3.5" />
                {t("Tarixçə")}
              </div>
              <ul className="mt-2 space-y-2">
                {audit.map((event) => (
                  <li key={event.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                    <div className="min-w-0">
                      <div className="text-foreground">
                        {t("Əməliyyat")}: <span className="font-medium">{event.action}</span>
                      </div>
                      <div className="text-[11px] text-foregroundMuted">
                        {event.actor_display_name || event.actor_email || t("Sistem")} ·{" "}
                        {formatDateTime(event.created_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Notes input */}
          <div className="my-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
            <label
              htmlFor="report-notes"
              className="block text-[11px] font-semibold   text-foregroundMuted"
            >
              {t("Moderator qeydi")}
            </label>
            <Textarea
              id="report-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("Bu qərar üçün əlavə kontekst…")}
              className="mt-2"
            />
          </div>

          <div className="h-2" />
        </div>

        {/* Footer actions */}
        <div className="border-t border-border bg-surface px-5 py-4">
          {pending ? (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => void submit("reviewed")} disabled={review.isPending}>
                {review.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {t("Baxılıb et")}
              </Button>
              <Button
                variant="danger"
                onClick={() => void submit("dismissed")}
                disabled={review.isPending}
              >
                {review.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {t("Rədd et")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-foregroundMuted">
                {t("Bu şikayət artıq həll edilib. Qeydi yenilə bilərsiniz.")}
              </p>
              <Button
                variant="secondary"
                onClick={() => void submit(report.status === "dismissed" ? "dismissed" : "reviewed")}
                disabled={review.isPending}
              >
                {review.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("Qeydi saxla")}
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Deactivate confirm */}
      <Dialog
        open={confirmDeactivate}
        onOpenChange={(value) => (value ? null : setConfirmDeactivate(false))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("İstifadəçini deaktiv et?")}</DialogTitle>
            <DialogDescription>
              {t(
                "İstifadəçi deaktiv edilir — giriş bloklanır və hesab gizlədilir. Bunu istifadəçilər siyahısından geri qaytara bilərsiniz.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surfaceElevated px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <Ban className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {moderationUser.data?.display_name || t("Adsız")}
              </div>
              <div className="truncate font-mono text-[11px] text-foregroundMuted">
                {moderationUser.data?.email ?? report.target_id}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmDeactivate(false)}
              disabled={deactivate.isPending}
            >
              {t("Ləğv et")}
            </Button>
            <Button
              variant="danger"
              onClick={() => void runDeactivate()}
              disabled={deactivate.isPending}
            >
              {deactivate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserX className="h-4 w-4" />
              )}
              {t("Deaktiv et")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Bind the target kind into an icon component matching the Row `icon` prop. */
function TargetIconWrapper(kind: string): typeof Hash {
  const Wrapped = ({ className }: { className?: string }) => (
    <TargetIcon kind={kind} className={className ?? "h-4 w-4 text-foregroundMuted"} />
  );
  Wrapped.displayName = "TargetIconWrapper";
  return Wrapped as unknown as typeof Hash;
}
