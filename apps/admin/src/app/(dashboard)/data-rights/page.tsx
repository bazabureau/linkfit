"use client";

import * as React from "react";
import { ClipboardList, Download, Loader2, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useCancelDeletion,
  useDeletionRequests,
  useExportRequests,
  type ExportRequest,
} from "@/lib/admin-analytics";

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function exportVariant(status: ExportRequest["status"]): "success" | "info" | "warning" | "danger" {
  if (status === "ready") return "success";
  if (status === "failed") return "danger";
  if (status === "processing") return "info";
  return "warning";
}

export default function DataRightsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"deletions" | "exports">("deletions");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-accent">{t("İdarəetmə")}</p>
        <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
          <ClipboardList className="h-6 w-6 text-accent" />
          {t("Data rights")}
        </h1>
        <p className="mt-1 text-sm text-foregroundMuted">{t("GDPR account deletions and data export requests.")}</p>
      </div>

      <div className="flex w-fit gap-1 rounded-pill border border-border bg-surface p-1">
        {(["deletions", "exports"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium transition ${tab === key ? "bg-accent text-white" : "text-foregroundMuted hover:text-foreground"}`}
          >
            {key === "deletions" ? t("Scheduled deletions") : t("Export requests")}
          </button>
        ))}
      </div>

      {tab === "deletions" ? <DeletionsTab /> : <ExportsTab />}
    </div>
  );
}

function DeletionsTab(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: deletions = [], isLoading } = useDeletionRequests();
  const cancel = useCancelDeletion();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("User")}</TableHead>
            <TableHead>{t("Requested")}</TableHead>
            <TableHead>{t("Hard delete at")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
          ) : deletions.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("No scheduled deletions")}</TableCell></TableRow>
          ) : (
            deletions.map((d) => (
              <TableRow key={d.user_id}>
                <TableCell className="font-mono text-xs text-foreground">{d.user_id.slice(0, 12)}…</TableCell>
                <TableCell className="text-foregroundMuted">{dt(d.requested_at)}</TableCell>
                <TableCell className="text-foregroundMuted">{dt(d.hard_delete_at)}</TableCell>
                <TableCell><Badge variant="warning">{t(d.status)}</Badge></TableCell>
                <TableCell className="text-right">
                  {d.status === "scheduled" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={cancel.isPending}
                      onClick={() =>
                        cancel.mutate(
                          { userId: d.user_id },
                          { onSuccess: () => toast.success(t("Deletion cancelled")), onError: () => toast.error(t("Alınmadı")) },
                        )
                      }
                    >
                      {cancel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
                      {t("Cancel deletion")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ExportsTab(): React.JSX.Element {
  const { t } = useI18n();
  const { data: exports = [], isLoading } = useExportRequests();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("User")}</TableHead>
            <TableHead>{t("Requested")}</TableHead>
            <TableHead>{t("Expires")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead className="text-right">{t("File")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
          ) : exports.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="py-10 text-center text-foregroundMuted">{t("No export requests")}</TableCell></TableRow>
          ) : (
            exports.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs text-foreground">{e.user_id.slice(0, 12)}…</TableCell>
                <TableCell className="text-foregroundMuted">{dt(e.created_at)}</TableCell>
                <TableCell className="text-foregroundMuted">{dt(e.expires_at)}</TableCell>
                <TableCell><Badge variant={exportVariant(e.status)}>{t(e.status)}</Badge></TableCell>
                <TableCell className="text-right">
                  {e.status === "ready" && e.download_url ? (
                    <Button variant="secondary" size="sm" asChild>
                      <a href={e.download_url} target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" />
                        {t("Download")}
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-foregroundMuted">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
