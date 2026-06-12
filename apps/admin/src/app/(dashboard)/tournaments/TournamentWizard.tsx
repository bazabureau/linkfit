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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
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
    name: z.string().min(2, "Name must be at least 2 characters").max(200),
    description: z.string().max(4000).optional().nullable(),
    sport_id: z.string().uuid("Pick a sport"),
    venue_id: z.string().uuid().nullable(),
    starts_at: z.string().min(1, "Start date is required"),
    ends_at: z.string().min(1, "End date is required"),
    registration_deadline: z.string().optional().nullable(),
    max_squads: z
      .number({ invalid_type_error: "Required" })
      .int()
      .min(2, "At least 2 squads")
      .max(256, "Max 256 squads"),
    squad_size: z
      .number({ invalid_type_error: "Required" })
      .int()
      .min(1, "At least 1 player")
      .max(20, "Max 20 players"),
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
          message: "End must be after start",
          path: ["ends_at"],
        });
      }
    }
    if (data.registration_deadline && data.starts_at) {
      if (new Date(data.registration_deadline) > new Date(data.starts_at)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Deadline must be on or before start",
          path: ["registration_deadline"],
        });
      }
    }
    if (!data.is_free) {
      if (!/^\d+([.,]\d{1,2})?$/.test(data.entry_fee_major)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid amount (e.g. 10 or 10.50)",
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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local: string): string {
  if (!local) return "";
  return new Date(local).toISOString();
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string };
    if (e.status === 409) {
      return e.message ?? "Conflict — the tournament can't be saved in its current state.";
    }
    if (e.status === 400) {
      return e.message ?? "Validation failed. Double-check the form.";
    }
    if (e.message) return e.message;
  }
  return fallback;
}

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
    title: "Basics",
    description: "Name, sport, and a short description.",
    icon: Trophy,
    fields: ["name", "sport_id", "description"],
  },
  {
    key: "schedule",
    title: "When & where",
    description: "Pick dates and (optionally) a venue.",
    icon: Calendar,
    fields: ["starts_at", "ends_at", "registration_deadline", "venue_id"],
  },
  {
    key: "format",
    title: "Format",
    description: "Squad size and tournament capacity.",
    icon: Users,
    fields: ["max_squads", "squad_size"],
  },
  {
    key: "entry",
    title: "Entry",
    description: "Free or paid? Set the entry fee.",
    icon: CircleDollarSign,
    fields: ["is_free", "entry_fee_major", "currency"],
  },
  {
    key: "review",
    title: "Review",
    description: "Final check, then publish.",
    icon: Check,
    fields: [],
  },
];

// ─── Component ─────────────────────────────────────────────────────────

export interface TournamentWizardProps {
  initial?: Tournament | null;
}

export function TournamentWizard({
  initial,
}: TournamentWizardProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
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

  // Step validation: only fire validation on the current step's fields.
  const canAdvance = async () => {
    if (currentStep.fields.length === 0) return true;
    const ok = await form.trigger(currentStep.fields);
    return ok;
  };

  const goNext = async () => {
    if (await canAdvance()) {
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    }
  };
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const buildPayload = (values: WizardFormValues, statusOverride?: TournamentStatus): TournamentPayload => ({
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
      toast.error("Form has errors", "Fix the highlighted fields before continuing");
      return;
    }
    const values = form.getValues();
    const payload = buildPayload(values, statusOverride);
    try {
      if (initial) {
        const updated = await updateMut.mutateAsync({ id: initial.id, data: payload });
        toast.success("Tournament saved", updated.name);
        router.push(`/tournaments/${updated.id}`);
      } else {
        const created = await createMut.mutateAsync(payload);
        toast.success("Tournament created", created.name);
        router.push(`/tournaments/${created.id}`);
      }
    } catch (err) {
      toast.error(
        isEdit ? "Save failed" : "Create failed",
        getErrorMessage(err, "Could not save tournament"),
      );
    }
  };

  const saveAsDraft = () => submit("announced");
  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6">
      <ProgressDots stepIndex={stepIndex} onPick={setStepIndex} />

      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-xl bg-accent/15 p-2.5 text-accent">
            <currentStep.icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{currentStep.title}</h2>
            <p className="text-sm text-foregroundMuted">{currentStep.description}</p>
          </div>
        </div>

        <div className="min-h-[320px]">
          {currentStep.key === "basics" && (
            <BasicsStep form={form} sports={sports} />
          )}
          {currentStep.key === "schedule" && (
            <ScheduleStep form={form} venues={venues} />
          )}
          {currentStep.key === "format" && <FormatStep form={form} />}
          {currentStep.key === "entry" && <EntryStep form={form} />}
          {currentStep.key === "review" && (
            <ReviewStep
              form={form}
              sports={sports}
              venues={venues}
            />
          )}
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/tournaments")}
              disabled={submitting}
            >
              Discard
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={saveAsDraft}
              disabled={submitting}
            >
              <Save className="h-3.5 w-3.5" />
              Save as draft
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
              Back
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext} disabled={submitting}>
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => submit()}
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {isEdit ? "Save changes" : "Publish tournament"}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Progress dots ─────────────────────────────────────────────────────

