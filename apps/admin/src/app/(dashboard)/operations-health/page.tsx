"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  HardDrive,
  RefreshCw,
  Send,
  Smartphone,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { useOperationsHealth, type OperationsHealth } from "@/lib/admin-operations";

const numberFmt = new Intl.NumberFormat("en-US");

function humanBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

export default function OperationsHealthPage(): React.JSX.Element {
  const { t } = useI18n();
  const { data, isLoading, isFetching, refetch } = useOperationsHealth();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <Activity className="h-6 w-6 text-accent" />
            {t("Operations health")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Push delivery, reminder timers and media storage at a glance.")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.generated_at && (
            <span className="text-xs text-foregroundMuted">{t("Updated")} {dt(data.generated_at)}</span>
          )}
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-surfaceElevated" />
          ))}
        </div>
      ) : data ? (
        <HealthContent data={data} />
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <p className="font-medium text-foreground">{t("Failed to load operations health")}</p>
              <p className="text-sm text-foregroundMuted">{t("Check your connection and try again.")}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="w-full sm:w-auto"
          >
            {t("Retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

function HealthContent({ data }: { data: OperationsHealth }): React.JSX.Element {
  const { t } = useI18n();
  const q = data.push_queue;
  const apnsHealthy = data.apns.configured;
  const queueWarn = q.failed > 0 || q.pending + q.retry > 50;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* APNs */}
      <Panel title={t("Apple Push (APNs)")} icon={Smartphone}>
        <div className="mb-3 flex items-center gap-2">
          {apnsHealthy ? (
            <Badge variant="success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("Configured")}</Badge>
          ) : (
            <Badge variant="danger"><XCircle className="mr-1 h-3.5 w-3.5" />{t("Not configured")}</Badge>
          )}
          <Badge variant={data.apns.production ? "info" : "neutral"}>
            {data.apns.production ? t("Production") : t("Sandbox")}
          </Badge>
        </div>
        <CheckRow label={t("Bundle ID set")} ok={data.apns.bundle_id_set} />
        <CheckRow label={t("Key ID set")} ok={data.apns.key_id_set} />
        <CheckRow label={t("Team ID set")} ok={data.apns.team_id_set} />
        <CheckRow label={t("Private key readable")} ok={data.apns.private_key_readable} />
      </Panel>

      {/* Push queue */}
      <Panel title={t("Push queue")} icon={Send} warn={queueWarn}>
        <div className="grid grid-cols-3 gap-2">
          <Metric label={t("pending")} value={q.pending} tone={q.pending > 50 ? "warning" : "neutral"} />
          <Metric label={t("retry")} value={q.retry} tone={q.retry > 0 ? "warning" : "neutral"} />
          <Metric label={t("processing")} value={q.processing} tone="info" />
          <Metric label={t("sent_24h")} value={q.sent_24h} tone="success" />
          <Metric label={t("failed")} value={q.failed} tone={q.failed > 0 ? "danger" : "neutral"} />
          <Metric label={t("deferred")} value={q.deferred} tone="neutral" />
        </div>
        <p className="mt-3 text-xs text-foregroundMuted">
          {t("Oldest pending")}: <span className="font-semibold text-foreground">{dt(q.oldest_pending_at)}</span>
        </p>
      </Panel>

      {/* Reminders */}
      <Panel title={t("Reminders")} icon={BellRing}>
        <div className="grid grid-cols-2 gap-2">
          <Metric label={t("Games sent 24h")} value={data.reminders.games_sent_24h} tone="success" />
          <Metric label={t("Bookings sent 24h")} value={data.reminders.bookings_sent_24h} tone="success" />
          <Metric label={t("Games due next 2h")} value={data.reminders.games_due_next_2h} tone="info" />
          <Metric label={t("Bookings due next 2h")} value={data.reminders.bookings_due_next_2h} tone="info" />
        </div>
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          {Object.entries(data.timers.expected).map(([name, cadence]) => (
            <p key={name} className="flex items-center justify-between text-xs">
              <span className="font-mono text-foregroundMuted">{name}</span>
              <span className="text-foreground">{cadence}</span>
            </p>
          ))}
        </div>
      </Panel>

      {/* Media storage */}
      <Panel title={t("Media storage")} icon={HardDrive}>
        <div className="grid grid-cols-2 gap-2">
          <Metric label={t("Assets total")} value={data.media.assets_total} tone="neutral" />
          <Metric
            label={t("Pending cleanup")}
            value={data.media.deleted_pending_cleanup}
            tone={data.media.deleted_pending_cleanup > 0 ? "warning" : "neutral"}
          />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-foregroundMuted">{t("Storage used")}</span>
          <span className="font-display font-bold text-foreground">{humanBytes(data.media.bytes_total)}</span>
        </div>
        <p className="mt-1 text-xs text-foregroundMuted">{t("Disk")}: <span className="font-mono">{data.media.disk}</span></p>
      </Panel>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  warn = false,
  children,
}: {
  title: string;
  icon: typeof Activity;
  warn?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-surface p-5 shadow-card ${warn ? "border-warning/40" : "border-border"}`}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-[#3f6b00]">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="font-display text-sm font-bold text-foreground">{title}</h2>
        {warn && <AlertTriangle className="h-4 w-4 text-warning" />}
      </div>
      {children}
    </section>
  );
}

function CheckRow({ label, ok }: { label: string; ok: boolean }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-foregroundMuted">{label}</span>
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-accent" />
      ) : (
        <XCircle className="h-4 w-4 text-danger" />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "warning" | "info" | "success" | "danger" | "neutral";
}): React.JSX.Element {
  const toneCls = {
    warning: "border-warning/30 bg-warning/10 text-warning",
    info: "border-info/30 bg-info/10 text-info",
    success: "border-accent/30 bg-accent/10 text-[#3f6b00]",
    danger: "border-danger/30 bg-danger/10 text-danger",
    neutral: "border-border bg-surfaceElevated text-foreground",
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <p className="text-[10.5px] font-semibold capitalize opacity-80">{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold tabular-nums">{numberFmt.format(value)}</p>
    </div>
  );
}
