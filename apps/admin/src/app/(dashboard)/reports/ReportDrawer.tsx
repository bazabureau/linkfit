"use client";

import * as React from "react";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Hash,
  Loader2,
  ShieldAlert,
  StickyNote,
  User,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/date-format";
import { useI18n } from "@/lib/i18n";
import { useReviewReport, type AdminReport } from "@/lib/admin-reports";
import {
  REPORT_STATUS_AZ,
  TargetIcon,
  formatRelative,
  reasonLabel,
  statusDotClass,
  statusPillClass,
  targetHref,
  targetLabel,
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

export function ReportDrawer({
  report,
  open,
  onClose,
}: {
  report: AdminReport | null;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const toast = useToast();
  const review = useReviewReport();
  const [notes, setNotes] = React.useState("");
  const [shown, setShown] = React.useState(false);

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
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(report.status)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(report.status)}`} />
                  {t(REPORT_STATUS_AZ[report.status])}
                </span>
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
              <span className="break-all font-mono text-xs">{report.reporter_user_id}</span>
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
