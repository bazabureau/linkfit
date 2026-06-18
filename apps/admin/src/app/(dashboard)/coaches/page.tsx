"use client";

import * as React from "react";
import { GraduationCap, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

function CoachesTab({ onEdit }: { onEdit: (c: AdminCoach) => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: coaches = [], isLoading } = useAdminCoaches();
  const del = useDeleteCoach();

  return (
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
            <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("Hələ məşqçi yoxdur")}</TableCell></TableRow>
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
                    <Button variant="ghost" size="sm" onClick={() => onEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                    {c.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          del.mutate(c.id, {
                            onSuccess: () => toast.success(t("Məşqçi deaktiv edildi")),
                            onError: () => toast.error(t("Alınmadı")),
                          })
                        }
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
  );
}

function LessonsTab({ onEdit }: { onEdit: (l: AdminLesson) => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: lessons = [], isLoading } = useAdminLessons();
  const del = useDeleteLesson();

  return (
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
            <TableRow><TableCell colSpan={8} className="py-10 text-center text-foregroundMuted">{t("Hələ dərs yoxdur")}</TableCell></TableRow>
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
                    <Button variant="ghost" size="sm" onClick={() => onEdit(l)}><Pencil className="h-3.5 w-3.5" /></Button>
                    {l.status === "scheduled" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          del.mutate(l.id, {
                            onSuccess: () => toast.success(t("Dərs ləğv edildi")),
                            onError: () => toast.error(t("Alınmadı")),
                          })
                        }
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
      onError: () => toast.error(t("Alınmadı")),
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
      onError: () => toast.error(t("Alınmadı")),
    };
    if (editing && lesson) update.mutate({ id: lesson.id, data: { ...base, status: form.status } }, opts);
    else create.mutate(base, opts);
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
