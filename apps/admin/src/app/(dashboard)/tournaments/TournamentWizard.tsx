"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  CircleDollarSign,
  FileText,
  Loader2,
  MapPin,
  Save,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  formatDateRange,
  formatMoney,
  useCreateTournament,
  useSports,
  useUpdateTournament,
  type Tournament,
  type TournamentPayload,
  type TournamentStatus,
} from "@/lib/admin-tournaments";
import { useVenues, type Venue } from "@/lib/admin-venues";

// ─── Form schema ───────────────────────────────────────────────────────

const CURRENCIES = ["AZN", "USD", "EUR"] as const;

const wizardSchema = z
  .object({
    name: z.string().min(2, "Ad ən azı 2 simvol olmalıdır").max(200),
    description: z.string().max(4000).optional().nullable(),
    sport_id: z.string().uuid("İdman növü seçin"),
    venue_id: z.string().uuid().nullable(),
    starts_at: z.string().min(1, "Başlama tarixi tələb olunur"),
    ends_at: z.string().min(1, "Bitmə tarixi tələb olunur"),
    registration_deadline: z.string().optional().nullable(),
    max_squads: z
      .number({ invalid_type_error: "Tələb olunur" })
      .int()
      .min(2, "Ən azı 2 komanda")
      .max(256, "Maksimum 256 komanda"),
    squad_size: z
      .number({ invalid_type_error: "Tələb olunur" })
      .int()
      .min(1, "Ən azı 1 oyunçu")
      .max(20, "Maksimum 20 oyunçu"),
    is_free: z.boolean(),
    entry_fee_major: z.string(),
    currency: z.enum(CURRENCIES),
    status: z.enum([
      "announced",
      "registration_open",
      "registration_closed",
      "in_progress",
      "completed",
      "cancelled",
    ]),
  })
  .superRefine((data, ctx) => {
    if (data.starts_at && data.ends_at) {
      if (new Date(data.ends_at) <= new Date(data.starts_at)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bitmə başlanğıcdan sonra olmalıdır",
          path: ["ends_at"],
        });
      }
    }
    if (data.registration_deadline && data.starts_at) {
      if (new Date(data.registration_deadline) > new Date(data.starts_at)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Son tarix başlanğıcdan əvvəl olmalıdır",
          path: ["registration_deadline"],
        });
      }
    }
    if (!data.is_free) {
      if (!/^\d+([.,]\d{1,2})?$/.test(data.entry_fee_major)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Düzgün məbləğ daxil edin (məs. 10 və ya 10.50)",
          path: ["entry_fee_major"],
        });
      }
    }
  });

type WizardFormValues = z.infer<typeof wizardSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────

function majorToMinor(input: string): number {
  const normalized = input.replace(",", ".");
  const num = Number.parseFloat(normalized);
  if (Number.isNaN(num)) return 0;
  return Math.round(num * 100);
}

function minorToMajor(minor: number): string {
  return (minor / 100).toFixed(2);
}

function toLocalInputValue(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local: string): string {
  if (!local) return "";
  return new Date(local).toISOString();
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string };
    if (e.status === 409) return e.message ?? fallback;
    if (e.status === 400) return e.message ?? fallback;
    if (e.message) return e.message;
  }
  return fallback;
}

const selectClass =
  "mt-1.5 flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

// ─── Steps ─────────────────────────────────────────────────────────────

interface StepDef {
  key: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: (keyof WizardFormValues)[];
}

const STEPS: StepDef[] = [
  {
    key: "basics",
    title: "Əsaslar",
    description: "Ad, idman növü və qısa təsvir.",
    icon: Trophy,
    fields: ["name", "sport_id", "description"],
  },
  {
    key: "schedule",
    title: "Vaxt və məkan",
    description: "Tarixləri seç və (istəyə bağlı) məkan təyin et.",
    icon: Calendar,
    fields: ["starts_at", "ends_at", "registration_deadline", "venue_id"],
  },
  {
    key: "format",
    title: "Format",
    description: "Komanda ölçüsü və turnir tutumu.",
    icon: Users,
    fields: ["max_squads", "squad_size"],
  },
  {
    key: "entry",
    title: "İştirak",
    description: "Pulsuz yoxsa ödənişli? İştirak haqqını təyin et.",
    icon: CircleDollarSign,
    fields: ["is_free", "entry_fee_major", "currency"],
  },
  {
    key: "review",
    title: "Yoxlama",
    description: "Son yoxlama, sonra dərc et.",
    icon: Check,
    fields: [],
  },
];

