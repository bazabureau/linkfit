"use client";

import * as React from "react";
import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { AdminReport } from "@/lib/admin-reports";
import {
  REPORT_STATUS_AZ,
  TargetIcon,
  formatRelative,
  reasonLabel,
  shortId,
  statusDotClass,
  statusPillClass,
  targetLabel,
} from "./lib";

export interface ReportRowActions {
  onOpen: (report: AdminReport) => void;
  onReview: (report: AdminReport, status: "reviewed" | "dismissed") => void;
}

const COL_COUNT = 6;

function StatusPill({ report }: { report: AdminReport }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(report.status)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(report.status)}`} />
      {t(REPORT_STATUS_AZ[report.status])}
    </span>
  );
}

function QuickAction({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition ${
        danger
          ? "border-danger/20 text-danger/80 hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          : "border-border text-foregroundMuted hover:border-borderStrong hover:bg-surfaceElevated hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function RowSkeleton(): React.JSX.Element {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: COL_COUNT }).map((_, index) => (
        <td key={index} className="px-4 py-3.5">
          <div
            className="h-4 animate-pulse rounded bg-surfaceElevated"
            style={{ width: `${50 + ((index * 13) % 45)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

export function ReportsTable({
  reports,
  loading,
  filterLabel,
  actions,
}: {
  reports: AdminReport[];
  loading: boolean;
  filterLabel: string;
  actions: ReportRowActions;
}): React.JSX.Element {
  const { t } = useI18n();
  const headClass =
    "sticky top-0 z-10 h-11 bg-surfaceElevated px-4 text-left align-middle text-[11px] font-semibold   text-foregroundMuted";

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${headClass} rounded-tl-2xl`}>{t("Hədəf")}</th>
            <th className={headClass}>{t("Səbəb")}</th>
            <th className={headClass}>{t("Şikayətçi")}</th>
            <th className={headClass}>{t("Status")}</th>
            <th className={headClass}>{t("Tarix")}</th>
            <th className={`${headClass} rounded-tr-2xl text-right`}>{t("Əməliyyat")}</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            reports.map((report, index) => {
              const pending = report.status === "pending";
              return (
                <tr
                  key={report.id}
                  onClick={() => actions.onOpen(report)}
                  className={`group cursor-pointer border-b border-border transition-colors ${
                    index % 2 === 1
                      ? "bg-surfaceElevated/40 hover:bg-surfaceElevated"
                      : "bg-surface hover:bg-surfaceElevated/70"
                  }`}
                >
                  {/* Target */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-[160px] items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surfaceElevated text-foregroundMuted ring-1 ring-inset ring-border">
                        <TargetIcon kind={report.target_kind} className="h-4 w-4 text-foreground" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground">
                          {t(targetLabel(report.target_kind))}
                        </div>
                        <div className="truncate font-mono text-xs text-foregroundMuted">
                          {shortId(report.target_id)}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Reason */}
                  <td className="px-4 py-3 align-middle">
                    <p className="line-clamp-2 max-w-[320px] text-sm text-foreground">
                      {report.reason ? (
                        t(reasonLabel(report.reason))
                      ) : (
                        <span className="text-foregroundMuted">{t("(səbəb göstərilməyib)")}</span>
                      )}
                    </p>
                  </td>

                  {/* Reporter */}
                  <td className="px-4 py-3 align-middle">
                    <span className="font-mono text-xs text-foregroundMuted">
                      {shortId(report.reporter_user_id)}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 align-middle">
                    <StatusPill report={report} />
                  </td>

                  {/* Created */}
                  <td className="px-4 py-3 align-middle">
                    <span className="whitespace-nowrap text-xs text-foregroundMuted">
                      {formatRelative(report.created_at)}
                    </span>
                  </td>

                  {/* Quick actions */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      {pending ? (
                        <>
                          <QuickAction
                            title={t("Baxılıb et")}
                            onClick={() => actions.onReview(report, "reviewed")}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </QuickAction>
                          <QuickAction
                            title={t("Rədd et")}
                            danger
                            onClick={() => actions.onReview(report, "dismissed")}
                          >
                            <XCircle className="h-4 w-4" />
                          </QuickAction>
                        </>
                      ) : null}
                      <QuickAction title={t("Detal")} onClick={() => actions.onOpen(report)}>
                        <ShieldAlert className="h-4 w-4" />
                      </QuickAction>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {!loading && reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10">
            <ShieldCheck className="h-7 w-7 text-accent" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              {t("Şikayət yoxdur")}
            </h3>
            <p className="mt-1 max-w-xs text-sm text-foregroundMuted">{filterLabel}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
