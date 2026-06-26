"use client";

import * as React from "react";
import { ExternalLink, Image as ImageIcon, Loader2, RefreshCw, Trash2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useCleanupMedia,
  useDeleteMediaAsset,
  useMediaAssets,
  type MediaCleanupResult,
} from "@/lib/admin-media";

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

function humanBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function MediaPage(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [cleanupOpen, setCleanupOpen] = React.useState(false);
  const { data, isLoading, isError, refetch } = useMediaAssets({ limit: 100 });
  const del = useDeleteMediaAsset();
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <ImageIcon className="h-6 w-6 text-accent" />
            {t("Media")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Uploaded assets — review storage and prune deleted files.")}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setCleanupOpen(true)}>
          <Wand2 className="h-4 w-4" />
          {t("Cleanup deleted")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Asset")}</TableHead>
              <TableHead>{t("Purpose")}</TableHead>
              <TableHead>{t("Type")}</TableHead>
              <TableHead className="text-right">{t("Size")}</TableHead>
              <TableHead>{t("State")}</TableHead>
              <TableHead>{t("Uploaded")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <p className="text-sm text-danger">{t("Yenidən yoxlayın")}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("No media assets")}</TableCell></TableRow>
            ) : (
              items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="max-w-[280px]">
                    <p className="truncate font-mono text-xs text-foreground">{m.path}</p>
                    <p className="truncate text-xs text-foregroundMuted">{m.disk}</p>
                  </TableCell>
                  <TableCell>{m.purpose ? <Badge variant="neutral">{m.purpose}</Badge> : <span className="text-foregroundMuted">—</span>}</TableCell>
                  <TableCell className="text-foregroundMuted">{m.mime ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-foregroundMuted">{humanBytes(m.size_bytes)}</TableCell>
                  <TableCell>
                    {m.deleted_at ? (
                      <Badge variant={m.cleanup_reason ? "neutral" : "warning"}>
                        {m.cleanup_reason ? t("Pruned") : t("Deleted")}
                      </Badge>
                    ) : (
                      <Badge variant="success">{t("Live")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{dt(m.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" asChild aria-label={t("Open")}>
                        <a href={m.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      {!m.deleted_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Delete")}
                          disabled={del.isPending}
                          onClick={() => {
                            if (!window.confirm(t("Delete this asset from storage?"))) return;
                            del.mutate(m.id, {
                              onSuccess: () => toast.success(t("Asset deleted")),
                              onError: () => toast.error(t("Alınmadı")),
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {cleanupOpen && <CleanupDialog onClose={() => setCleanupOpen(false)} />}
    </div>
  );
}

function CleanupDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const cleanup = useCleanupMedia();
  const [olderThanDays, setOlderThanDays] = React.useState("7");
  const [limit, setLimit] = React.useState("100");
  const [purpose, setPurpose] = React.useState("");
  const [preview, setPreview] = React.useState<MediaCleanupResult | null>(null);

  function run(dryRun: boolean) {
    cleanup.mutate(
      {
        older_than_days: Number(olderThanDays) || 0,
        limit: Number(limit) || 100,
        dry_run: dryRun,
        purpose: purpose.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          setPreview(res);
          if (dryRun) {
            toast.info(t("Dry run complete"), `${res.selected} ${t("assets matched")}`);
          } else {
            toast.success(t("Cleanup complete"), `${res.deleted} ${t("assets pruned")}`);
          }
        },
        onError: (err) => toast.error(t("Alınmadı"), err.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Cleanup deleted media")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <p className="text-sm text-foregroundMuted">
            {t("Permanently prune soft-deleted assets from storage. Run a dry run first to preview.")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Older than (days)")}</span>
              <Input type="number" min={0} value={olderThanDays} onChange={(e) => setOlderThanDays(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Limit")}</span>
              <Input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Purpose (optional)")}</span>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("e.g. avatar, message")} />
          </label>

          {preview && (
            <div className="rounded-xl border border-border bg-surfaceElevated px-3 py-2.5 text-sm">
              <p className="text-foreground">
                {t("Matched")}: <span className="font-semibold">{preview.selected}</span>
                {" · "}
                {t("Pruned")}: <span className="font-semibold">{preview.deleted}</span>
              </p>
              {preview.errors.length > 0 && (
                <p className="mt-1 text-xs text-danger">{preview.errors.length} {t("errors")}</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => run(true)} disabled={cleanup.isPending}>
            {cleanup.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Dry run")}
          </Button>
          <Button variant="danger" onClick={() => run(false)} disabled={cleanup.isPending}>
            {cleanup.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Prune now")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
