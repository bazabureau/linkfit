"use client";

import * as React from "react";
import { Bell, Check, Loader2, MailPlus, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useAdminNotifications,
  useDeleteNotification,
  useMarkNotificationRead,
  useSendNotification,
  type NotificationSeverity,
  type NotificationTargetRole,
  type NotificationType,
} from "@/lib/admin-notifications";

const selectCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none";

const TYPES: NotificationType[] = [
  "system",
  "booking_reminder",
  "game_invite",
  "game_update",
  "tournament_invite",
  "message_received",
];

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

function severityVariant(s: NotificationSeverity | null): "danger" | "warning" | "info" {
  if (s === "critical") return "danger";
  if (s === "warning") return "warning";
  return "info";
}

export default function NotificationsPage(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [type, setType] = React.useState<NotificationType | "">("");
  const [severity, setSeverity] = React.useState<NotificationSeverity | "">("");
  const [read, setRead] = React.useState<"" | "true" | "false">("");
  const [composeOpen, setComposeOpen] = React.useState(false);

  const { data, isLoading } = useAdminNotifications({
    q: q || undefined,
    type: type || undefined,
    severity: severity || undefined,
    read: read || undefined,
  });
  const markRead = useMarkNotificationRead();
  const del = useDeleteNotification();
  const items = data?.items ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <Bell className="h-6 w-6 text-accent" />
            {t("Notifications")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("Browse delivered notifications and broadcast new ones.")}
          </p>
        </div>
        <Button onClick={() => setComposeOpen(true)}>
          <MailPlus className="h-4 w-4" />
          {t("Compose notification")}
        </Button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatPill label={t("Unread")} value={summary?.unread} tone="warning" />
        <StatPill label={t("System")} value={summary?.system} tone="neutral" />
        <StatPill label={t("Critical")} value={summary?.critical} tone="danger" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
        <select className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" value={type} onChange={(e) => setType(e.target.value as NotificationType | "")}>
          <option value="">{t("All types")}</option>
          {TYPES.map((ty) => <option key={ty} value={ty}>{t(ty)}</option>)}
        </select>
        <select className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" value={severity} onChange={(e) => setSeverity(e.target.value as NotificationSeverity | "")}>
          <option value="">{t("All severities")}</option>
          {(["info", "warning", "critical"] as NotificationSeverity[]).map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <select className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" value={read} onChange={(e) => setRead(e.target.value as "" | "true" | "false")}>
          <option value="">{t("Read & unread")}</option>
          <option value="false">{t("Unread only")}</option>
          <option value="true">{t("Read only")}</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Notification")}</TableHead>
              <TableHead>{t("Recipient")}</TableHead>
              <TableHead>{t("Type")}</TableHead>
              <TableHead>{t("Severity")}</TableHead>
              <TableHead>{t("Sent")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-foregroundMuted">{t("No notifications")}</TableCell></TableRow>
            ) : (
              items.map((n) => (
                <TableRow key={n.id} className={n.is_read ? "" : "bg-accent/5"}>
                  <TableCell className="max-w-[320px]">
                    <p className="truncate font-semibold text-foreground">{n.title}</p>
                    <p className="truncate text-xs text-foregroundMuted">{n.body}</p>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">
                    <p className="text-sm text-foreground">{n.user.display_name ?? t("Adsız istifadəçi")}</p>
                    <p className="text-xs">{n.user.email ?? "—"}</p>
                  </TableCell>
                  <TableCell><Badge variant="neutral">{t(n.type)}</Badge></TableCell>
                  <TableCell>
                    {n.severity ? <Badge variant={severityVariant(n.severity)}>{t(n.severity)}</Badge> : <span className="text-foregroundMuted">—</span>}
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{dt(n.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={n.is_read ? t("Mark unread") : t("Mark read")}
                        disabled={markRead.isPending}
                        onClick={() =>
                          markRead.mutate(
                            { id: n.id, read: !n.is_read },
                            { onError: () => toast.error(t("Alınmadı")) },
                          )
                        }
                      >
                        <Check className={`h-3.5 w-3.5 ${n.is_read ? "text-foregroundMuted" : "text-accent"}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("Delete")}
                        disabled={del.isPending}
                        onClick={() =>
                          del.mutate(n.id, {
                            onSuccess: () => toast.success(t("Notification deleted")),
                            onError: () => toast.error(t("Alınmadı")),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {composeOpen && <ComposeDialog onClose={() => setComposeOpen(false)} />}
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone: "warning" | "danger" | "neutral";
}): React.JSX.Element {
  const toneCls = {
    warning: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-danger/30 bg-danger/10 text-danger",
    neutral: "border-border bg-surfaceElevated text-foreground",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneCls}`}>
      <p className="text-[11px] font-semibold opacity-80">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}

function ComposeDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const send = useSendNotification();

  const [form, setForm] = React.useState({
    title: "",
    body: "",
    type: "system" as NotificationType,
    severity: "info" as NotificationSeverity,
    target_role: "all" as NotificationTargetRole,
    mode: "role" as "role" | "users",
    user_ids: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    if (form.title.trim().length < 2 || form.body.trim().length < 2) {
      toast.error(t("Title and body are required"));
      return;
    }
    const base = {
      title: form.title.trim(),
      body: form.body.trim(),
      type: form.type,
      severity: form.severity,
    };
    const payload =
      form.mode === "users"
        ? {
            ...base,
            user_ids: form.user_ids
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : { ...base, target_role: form.target_role };

    if (form.mode === "users" && (!("user_ids" in payload) || payload.user_ids.length === 0)) {
      toast.error(t("Enter at least one user ID"));
      return;
    }

    send.mutate(payload, {
      onSuccess: (res) => {
        toast.success(t("Notification sent"), `${res.recipient_count} ${t("recipients")}`);
        onClose();
      },
      onError: (err) => toast.error(t("Alınmadı"), err.message),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Compose notification")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3.5 overflow-y-auto pr-1">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Title")}</span>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={120} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Body")}</span>
            <Textarea rows={3} value={form.body} onChange={(e) => set("body", e.target.value)} maxLength={1000} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Type")}</span>
              <select className={selectCls} value={form.type} onChange={(e) => set("type", e.target.value as NotificationType)}>
                {TYPES.map((ty) => <option key={ty} value={ty}>{t(ty)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Severity")}</span>
              <select className={selectCls} value={form.severity} onChange={(e) => set("severity", e.target.value as NotificationSeverity)}>
                {(["info", "warning", "critical"] as NotificationSeverity[]).map((s) => <option key={s} value={s}>{t(s)}</option>)}
              </select>
            </label>
          </div>

          <div className="flex w-fit gap-1 rounded-pill border border-border bg-surface p-1">
            {(["role", "users"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set("mode", m)}
                className={`rounded-pill px-4 py-1.5 text-sm font-medium transition ${form.mode === m ? "bg-accent text-ink" : "text-foregroundMuted hover:text-foreground"}`}
              >
                {m === "role" ? t("By role") : t("By user IDs")}
              </button>
            ))}
          </div>

          {form.mode === "role" ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Target role")}</span>
              <select className={selectCls} value={form.target_role} onChange={(e) => set("target_role", e.target.value as NotificationTargetRole)}>
                <option value="all">{t("All users")}</option>
                <option value="admins">{t("Admins")}</option>
                <option value="partners">{t("Partners")}</option>
                <option value="customers">{t("Customers")}</option>
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("User IDs")}</span>
              <Textarea
                rows={2}
                value={form.user_ids}
                onChange={(e) => set("user_ids", e.target.value)}
                placeholder={t("Comma or space separated UUIDs (max 200)")}
              />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>{t("Ləğv")}</Button>
          <Button onClick={submit} disabled={send.isPending}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("Send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
