"use client";

import * as React from "react";
import { Check, Loader2, RefreshCw, ShieldAlert, Star, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useApproveOwnerApplication,
  useOwnerApplications,
  useRejectOwnerApplication,
  useRemoveReview,
  useRestoreReview,
  useVenueReviews,
  type OwnerAppStatus,
  type OwnerApplication,
} from "@/lib/admin-moderation";

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

/**
 * Format an average rating safely. The backend computes this via Postgres
 * `AVG()`, which serializes as a numeric *string* (e.g. "4.3333"), not a
 * number — calling `.toFixed` on it directly throws. Coerce + guard NaN.
 */
function formatAvgRating(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isNaN(n) ? "—" : n.toFixed(1);
}

export default function ModerationPage(): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"applications" | "reviews">("applications");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-accent">{t("İdarəetmə")}</p>
        <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
          <ShieldAlert className="h-6 w-6 text-accent" />
          {t("Moderation")}
        </h1>
        <p className="mt-1 text-sm text-foregroundMuted">{t("Owner applications and venue reviews.")}</p>
      </div>

      <div className="flex w-fit gap-1 rounded-pill border border-border bg-surface p-1">
        {(["applications", "reviews"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium transition ${tab === key ? "bg-accent text-white" : "text-foregroundMuted hover:text-foreground"}`}
          >
            {key === "applications" ? t("Owner applications") : t("Reviews")}
          </button>
        ))}
      </div>

      {tab === "applications" ? <ApplicationsTab /> : <ReviewsTab />}
    </div>
  );
}

function appStatusVariant(status: OwnerAppStatus): "success" | "warning" | "danger" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

function ApplicationsTab(): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<OwnerAppStatus | undefined>(undefined);
  const [q, setQ] = React.useState("");
  const [review, setReview] = React.useState<{ app: OwnerApplication; mode: "approve" | "reject" } | null>(null);
  const { data, isLoading, isError, refetch } = useOwnerApplications({ status, q: q || undefined });
  const apps = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={status ?? ""}
          onChange={(e) => setStatus((e.target.value || undefined) as OwnerAppStatus | undefined)}
        >
          <option value="">{t("All statuses")}</option>
          {(["pending", "approved", "rejected"] as OwnerAppStatus[]).map((s) => (
            <option key={s} value={s}>{t(s)}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Venue")}</TableHead>
              <TableHead>{t("Applicant")}</TableHead>
              <TableHead>{t("Contact")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Submitted")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="text-sm font-semibold text-danger">{t("Could not load data")}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : apps.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("No applications")}</TableCell></TableRow>
            ) : (
              apps.map((app) => (
                <TableRow key={app.id}>
                  <TableCell className="max-w-[220px]">
                    <p className="truncate font-semibold text-foreground">{app.venue_name ?? app.venue?.name ?? "—"}</p>
                    <p className="truncate text-xs text-foregroundMuted">{app.venue_address ?? "—"}</p>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{app.user?.display_name ?? app.contact_name ?? "—"}</TableCell>
                  <TableCell className="text-foregroundMuted">
                    <p>{app.contact_email ?? app.user?.email ?? "—"}</p>
                    <p className="text-xs">{app.contact_phone ?? ""}</p>
                  </TableCell>
                  <TableCell><Badge variant={appStatusVariant(app.status)}>{t(app.status)}</Badge></TableCell>
                  <TableCell className="text-foregroundMuted">{dt(app.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {app.status === "pending" ? (
                      <div className="inline-flex gap-1">
                        <Button variant="primary" size="sm" onClick={() => setReview({ app, mode: "approve" })}>
                          <Check className="h-3.5 w-3.5" />{t("Approve")}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setReview({ app, mode: "reject" })}>
                          <X className="h-3.5 w-3.5" />{t("Reject")}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-foregroundMuted">{app.review_note ?? t("Reviewed")}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {review && <ReviewAppDialog app={review.app} mode={review.mode} onClose={() => setReview(null)} />}
    </div>
  );
}

function ReviewAppDialog({
  app,
  mode,
  onClose,
}: {
  app: OwnerApplication;
  mode: "approve" | "reject";
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const approve = useApproveOwnerApplication();
  const reject = useRejectOwnerApplication();
  const [note, setNote] = React.useState("");
  const pending = approve.isPending || reject.isPending;

  function submit() {
    const opts = {
      onSuccess: () => {
        toast.success(mode === "approve" ? t("Application approved") : t("Application rejected"));
        onClose();
      },
      onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
    };
    if (mode === "approve") {
      approve.mutate({ id: app.id, review_note: note || null }, opts);
    } else {
      reject.mutate({ id: app.id, review_note: note || null }, opts);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "approve" ? t("Approve application") : t("Reject application")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-surfaceElevated/40 p-3 text-sm">
            <p className="font-semibold text-foreground">{app.venue_name ?? app.venue?.name ?? "—"}</p>
            <p className="text-foregroundMuted">{app.venue_address ?? "—"}</p>
            {app.message && <p className="mt-1.5 whitespace-pre-wrap text-foregroundMuted">{app.message}</p>}
          </div>
          {mode === "approve" && (
            <p className="text-xs text-foregroundMuted">
              {app.venue_id
                ? t("Links this application to its existing venue.")
                : t("A new partner venue will be created from this application.")}
            </p>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Review note")}</span>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Optional")} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>{t("Ləğv")}</Button>
          <Button variant={mode === "approve" ? "primary" : "danger"} onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "approve" ? t("Approve") : t("Reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewsTab(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [rating, setRating] = React.useState<number | undefined>(undefined);
  const [includeRemoved, setIncludeRemoved] = React.useState(true);
  const { data, isLoading, isError, refetch } = useVenueReviews({
    q: q || undefined,
    rating,
    include_removed: includeRemoved,
  });
  const remove = useRemoveReview();
  const restore = useRestoreReview();
  const reviews = data?.items ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={rating ?? ""}
          onChange={(e) => setRating(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">{t("All ratings")}</option>
          {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} ★</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-foregroundMuted">
          <input type="checkbox" checked={includeRemoved} onChange={(e) => setIncludeRemoved(e.target.checked)} />
          {t("Show removed")}
        </label>
        {summary && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Badge variant="info">★ {formatAvgRating(summary.avg_rating)}</Badge>
            <Badge variant="success">{t("Active")}: {summary.active_count}</Badge>
            <Badge variant="danger">{t("Removed")}: {summary.removed_count}</Badge>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Author")}</TableHead>
              <TableHead>{t("Venue")}</TableHead>
              <TableHead>{t("Rating")}</TableHead>
              <TableHead>{t("Review")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="text-sm font-semibold text-danger">{t("Could not load data")}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : reviews.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("No reviews")}</TableCell></TableRow>
            ) : (
              reviews.map((review) => (
                <TableRow key={review.id} className={review.removed_at ? "opacity-60" : undefined}>
                  <TableCell className="font-semibold text-foreground">{review.display_name}</TableCell>
                  <TableCell className="text-foregroundMuted">{review.venue_name ?? "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                      {review.rating}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <p className="truncate text-foregroundMuted">{review.body ?? "—"}</p>
                  </TableCell>
                  <TableCell>
                    {review.removed_at ? (
                      <Badge variant="danger">{t("Removed")}</Badge>
                    ) : (
                      <Badge variant="success">{t("Active")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {review.removed_at ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          restore.mutate(
                            { id: review.id },
                            { onSuccess: () => toast.success(t("Review restored")), onError: () => toast.error(t("Alınmadı")) },
                          )
                        }
                      >
                        <Undo2 className="h-3.5 w-3.5" />{t("Restore")}
                      </Button>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() =>
                          remove.mutate(
                            { id: review.id },
                            { onSuccess: () => toast.success(t("Review removed")), onError: () => toast.error(t("Alınmadı")) },
                          )
                        }
                      >
                        <X className="h-3.5 w-3.5" />{t("Remove")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
