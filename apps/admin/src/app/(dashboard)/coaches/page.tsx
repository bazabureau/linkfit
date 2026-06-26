"use client";

import * as React from "react";
import { AlertTriangle, GraduationCap, Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useAdminCoaches,
  useAdminLessons,
  useCreateCoach,
  useCreateLesson,
  useDeleteCoach,
  useDeleteLesson,
  useLessonRoster,
  useSportOptions,
  useUpdateCoach,
  useUpdateLesson,
  useVenueOptions,
  type AdminCoach,
  type AdminLesson,
} from "@/lib/admin-learn";

const money = (minor: number | null | undefined) => (minor != null ? `${(minor / 100).toFixed(0)} ₼` : "—");
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-foreground">{label}</span>
      {children}
    </label>
  );
}

const selectCls = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none";
const filterSelectCls = "h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground";

/** Strip empty values so the react-query key stays stable when no filter is set. */
function cleanFilters(f: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")) as Record<string, string>;
}

export default function CoachesPage(): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"coaches" | "lessons">("coaches");
  const [coachDialog, setCoachDialog] = React.useState<{ open: boolean; coach?: AdminCoach }>({ open: false });
  const [lessonDialog, setLessonDialog] = React.useState<{ open: boolean; lesson?: AdminLesson }>({ open: false });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("İdarəetmə")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <GraduationCap className="h-6 w-6 text-accent" />
            {t("Məşqçilər və dərslər")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">{t("Bütün məkanlar üzrə məşqçiləri və dərsləri idarə et.")}</p>
        </div>
        <Button onClick={() => (tab === "coaches" ? setCoachDialog({ open: true }) : setLessonDialog({ open: true }))}>
          <Plus className="h-4 w-4" />
          {tab === "coaches" ? t("Məşqçi əlavə et") : t("Dərs əlavə et")}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-pill border border-border bg-surface p-1 w-fit">
        {(["coaches", "lessons"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium transition ${tab === key ? "bg-accent text-white" : "text-foregroundMuted hover:text-foreground"}`}
          >
            {key === "coaches" ? t("Məşqçilər") : t("Dərslər")}
          </button>
        ))}
      </div>

      {tab === "coaches" ? (
        <CoachesTab onEdit={(coach) => setCoachDialog({ open: true, coach })} />
      ) : (
        <LessonsTab onEdit={(lesson) => setLessonDialog({ open: true, lesson })} />
      )}

      {coachDialog.open && (
        <CoachDialog coach={coachDialog.coach} onClose={() => setCoachDialog({ open: false })} />
      )}
      {lessonDialog.open && (
        <LessonDialog lesson={lessonDialog.lesson} onClose={() => setLessonDialog({ open: false })} />
      )}
    </div>
  );
}

/** Shared confirm modal for destructive actions (no global ConfirmDialog component exists). */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-danger" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-foregroundMuted">{message}</p>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>{t("Ləğv")}</Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoachesTab({ onEdit }: { onEdit: (c: AdminCoach) => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: venues = [] } = useVenueOptions();
  const { data: sports = [] } = useSportOptions();
  const [filters, setFilters] = React.useState({ venue_id: "", sport: "", is_active: "", q: "" });
  const setF = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const hasFilters = Object.values(filters).some((v) => v !== "");
  const { data: coaches = [], isLoading } = useAdminCoaches(cleanFilters(filters));
  const del = useDeleteCoach();
  const [confirm, setConfirm] = React.useState<AdminCoach | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={filterSelectCls} value={filters.venue_id} onChange={(e) => setF("venue_id", e.target.value)}>
          <option value="">{t("Bütün məkanlar")}</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select className={filterSelectCls} value={filters.sport} onChange={(e) => setF("sport", e.target.value)}>
          <option value="">{t("Bütün idmanlar")}</option>
          {sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
        </select>
        <select className={filterSelectCls} value={filters.is_active} onChange={(e) => setF("is_active", e.target.value)}>
          <option value="">{t("Bütün statuslar")}</option>
          <option value="true">{t("Aktiv")}</option>
          <option value="false">{t("Deaktiv")}</option>
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
          <Input value={filters.q} onChange={(e) => setF("q", e.target.value)} placeholder={t("Ad ilə axtar")} className="h-9 w-48 pl-8" />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ venue_id: "", sport: "", is_active: "", q: "" })}>{t("Sıfırla")}</Button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Məşqçi")}</TableHead>
              <TableHead>{t("Məkan")}</TableHead>
              <TableHead>{t("İdman")}</TableHead>
              <TableHead>{t("Reytinq")}</TableHead>
              <TableHead>{t("Saatlıq")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : coaches.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{hasFilters ? t("Filtrlərə uyğun məşqçi yoxdur") : t("Hələ məşqçi yoxdur")}</TableCell></TableRow>
            ) : (
              coaches.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold text-foreground">{c.display_name}</TableCell>
                  <TableCell className="text-foregroundMuted">{c.venue_name ?? "—"}</TableCell>
                  <TableCell className="capitalize text-foregroundMuted">{c.sport_slug ?? "—"}</TableCell>
                  <TableCell className="text-foregroundMuted">{c.rating != null ? c.rating.toFixed(1) : "—"}</TableCell>
                  <TableCell className="text-foregroundMuted">{money(c.hourly_rate_minor)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${c.is_active ? "bg-accent/15 text-[#3f6b00]" : "bg-foregroundMuted/15 text-foregroundMuted"}`}>
                      {c.is_active ? t("Aktiv") : t("Deaktiv")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" aria-label={t("Redaktə et")} onClick={() => onEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {c.is_active && (
                        <Button variant="ghost" size="sm" aria-label={t("Deaktiv et")} disabled={del.isPending} onClick={() => setConfirm(c)}>
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

      {confirm && (
        <ConfirmDialog
          title={t("Məşqçini deaktiv et")}
          message={t("«{name}» deaktiv ediləcək və yeni dərslərə təyin oluna bilməyəcək. Davam edək?").replace("{name}", confirm.display_name)}
          confirmLabel={t("Deaktiv et")}
          pending={del.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            del.mutate(confirm.id, {
              onSuccess: () => { toast.success(t("Məşqçi deaktiv edildi")); setConfirm(null); },
              onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
            })
          }
        />
      )}
    </div>
  );
}

function LessonsTab({ onEdit }: { onEdit: (l: AdminLesson) => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: venues = [] } = useVenueOptions();
  const { data: sports = [] } = useSportOptions();
  const [filters, setFilters] = React.useState({ venue_id: "", sport: "", status: "", kind: "" });
  const setF = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const hasFilters = Object.values(filters).some((v) => v !== "");
  const { data: lessons = [], isLoading } = useAdminLessons(cleanFilters(filters));
  const del = useDeleteLesson();
  const [confirm, setConfirm] = React.useState<AdminLesson | null>(null);
  const [roster, setRoster] = React.useState<AdminLesson | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={filterSelectCls} value={filters.venue_id} onChange={(e) => setF("venue_id", e.target.value)}>
          <option value="">{t("Bütün məkanlar")}</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select className={filterSelectCls} value={filters.sport} onChange={(e) => setF("sport", e.target.value)}>
          <option value="">{t("Bütün idmanlar")}</option>
          {sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
        </select>
        <select className={filterSelectCls} value={filters.status} onChange={(e) => setF("status", e.target.value)}>
          <option value="">{t("Bütün statuslar")}</option>
          <option value="scheduled">{t("Planlı")}</option>
          <option value="cancelled">{t("Ləğv")}</option>
          <option value="completed">{t("Bitmiş")}</option>
        </select>
        <select className={filterSelectCls} value={filters.kind} onChange={(e) => setF("kind", e.target.value)}>
          <option value="">{t("Bütün növlər")}</option>
          <option value="group">{t("Qrup")}</option>
          <option value="private">{t("Fərdi")}</option>
        </select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ venue_id: "", sport: "", status: "", kind: "" })}>{t("Sıfırla")}</Button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Dərs")}</TableHead>
              <TableHead>{t("Məşqçi")}</TableHead>
              <TableHead>{t("Tarix")}</TableHead>
              <TableHead>{t("Növ")}</TableHead>
              <TableHead>{t("Yer")}</TableHead>
              <TableHead>{t("Qiymət")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : lessons.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-foregroundMuted">{hasFilters ? t("Filtrlərə uyğun dərs yoxdur") : t("Hələ dərs yoxdur")}</TableCell></TableRow>
            ) : (
              lessons.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-semibold text-foreground">{l.title}</TableCell>
                  <TableCell className="text-foregroundMuted">{l.coach_name ?? "—"}</TableCell>
                  <TableCell className="text-foregroundMuted">{dt(l.starts_at)}</TableCell>
                  <TableCell className="text-foregroundMuted">{l.kind === "private" ? t("Fərdi") : t("Qrup")}</TableCell>
                  <TableCell className="text-foregroundMuted">{l.booked_count}/{l.capacity}</TableCell>
                  <TableCell className="text-foregroundMuted">{money(l.price_minor)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${l.status === "scheduled" ? "bg-accent/15 text-[#3f6b00]" : l.status === "cancelled" ? "bg-danger/15 text-danger" : "bg-foregroundMuted/15 text-foregroundMuted"}`}>
                      {l.status === "scheduled" ? t("Planlı") : l.status === "cancelled" ? t("Ləğv") : t("Bitmiş")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" aria-label={t("İştirakçılar")} onClick={() => setRoster(l)}><Users className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" aria-label={t("Redaktə et")} onClick={() => onEdit(l)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {l.status === "scheduled" && (
                        <Button variant="ghost" size="sm" aria-label={t("Ləğv")} disabled={del.isPending} onClick={() => setConfirm(l)}>
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

      {confirm && (
        <ConfirmDialog
          title={t("Dərsi ləğv et")}
          message={t("«{name}» dərsi ləğv ediləcək. Bron etmiş oyunçular xəbərdar olunmalıdır. Davam edək?").replace("{name}", confirm.title)}
          confirmLabel={t("Dərsi ləğv et")}
          pending={del.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            del.mutate(confirm.id, {
              onSuccess: () => { toast.success(t("Dərs ləğv edildi")); setConfirm(null); },
              onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
            })
          }
        />
      )}

      {roster && <RosterDialog lesson={roster} onClose={() => setRoster(null)} />}
    </div>
  );
}

function RosterDialog({ lesson, onClose }: { lesson: AdminLesson; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch, isFetching } = useLessonRoster(lesson.id);
  const items = data?.items ?? [];

  const statusBadge = (status: string) =>
    status === "booked" ? "success" : status === "cancelled" ? "danger" : status === "waitlisted" ? "warning" : "neutral";
  const statusLabel = (status: string) =>
    status === "booked" ? t("Bron edilib") : status === "cancelled" ? t("Ləğv edilib") : status === "waitlisted" ? t("Növbədə") : status;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            {t("İştirakçılar")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{lesson.title}</p>
          <p className="text-xs text-foregroundMuted">{dt(lesson.starts_at)} · {data?.booked_count ?? lesson.booked_count}/{lesson.capacity} {t("yer")}</p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</div>
          ) : isError ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-danger">{t("İştirakçıları yükləmək alınmadı")}</p>
              <Button variant="secondary" size="sm" className="mt-3" disabled={isFetching} onClick={() => void refetch()}>{t("Yenidən cəhd et")}</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-foregroundMuted">{t("Hələ bron yoxdur")}</div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{p.display_name ?? t("Adsız istifadəçi")}</p>
                    <p className="text-xs text-foregroundMuted">{dt(p.booked_at)}</p>
                  </div>
                  <Badge variant={statusBadge(p.status)}>{statusLabel(p.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>{t("Bağla")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoachDialog({ coach, onClose }: { coach?: AdminCoach; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: venues = [] } = useVenueOptions();
  const { data: sports = [] } = useSportOptions();
  const create = useCreateCoach();
  const update = useUpdateCoach();
  const editing = Boolean(coach);

  const [form, setForm] = React.useState({
    venue_id: coach?.venue_id ?? "",
    display_name: coach?.display_name ?? "",
    sport_id: coach?.sport_id ?? "",
    bio: coach?.bio ?? "",
    hourly_rate: coach?.hourly_rate_minor != null ? String(coach.hourly_rate_minor / 100) : "",
    years_experience: coach?.years_experience != null ? String(coach.years_experience) : "",
    is_active: coach?.is_active ?? true,
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const pending = create.isPending || update.isPending;

  function submit() {
    if (!form.venue_id || form.display_name.trim().length < 2) {
      toast.error(t("Məkan və ad tələb olunur"));
      return;
    }
    const data = {
      venue_id: form.venue_id,
      display_name: form.display_name.trim(),
      sport_id: form.sport_id || null,
      bio: form.bio.trim() || null,
      hourly_rate_minor: form.hourly_rate ? Math.round(Number(form.hourly_rate) * 100) : null,
      years_experience: form.years_experience ? Number(form.years_experience) : null,
      is_active: form.is_active,
    };
    const opts = {
      onSuccess: () => {
        toast.success(editing ? t("Məşqçi yeniləndi") : t("Məşqçi yaradıldı"));
        onClose();
      },
      onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
    };
    if (editing && coach) update.mutate({ id: coach.id, data }, opts);
    else create.mutate(data, opts);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("Məşqçini redaktə et") : t("Yeni məşqçi")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <Field label={t("Məkan")}>
            <select className={selectCls} value={form.venue_id} onChange={(e) => set("venue_id", e.target.value)}>
              <option value="">{t("Seçin")}…</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label={t("Ad")}>
            <Input value={form.display_name} onChange={(e) => set("display_name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("İdman")}>
              <select className={selectCls} value={form.sport_id} onChange={(e) => set("sport_id", e.target.value)}>
                <option value="">{t("Seçin")}…</option>
                {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={t("Saatlıq (₼)")}>
              <Input type="number" min={0} value={form.hourly_rate} onChange={(e) => set("hourly_rate", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Təcrübə (il)")}>
              <Input type="number" min={0} value={form.years_experience} onChange={(e) => set("years_experience", e.target.value)} />
            </Field>
            {editing && (
              <Field label={t("Status")}>
                <select className={selectCls} value={form.is_active ? "1" : "0"} onChange={(e) => set("is_active", e.target.value === "1")}>
                  <option value="1">{t("Aktiv")}</option>
                  <option value="0">{t("Deaktiv")}</option>
                </select>
              </Field>
            )}
          </div>
          <Field label={t("Haqqında")}>
            <Textarea rows={3} value={form.bio} onChange={(e) => set("bio", e.target.value)} />
          </Field>
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

function LessonDialog({ lesson, onClose }: { lesson?: AdminLesson; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: venues = [] } = useVenueOptions();
  const { data: sports = [] } = useSportOptions();
  const { data: coaches = [] } = useAdminCoaches();
  const create = useCreateLesson();
  const update = useUpdateLesson();
  const editing = Boolean(lesson);

  const [form, setForm] = React.useState({
    venue_id: lesson?.venue_id ?? "",
    coach_id: lesson?.coach_id ?? "",
    sport_id: lesson?.sport_id ?? "",
    title: lesson?.title ?? "",
    kind: lesson?.kind ?? "group",
    level_label: lesson?.level_label ?? "",
    starts_at: lesson?.starts_at ? lesson.starts_at.slice(0, 16) : "",
    duration_minutes: String(lesson?.duration_minutes ?? 60),
    capacity: String(lesson?.capacity ?? 4),
    price: lesson?.price_minor != null ? String(lesson.price_minor / 100) : "",
    status: lesson?.status ?? "scheduled",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const pending = create.isPending || update.isPending;
  const venueCoaches = coaches.filter((c) => !form.venue_id || c.venue_id === form.venue_id);

  function submit() {
    if (!form.venue_id || !form.coach_id || !form.sport_id || form.title.trim().length < 2 || !form.starts_at) {
      toast.error(t("Bütün vacib sahələri doldurun"));
      return;
    }
    const base = {
      venue_id: form.venue_id,
      coach_id: form.coach_id,
      sport_id: form.sport_id,
      title: form.title.trim(),
      kind: form.kind,
      level_label: form.level_label.trim() || null,
      starts_at: form.starts_at,
      duration_minutes: Number(form.duration_minutes),
      capacity: Number(form.capacity),
      price_minor: form.price ? Math.round(Number(form.price) * 100) : null,
    };
    const opts = {
      onSuccess: () => {
        toast.success(editing ? t("Dərs yeniləndi") : t("Dərs yaradıldı"));
        onClose();
      },
      onError: (err: Error) => toast.error(t("Alınmadı"), err.message),
    };
    if (editing && lesson) {
      // Only resend starts_at when the admin actually changed it. The API rejects
      // a past starts_at ("must be in the future"), so always-sending the original
      // time would block edits to already-started lessons (e.g. marking one
      // completed/cancelled) and could shift the stored time across timezones.
      const initialStarts = lesson.starts_at ? lesson.starts_at.slice(0, 16) : "";
      const { starts_at, ...rest } = base;
      const data =
        form.starts_at === initialStarts
          ? { ...rest, status: form.status }
          : { ...rest, starts_at, status: form.status };
      update.mutate({ id: lesson.id, data }, opts);
    } else {
      create.mutate(base, opts);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("Dərsi redaktə et") : t("Yeni dərs")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3.5 overflow-y-auto pr-1">
          <Field label={t("Məkan")}>
            <select className={selectCls} value={form.venue_id} onChange={(e) => { set("venue_id", e.target.value); set("coach_id", ""); }}>
              <option value="">{t("Seçin")}…</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Məşqçi")}>
              <select className={selectCls} value={form.coach_id} onChange={(e) => set("coach_id", e.target.value)}>
                <option value="">{t("Seçin")}…</option>
                {venueCoaches.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </Field>
            <Field label={t("İdman")}>
              <select className={selectCls} value={form.sport_id} onChange={(e) => set("sport_id", e.target.value)}>
                <option value="">{t("Seçin")}…</option>
                {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("Başlıq")}>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Növ")}>
              <select className={selectCls} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                <option value="group">{t("Qrup")}</option>
                <option value="private">{t("Fərdi")}</option>
              </select>
            </Field>
            <Field label={t("Səviyyə")}>
              <Input value={form.level_label} onChange={(e) => set("level_label", e.target.value)} placeholder={t("Başlanğıc")} />
            </Field>
          </div>
          <Field label={t("Vaxt")}>
            <Input type="datetime-local" value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("Müddət (dəq)")}>
              <Input type="number" min={15} value={form.duration_minutes} onChange={(e) => set("duration_minutes", e.target.value)} />
            </Field>
            <Field label={t("Tutum")}>
              <Input type="number" min={1} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
            </Field>
            <Field label={t("Qiymət (₼)")}>
              <Input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} />
            </Field>
          </div>
          {editing && (
            <Field label={t("Status")}>
              <select className={selectCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="scheduled">{t("Planlı")}</option>
                <option value="cancelled">{t("Ləğv")}</option>
                <option value="completed">{t("Bitmiş")}</option>
              </select>
            </Field>
          )}
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
