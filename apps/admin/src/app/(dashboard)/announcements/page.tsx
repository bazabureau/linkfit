"use client";

import * as React from "react";
import { CalendarClock, Loader2, Megaphone, Pencil, Plus, Power, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useExpireAnnouncement,
  useUpdateAnnouncement,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementPayload,
  type AnnouncementStatus,
} from "@/lib/admin-announcements";

const selectCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none";

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

function statusOf(a: Announcement): { label: string; variant: "success" | "info" | "neutral" } {
  if (a.is_scheduled) return { label: "Scheduled", variant: "info" };
  if (a.is_expired) return { label: "Expired", variant: "neutral" };
  return { label: "Active", variant: "success" };
}

export default function AnnouncementsPage(): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<AnnouncementStatus>("all");
  const [audience, setAudience] = React.useState<AnnouncementAudience | "">("");
  const [dialog, setDialog] = React.useState<{ open: boolean; item?: Announcement }>({ open: false });

  const { data, isLoading } = useAnnouncements({
    q: q || undefined,
    status: status === "all" ? undefined : status,
    audience: audience || undefined,
  });
  const expire = useExpireAnnouncement();
  const del = useDeleteAnnouncement();
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("İdarəetmə")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <Megaphone className="h-6 w-6 text-accent" />
            {t("Announcements")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            {t("In-app banners shown to players, scheduled and localised.")}
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          {t("New announcement")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={status}
          onChange={(e) => setStatus(e.target.value as AnnouncementStatus)}
        >
          {(["all", "active", "scheduled", "expired"] as AnnouncementStatus[]).map((s) => (
            <option key={s} value={s}>{t(s)}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={audience}
          onChange={(e) => setAudience(e.target.value as AnnouncementAudience | "")}
        >
          <option value="">{t("All audiences")}</option>
          {(["all", "az", "en", "ru"] as AnnouncementAudience[]).map((a) => (
            <option key={a} value={a}>{a === "all" ? t("Everyone") : a.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Title")}</TableHead>
              <TableHead>{t("Audience")}</TableHead>
              <TableHead>{t("Window")}</TableHead>
              <TableHead className="text-right">{t("Dismissals")}</TableHead>
              <TableHead>{t("Priority")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("No announcements")}</TableCell></TableRow>
            ) : (
              items.map((a) => {
                const st = statusOf(a);
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <p className="font-semibold text-foreground">{a.title_az}</p>
                      <p className="text-xs text-foregroundMuted">{a.title_en}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{a.audience === "all" ? t("Everyone") : a.audience.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-foregroundMuted">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {dt(a.starts_at)} – {dt(a.ends_at)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foregroundMuted">{a.dismissals_count}</TableCell>
                    <TableCell className="tabular-nums text-foregroundMuted">{a.priority}</TableCell>
                    <TableCell><Badge variant={st.variant}>{t(st.label)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, item: a })} aria-label={t("Edit")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!a.is_expired && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("Expire now")}
                            disabled={expire.isPending}
                            onClick={() =>
                              expire.mutate(a.id, {
                                onSuccess: () => toast.success(t("Announcement expired")),
                                onError: () => toast.error(t("Alınmadı")),
                              })
                            }
                          >
                            <Power className="h-3.5 w-3.5 text-warning" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Delete")}
                          disabled={del.isPending}
                          onClick={() => {
                            if (!window.confirm(t("Delete this announcement?"))) return;
                            del.mutate(a.id, {
                              onSuccess: () => toast.success(t("Announcement deleted")),
                              onError: () => toast.error(t("Alınmadı")),
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {dialog.open && <AnnouncementDialog item={dialog.item} onClose={() => setDialog({ open: false })} />}
    </div>
  );
}

const LOCALES = [
  { key: "az", label: "AZ" },
  { key: "en", label: "EN" },
  { key: "ru", label: "RU" },
] as const;

function AnnouncementDialog({ item, onClose }: { item?: Announcement; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const editing = Boolean(item);
  const pending = create.isPending || update.isPending;
  const [locale, setLocale] = React.useState<"az" | "en" | "ru">("az");

  const [form, setForm] = React.useState({
    title_az: item?.title_az ?? "",
    title_en: item?.title_en ?? "",
    title_ru: item?.title_ru ?? "",
    body_az: item?.body_az ?? "",
    body_en: item?.body_en ?? "",
    body_ru: item?.body_ru ?? "",
    cta_label_az: item?.cta_label_az ?? "",
    cta_label_en: item?.cta_label_en ?? "",
    cta_label_ru: item?.cta_label_ru ?? "",
    cta_url: item?.cta_url ?? "",
    audience: (item?.audience ?? "all") as AnnouncementAudience,
    priority: String(item?.priority ?? 100),
    starts_at: item?.starts_at ? item.starts_at.slice(0, 16) : "",
    ends_at: item?.ends_at ? item.ends_at.slice(0, 16) : "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    if (form.title_az.trim().length < 2 || form.title_en.trim().length < 2 || form.title_ru.trim().length < 2) {
      toast.error(t("Title is required in AZ, EN and RU"));
      return;
    }
    if (form.starts_at && form.ends_at && new Date(form.ends_at) <= new Date(form.starts_at)) {
      toast.error(t("End time must be after start time"));
      return;
    }
    const payload: AnnouncementPayload = {
      title_az: form.title_az.trim(),
      title_en: form.title_en.trim(),
      title_ru: form.title_ru.trim(),
      body_az: form.body_az.trim() || null,
      body_en: form.body_en.trim() || null,
      body_ru: form.body_ru.trim() || null,
      cta_label_az: form.cta_label_az.trim() || null,
      cta_label_en: form.cta_label_en.trim() || null,
      cta_label_ru: form.cta_label_ru.trim() || null,
      cta_url: form.cta_url.trim() || null,
      audience: form.audience,
      priority: Number(form.priority) || 100,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    };
    const opts = {
      onSuccess: () => {
        toast.success(editing ? t("Announcement updated") : t("Announcement created"));
        onClose();
      },
      onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
    };
    if (editing && item) update.mutate({ id: item.id, data: payload }, opts);
    else create.mutate(payload, opts);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit announcement") : t("New announcement")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3.5 overflow-y-auto pr-1">
          <div className="flex w-fit gap-1 rounded-pill border border-border bg-surface p-1">
            {LOCALES.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLocale(l.key)}
                className={`rounded-pill px-4 py-1.5 text-sm font-medium transition ${locale === l.key ? "bg-accent text-ink" : "text-foregroundMuted hover:text-foreground"}`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {locale === "az" && <LocaleFields form={form} set={set} suffix="az" t={t} />}
          {locale === "en" && <LocaleFields form={form} set={set} suffix="en" t={t} />}
          {locale === "ru" && <LocaleFields form={form} set={set} suffix="ru" t={t} />}

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("CTA URL")}</span>
            <Input value={form.cta_url} onChange={(e) => set("cta_url", e.target.value)} placeholder="https://" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Audience")}</span>
              <select className={selectCls} value={form.audience} onChange={(e) => set("audience", e.target.value as AnnouncementAudience)}>
                <option value="all">{t("Everyone")}</option>
                <option value="az">AZ</option>
                <option value="en">EN</option>
                <option value="ru">RU</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Priority")}</span>
              <Input type="number" value={form.priority} onChange={(e) => set("priority", e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Starts")}</span>
              <Input type="datetime-local" value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Ends")}</span>
              <Input type="datetime-local" value={form.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>{t("Ləğv")}</Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? t("Yadda saxla") : t("Yarat")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FormShape = {
  title_az: string; title_en: string; title_ru: string;
  body_az: string; body_en: string; body_ru: string;
  cta_label_az: string; cta_label_en: string; cta_label_ru: string;
  cta_url: string; audience: AnnouncementAudience; priority: string;
  starts_at: string; ends_at: string;
};

function LocaleFields({
  form,
  set,
  suffix,
  t,
}: {
  form: FormShape;
  set: <K extends keyof FormShape>(k: K, v: FormShape[K]) => void;
  suffix: "az" | "en" | "ru";
  t: (s: string) => string;
}): React.JSX.Element {
  const titleKey = `title_${suffix}` as const;
  const bodyKey = `body_${suffix}` as const;
  const ctaKey = `cta_label_${suffix}` as const;
  return (
    <div className="space-y-3.5 rounded-xl border border-border bg-surfaceElevated p-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Title")}</span>
        <Input value={form[titleKey]} onChange={(e) => set(titleKey, e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Body")}</span>
        <Textarea rows={3} value={form[bodyKey]} onChange={(e) => set(bodyKey, e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("CTA label")}</span>
        <Input value={form[ctaKey]} onChange={(e) => set(ctaKey, e.target.value)} />
      </label>
    </div>
  );
}