// ─── Component ─────────────────────────────────────────────────────────

export interface TournamentWizardProps {
  initial?: Tournament | null;
}

export function TournamentWizard({ initial }: TournamentWizardProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const isEdit = Boolean(initial);

  const { data: sports = [] } = useSports();
  const { data: venues = [] } = useVenues({ limit: 100 });

  const createMut = useCreateTournament();
  const updateMut = useUpdateTournament();

  const form = useForm<WizardFormValues>({
    resolver: zodResolver(wizardSchema),
    mode: "onChange",
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      sport_id: initial?.sport_id ?? "",
      venue_id: initial?.venue_id ?? null,
      starts_at: toLocalInputValue(initial?.starts_at),
      ends_at: toLocalInputValue(initial?.ends_at),
      registration_deadline: toLocalInputValue(initial?.registration_deadline),
      max_squads: initial?.max_squads ?? 8,
      squad_size: initial?.squad_size ?? 4,
      is_free: initial ? initial.entry_fee_minor === 0 : true,
      entry_fee_major: initial ? minorToMajor(initial.entry_fee_minor) : "0.00",
      currency: (initial?.currency as (typeof CURRENCIES)[number]) ?? "AZN",
      status: initial?.status ?? "announced",
    },
  });

  const [stepIndex, setStepIndex] = React.useState(0);
  const currentStep = STEPS[stepIndex]!;

  const canAdvance = async () => {
    if (currentStep.fields.length === 0) return true;
    return form.trigger(currentStep.fields);
  };

  const goNext = async () => {
    if (await canAdvance()) setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const buildPayload = (
    values: WizardFormValues,
    statusOverride?: TournamentStatus,
  ): TournamentPayload => ({
    name: values.name.trim(),
    description: values.description?.trim() ? values.description.trim() : null,
    sport_id: values.sport_id,
    venue_id: values.venue_id,
    starts_at: fromLocalInputValue(values.starts_at),
    ends_at: fromLocalInputValue(values.ends_at),
    registration_deadline: values.registration_deadline
      ? fromLocalInputValue(values.registration_deadline)
      : null,
    max_squads: values.max_squads,
    squad_size: values.squad_size,
    entry_fee_minor: values.is_free ? 0 : majorToMinor(values.entry_fee_major),
    currency: values.currency,
    status: statusOverride ?? values.status,
  });

  const submit = async (statusOverride?: TournamentStatus) => {
    const ok = await form.trigger();
    if (!ok) {
      toast.error(t("Formada xətalar var"), t("Davam etməzdən əvvəl qeyd edilmiş sahələri düzəldin"));
      return;
    }
    const payload = buildPayload(form.getValues(), statusOverride);
    try {
      if (initial) {
        const updated = await updateMut.mutateAsync({ id: initial.id, data: payload });
        toast.success(t("Turnir yadda saxlanıldı"), updated.name);
        router.push(`/tournaments/${updated.id}`);
      } else {
        const created = await createMut.mutateAsync(payload);
        toast.success(t("Turnir yaradıldı"), created.name);
        router.push(`/tournaments/${created.id}`);
      }
    } catch (err) {
      toast.error(
        isEdit ? t("Yadda saxlama alınmadı") : t("Yaratma alınmadı"),
        getErrorMessage(err, t("Turnir yadda saxlanılmadı")),
      );
    }
  };

  const saveAsDraft = () => submit("announced");
  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-5">
      <ProgressDots stepIndex={stepIndex} onPick={setStepIndex} t={t} />

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-7">
        <div className="mb-6 flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-[#3f6b00]">
            <currentStep.icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{t(currentStep.title)}</h2>
            <p className="text-sm text-foregroundMuted">{t(currentStep.description)}</p>
          </div>
        </div>

        <div className="min-h-[320px]">
          {currentStep.key === "basics" && <BasicsStep form={form} sports={sports} t={t} />}
          {currentStep.key === "schedule" && <ScheduleStep form={form} venues={venues} t={t} />}
          {currentStep.key === "format" && <FormatStep form={form} t={t} />}
          {currentStep.key === "entry" && <EntryStep form={form} t={t} />}
          {currentStep.key === "review" && <ReviewStep form={form} sports={sports} venues={venues} t={t} />}
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/tournaments")}
              disabled={submitting}
            >
              {t("İmtina et")}
            </Button>
            <Button type="button" variant="secondary" onClick={saveAsDraft} disabled={submitting}>
              <Save className="h-3.5 w-3.5" />
              {t("Qaralama kimi saxla")}
            </Button>
          </div>
          <div className="flex gap-2 sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={goBack}
              disabled={stepIndex === 0 || submitting}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("Geri")}
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext} disabled={submitting}>
                {t("Növbəti")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button type="button" onClick={() => submit()} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {isEdit ? t("Dəyişiklikləri saxla") : t("Turniri dərc et")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Progress dots ─────────────────────────────────────────────────────

function ProgressDots({
  stepIndex,
  onPick,
  t,
}: {
  stepIndex: number;
  onPick: (i: number) => void;
  t: (s: string) => string;
}): React.JSX.Element {
  return (
    <ol className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-3 shadow-card sm:gap-3 sm:px-5">
      {STEPS.map((s, i) => {
        const isActive = i === stepIndex;
        const isDone = i < stepIndex;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => onPick(i)}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                isActive
                  ? "border-accent bg-accent text-ink"
                  : isDone
                    ? "border-accent/40 bg-accent/10 text-[#3f6b00]"
                    : "border-border bg-surfaceElevated text-foregroundMuted",
              )}
              aria-label={`${t(s.title)}`}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
            <div className="hidden min-w-0 flex-1 sm:block">
              <p
                className={cn(
                  "truncate text-xs font-semibold",
                  isActive ? "text-foreground" : "text-foregroundMuted",
                )}
              >
                {t(s.title)}
              </p>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn("h-px flex-1 transition-colors", isDone ? "bg-accent/40" : "bg-border")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Basics ───────────────────────────────────────────────────

function BasicsStep({
  form,
  sports,
  t,
}: {
  form: UseFormReturn<WizardFormValues>;
  sports: { id: string; name: string }[];
  t: (s: string) => string;
}): React.JSX.Element {
  const { register, formState } = form;
  const errors = formState.errors;
  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="w-name">{t("Turnir adı")}</Label>
        <Input
          id="w-name"
          {...register("name")}
          placeholder="Spring Padel Cup 2026"
          className="mt-1.5"
        />
        {errors.name && <p className="mt-1 text-xs text-danger">{errors.name.message}</p>}
      </div>
      <div>
        <Label htmlFor="w-sport">{t("İdman növü")}</Label>
        <select id="w-sport" {...register("sport_id")} className={selectClass}>
          <option value="">{t("İdman növü seç…")}</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {errors.sport_id && <p className="mt-1 text-xs text-danger">{errors.sport_id.message}</p>}
      </div>
      <div>
        <Label htmlFor="w-description">{t("Təsvir (istəyə bağlı)")}</Label>
        <Textarea
          id="w-description"
          {...register("description")}
          rows={4}
          placeholder={t("Format, mükafatlar, məkan haqqında — kapitanların bilməli olduğu hər şey.")}
          className="mt-1.5"
        />
      </div>
    </div>
  );
}

// ─── Step 2: Schedule ─────────────────────────────────────────────────

function ScheduleStep({
  form,
  venues,
  t,
}: {
  form: UseFormReturn<WizardFormValues>;
  venues: Venue[];
  t: (s: string) => string;
}): React.JSX.Element {
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;
  const venueId = watch("venue_id");
  const [venueSearch, setVenueSearch] = React.useState("");

  const filteredVenues = React.useMemo(() => {
    const q = venueSearch.trim().toLowerCase();
    if (!q) return venues.slice(0, 30);
    return venues
      .filter((v) => v.name.toLowerCase().includes(q) || v.address.toLowerCase().includes(q))
      .slice(0, 30);
  }, [venues, venueSearch]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="w-starts">{t("Başlama vaxtı")}</Label>
          <Input id="w-starts" type="datetime-local" {...register("starts_at")} className="mt-1.5" />
          {errors.starts_at && (
            <p className="mt-1 text-xs text-danger">{errors.starts_at.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="w-ends">{t("Bitmə vaxtı")}</Label>
          <Input id="w-ends" type="datetime-local" {...register("ends_at")} className="mt-1.5" />
          {errors.ends_at && <p className="mt-1 text-xs text-danger">{errors.ends_at.message}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="w-deadline">{t("Qeydiyyat son tarixi (istəyə bağlı)")}</Label>
        <Input
          id="w-deadline"
          type="datetime-local"
          {...register("registration_deadline")}
          className="mt-1.5"
        />
        {errors.registration_deadline && (
          <p className="mt-1 text-xs text-danger">{errors.registration_deadline.message}</p>
        )}
        <p className="mt-1 text-xs text-foregroundMuted">
          {t("Bu andan sonra kapitanlar yeni komanda qeydiyyatı edə bilməz.")}
        </p>
      </div>
      <div>
        <Label htmlFor="w-venue-search">{t("Məkan (istəyə bağlı)")}</Label>
        <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            id="w-venue-search"
            value={venueSearch}
            onChange={(e) => setVenueSearch(e.target.value)}
            placeholder={t("Ad və ya ünvan üzrə axtar…")}
          />
          {venueId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setValue("venue_id", null, { shouldDirty: true })}
            >
              {t("Təmizlə")}
            </Button>
          )}
        </div>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-surfaceElevated">
          {filteredVenues.length === 0 ? (
            <div className="p-3 text-center text-xs text-foregroundMuted">
              {t("Bu axtarışa uyğun məkan yoxdur.")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredVenues.map((v) => {
                const selected = v.id === venueId;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setValue("venue_id", v.id, { shouldDirty: true })}
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        selected ? "bg-accent/10 text-foreground" : "hover:bg-surface",
                      )}
                    >
                      <MapPin
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          selected ? "text-accent" : "text-foregroundMuted",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{v.name}</span>
                        <span className="block truncate text-xs text-foregroundMuted">
                          {v.address}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Format ───────────────────────────────────────────────────

function FormatStep({
  form,
  t,
}: {
  form: UseFormReturn<WizardFormValues>;
  t: (s: string) => string;
}): React.JSX.Element {
  const { register, formState } = form;
  const errors = formState.errors;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="w-max">{t("Maksimum komanda")}</Label>
          <Input
            id="w-max"
            type="number"
            min={2}
            max={256}
            {...register("max_squads", { valueAsNumber: true })}
            className="mt-1.5"
          />
          {errors.max_squads && (
            <p className="mt-1 text-xs text-danger">{errors.max_squads.message}</p>
          )}
          <p className="mt-1 text-xs text-foregroundMuted">
            {t("Brackete buraxılan komandaların üst limiti.")}
          </p>
        </div>
        <div>
          <Label htmlFor="w-size">{t("Komanda ölçüsü")}</Label>
          <Input
            id="w-size"
            type="number"
            min={1}
            max={20}
            {...register("squad_size", { valueAsNumber: true })}
            className="mt-1.5"
          />
          {errors.squad_size && (
            <p className="mt-1 text-xs text-danger">{errors.squad_size.message}</p>
          )}
          <p className="mt-1 text-xs text-foregroundMuted">
            {t("Kapitan daxil olmaqla komandadakı oyunçu sayı.")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Entry ────────────────────────────────────────────────────

function EntryStep({
  form,
  t,
}: {
  form: UseFormReturn<WizardFormValues>;
  t: (s: string) => string;
}): React.JSX.Element {
  const { register, watch, setValue, formState } = form;
  const errors = formState.errors;
  const isFree = watch("is_free");
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-xl border border-border bg-surfaceElevated px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t("Pulsuz iştirak")}</p>
          <p className="text-xs text-foregroundMuted">{t("Kapitanlar ödəniş etmədən qeydiyyatdan keçə bilər.")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isFree}
          onClick={() => setValue("is_free", !isFree, { shouldDirty: true })}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            isFree ? "bg-accent" : "bg-border",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
              isFree ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
      {!isFree && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
          <div>
            <Label htmlFor="w-fee">{t("İştirak haqqı")}</Label>
            <Input
              id="w-fee"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              {...register("entry_fee_major")}
              className="mt-1.5"
            />
            {errors.entry_fee_major && (
              <p className="mt-1 text-xs text-danger">{errors.entry_fee_major.message}</p>
            )}
            <p className="mt-1 text-xs text-foregroundMuted">
              {t("Daxildə minor vahid kimi saxlanılır (məs. 10.50 → 1050).")}
            </p>
          </div>
          <div>
            <Label htmlFor="w-currency">{t("Valyuta")}</Label>
            <select id="w-currency" {...register("currency")} className={selectClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────

function ReviewStep({
  form,
  sports,
  venues,
  t,
}: {
  form: UseFormReturn<WizardFormValues>;
  sports: { id: string; name: string }[];
  venues: Venue[];
  t: (s: string) => string;
}): React.JSX.Element {
  const { register, watch } = form;
  const values = watch();
  const sport = sports.find((s) => s.id === values.sport_id);
  const venue = venues.find((v) => v.id === values.venue_id);
  const fee = values.is_free ? 0 : majorToMinor(values.entry_fee_major || "0");

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-2xl border border-border bg-surfaceElevated p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold   text-foregroundMuted">
              {t("Turnir")}
            </p>
            <h3 className="truncate font-display text-lg font-bold text-foreground">
              {values.name || t("Adsız turnir")}
            </h3>
            {values.description ? (
              <p className="mt-1 line-clamp-3 text-sm text-foregroundMuted">{values.description}</p>
            ) : null}
          </div>
          <span className="inline-flex shrink-0 items-center rounded-lg bg-surface px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-border">
            {sport?.name ?? "—"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label={t("Tarixlər")} icon={Calendar}>
            {values.starts_at && values.ends_at
              ? formatDateRange(
                  fromLocalInputValue(values.starts_at),
                  fromLocalInputValue(values.ends_at),
                )
              : "—"}
          </Row>
          <Row label={t("Məkan")} icon={MapPin}>
            {venue ? venue.name : t("Onlayn / Təyin olunmayıb")}
          </Row>
          <Row label={t("Format")} icon={Users}>
            {values.max_squads} {t("komanda")} × {values.squad_size} {t("oyunçu")}
          </Row>
          <Row label={t("İştirak")} icon={CircleDollarSign}>
            {formatMoney(fee, values.currency)}
          </Row>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-foregroundMuted" />
          <div className="flex-1">
            <Label htmlFor="w-status">{t("Dərc statusu")}</Label>
            <select id="w-status" {...register("status")} className={selectClass}>
              <option value="announced">{t("Qaralama — elan edilib, qeydiyyat açıq deyil")}</option>
              <option value="registration_open">{t("Canlı — qeydiyyat açıq")}</option>
              <option value="registration_closed">{t("Qeydiyyat bağlı")}</option>
              <option value="in_progress">{t("Davam edir")}</option>
              <option value="completed">{t("Tamamlanıb")}</option>
              <option value="cancelled">{t("Ləğv edilib")}</option>
            </select>
            <p className="mt-1 text-xs text-foregroundMuted">
              {t("Statusu istənilən vaxt detal səhifəsindən dəyişə bilərsiniz.")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foregroundMuted" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold   text-foregroundMuted">
          {label}
        </p>
        <p className="text-sm text-foreground">{children}</p>
      </div>
    </div>
  );
}