function ProgressDots({
  stepIndex,
  onPick,
}: {
  stepIndex: number;
  onPick: (i: number) => void;
}): React.JSX.Element {
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {STEPS.map((s, i) => {
        const isActive = i === stepIndex;
        const isDone = i < stepIndex;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => onPick(i)}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                isActive
                  ? "border-accent bg-accent text-black"
                  : isDone
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border bg-surfaceElevated text-foregroundMuted",
              )}
              aria-label={`Step ${String(i + 1)}: ${s.title}`}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
            <div className="hidden min-w-0 flex-1 sm:block">
              <p
                className={cn(
                  "truncate text-xs font-medium",
                  isActive ? "text-foreground" : "text-foregroundMuted",
                )}
              >
                {s.title}
              </p>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 transition-colors",
                  isDone ? "bg-accent/40" : "bg-border",
                )}
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
}: {
  form: UseFormReturn<WizardFormValues>;
  sports: { id: string; name: string }[];
}): React.JSX.Element {
  const { register, formState } = form;
  const errors = formState.errors;
  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="w-name">Tournament name</Label>
        <Input
          id="w-name"
          {...register("name")}
          placeholder="Spring Padel Cup 2026"
          className="mt-1.5"
        />
        {errors.name && (
          <p className="mt-1 text-xs text-danger">{errors.name.message}</p>
        )}
      </div>
      <div>
        <Label htmlFor="w-sport">Sport</Label>
        <select
          id="w-sport"
          {...register("sport_id")}
          className="mt-1.5 flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <option value="">Select a sport…</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {errors.sport_id && (
          <p className="mt-1 text-xs text-danger">{errors.sport_id.message}</p>
        )}
      </div>
      <div>
        <Label htmlFor="w-description">Description (optional)</Label>
        <Textarea
          id="w-description"
          {...register("description")}
          rows={4}
          placeholder="Pitch the format, prizes, location vibe — anything captains should know."
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
}: {
  form: UseFormReturn<WizardFormValues>;
  venues: Venue[];
}): React.JSX.Element {
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;
  const venueId = watch("venue_id");
  const [venueSearch, setVenueSearch] = React.useState("");

  const filteredVenues = React.useMemo(() => {
    const q = venueSearch.trim().toLowerCase();
    if (!q) return venues.slice(0, 30);
    return venues
      .filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.address.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [venues, venueSearch]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="w-starts">Starts at</Label>
          <Input
            id="w-starts"
            type="datetime-local"
            {...register("starts_at")}
            className="mt-1.5"
          />
          {errors.starts_at && (
            <p className="mt-1 text-xs text-danger">{errors.starts_at.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="w-ends">Ends at</Label>
          <Input
            id="w-ends"
            type="datetime-local"
            {...register("ends_at")}
            className="mt-1.5"
          />
          {errors.ends_at && (
            <p className="mt-1 text-xs text-danger">{errors.ends_at.message}</p>
          )}
        </div>
      </div>
      <div>
        <Label htmlFor="w-deadline">Registration deadline (optional)</Label>
        <Input
          id="w-deadline"
          type="datetime-local"
          {...register("registration_deadline")}
          className="mt-1.5"
        />
        {errors.registration_deadline && (
          <p className="mt-1 text-xs text-danger">
            {errors.registration_deadline.message}
          </p>
        )}
        <p className="mt-1 text-xs text-foregroundMuted">
          After this moment, captains can't register new squads.
        </p>
      </div>
      <div>
        <Label htmlFor="w-venue-search">Venue (optional)</Label>
        <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            id="w-venue-search"
            value={venueSearch}
            onChange={(e) => setVenueSearch(e.target.value)}
            placeholder="Search by name or address…"
          />
          {venueId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setValue("venue_id", null, { shouldDirty: true })}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-surfaceElevated">
          {filteredVenues.length === 0 ? (
            <div className="p-3 text-center text-xs text-foregroundMuted">
              No venues match this search.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredVenues.map((v) => {
                const selected = v.id === venueId;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setValue("venue_id", v.id, { shouldDirty: true })
                      }
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        selected
                          ? "bg-accent/10 text-foreground"
                          : "hover:bg-surface",
                      )}
                    >
                      <MapPin
                        className={cn(
                          "h-4 w-4 mt-0.5 shrink-0",
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
}: {
  form: UseFormReturn<WizardFormValues>;
}): React.JSX.Element {
  const { register, formState } = form;
  const errors = formState.errors;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="w-max">Max squads</Label>
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
            Upper limit of squads admitted into the bracket.
          </p>
        </div>
        <div>
          <Label htmlFor="w-size">Squad size</Label>
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
            Players per squad including the captain.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Entry ────────────────────────────────────────────────────

function EntryStep({
  form,
}: {
  form: UseFormReturn<WizardFormValues>;
}): React.JSX.Element {
  const { register, watch, setValue, formState } = form;
  const errors = formState.errors;
  const isFree = watch("is_free");
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-xl border border-border bg-surfaceElevated px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">Free entry</p>
          <p className="text-xs text-foregroundMuted">
            Captains can register without paying.
          </p>
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
            <Label htmlFor="w-fee">Entry fee</Label>
            <Input
              id="w-fee"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              {...register("entry_fee_major")}
              className="mt-1.5"
            />
            {errors.entry_fee_major && (
              <p className="mt-1 text-xs text-danger">
                {errors.entry_fee_major.message}
              </p>
            )}
            <p className="mt-1 text-xs text-foregroundMuted">
              Stored internally as minor units (e.g. 10.50 → 1050).
            </p>
          </div>
          <div>
            <Label htmlFor="w-currency">Currency</Label>
            <select
              id="w-currency"
              {...register("currency")}
              className="mt-1.5 flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
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
}: {
  form: UseFormReturn<WizardFormValues>;
  sports: { id: string; name: string }[];
  venues: Venue[];
}): React.JSX.Element {
  const { register, watch } = form;
  const values = watch();
  const sport = sports.find((s) => s.id === values.sport_id);
  const venue = venues.find((v) => v.id === values.venue_id);
  const fee = values.is_free
    ? 0
    : majorToMinor(values.entry_fee_major || "0");

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-foregroundMuted">
              Tournament
            </p>
            <h3 className="truncate text-lg font-semibold text-foreground">
              {values.name || "Untitled tournament"}
            </h3>
            {values.description ? (
              <p className="mt-1 line-clamp-3 text-sm text-foregroundMuted">
                {values.description}
              </p>
            ) : null}
          </div>
          <Badge variant="default">{sport?.name ?? "—"}</Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Dates" icon={Calendar}>
            {values.starts_at && values.ends_at
              ? formatDateRange(
                  fromLocalInputValue(values.starts_at),
                  fromLocalInputValue(values.ends_at),
                )
              : "—"}
          </Row>
          <Row label="Venue" icon={MapPin}>
            {venue ? venue.name : "Online / TBD"}
          </Row>
          <Row label="Format" icon={Users}>
            {values.max_squads} squads × {values.squad_size} players
          </Row>
          <Row label="Entry" icon={CircleDollarSign}>
            {formatMoney(fee, values.currency)}
          </Row>
        </div>
      </Card>

      <div className="rounded-xl border border-border bg-surfaceElevated p-5">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-foregroundMuted" />
          <div className="flex-1">
            <Label htmlFor="w-status">Publish as</Label>
            <select
              id="w-status"
              {...register("status")}
              className="mt-1.5 flex h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <option value="announced">
                Draft — announced, registration not yet open
              </option>
              <option value="registration_open">
                Go live — registration open
              </option>
              <option value="registration_closed">Registration closed</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <p className="mt-1 text-xs text-foregroundMuted">
              You can change status any time from the detail page.
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
        <p className="text-[11px] uppercase tracking-wider text-foregroundMuted">
          {label}
        </p>
        <p className="text-sm text-foreground">{children}</p>
      </div>
    </div>
  );
}
