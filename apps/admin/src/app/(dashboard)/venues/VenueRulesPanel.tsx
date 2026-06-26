"use client";

import * as React from "react";
import { Clock, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Venue } from "@/lib/admin-venues";
import { Field } from "./lib";
import { SectionCard } from "./detail-ui";

// Opening hours are stored as a free-form object keyed by weekday. We support
// the common shape `{ "<key>": { open, close, closed } }` with a friendly
// per-day editor, and keep a raw-JSON escape hatch for anything non-standard.

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: "monday", label: "B.e" },
  { key: "tuesday", label: "Ç.a" },
  { key: "wednesday", label: "Çər" },
  { key: "thursday", label: "C.a" },
  { key: "friday", label: "Cüm" },
  { key: "saturday", label: "Şən" },
  { key: "sunday", label: "Baz" },
];

const DEFAULT_DAY: DayHours = { open: "08:00", close: "23:00", closed: false };

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function parseDay(raw: unknown): DayHours {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      open: asString(obj.open, DEFAULT_DAY.open),
      close: asString(obj.close, DEFAULT_DAY.close),
      closed: obj.closed === true,
    };
  }
  return { ...DEFAULT_DAY };
}

function readDays(source: Record<string, unknown> | null | undefined): Record<string, DayHours> {
  const result: Record<string, DayHours> = {};
  for (const { key } of WEEKDAYS) {
    result[key] = parseDay(source?.[key]);
  }
  return result;
}

export function VenueRulesPanel({
  venue,
  busy,
  onSave,
}: {
  venue: Venue;
  busy: boolean;
  onSave: (data: Partial<Venue>) => Promise<void>;
}): React.JSX.Element {
  const toast = useToast();
  const [slot, setSlot] = React.useState(String(venue.booking_slot_minutes ?? 30));
  const [min, setMin] = React.useState(String(venue.min_booking_minutes ?? 60));
  const [max, setMax] = React.useState(String(venue.max_booking_minutes ?? 120));
  const [cancelWindow, setCancelWindow] = React.useState(
    String(venue.cancellation_window_minutes ?? 120),
  );
  const [days, setDays] = React.useState<Record<string, DayHours>>(() =>
    readDays(venue.opening_hours),
  );

  // Re-sync the form when the venue prop changes (e.g. after a save the parent
  // re-renders with a freshly fetched, server-normalized venue). Mirrors
  // VenueForm's reset-on-`initial` effect so the panel never drifts from the
  // saved state. React Query's data is reference-stable across renders, so this
  // only fires on an actual data change.
  React.useEffect(() => {
    setSlot(String(venue.booking_slot_minutes ?? 30));
    setMin(String(venue.min_booking_minutes ?? 60));
    setMax(String(venue.max_booking_minutes ?? 120));
    setCancelWindow(String(venue.cancellation_window_minutes ?? 120));
    setDays(readDays(venue.opening_hours));
  }, [venue]);

  function patchDay(key: string, patch: Partial<DayHours>): void {
    setDays((current) => ({
      ...current,
      [key]: { ...(current[key] ?? DEFAULT_DAY), ...patch },
    }));
  }

  async function submit(): Promise<void> {
    const openingHours: Record<string, unknown> = {};
    for (const { key } of WEEKDAYS) {
      const day = days[key] ?? DEFAULT_DAY;
      openingHours[key] = day.closed
        ? { closed: true }
        : { open: day.open, close: day.close };
    }
    try {
      await onSave({
        booking_slot_minutes: Number(slot),
        min_booking_minutes: Number(min),
        max_booking_minutes: Number(max),
        cancellation_window_minutes: Number(cancelWindow),
        opening_hours: openingHours,
      });
    } catch {
      // Parent surfaces the error toast; keep the local form intact.
      toast.error("Qaydalar yenilənmədi");
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard
        title="Booking qaydaları"
        description="Slot, minimum/maksimum rezervasiya müddəti və ləğv pəncərəsi."
        bodyClassName="space-y-4 p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Slot dəqiqəsi" hint="Vaxt grid addımı">
            <Input
              type="number"
              min={5}
              value={slot}
              onChange={(event) => setSlot(event.target.value)}
            />
          </Field>
          <Field label="Minimum dəqiqə" hint="Ən qısa booking">
            <Input
              type="number"
              min={5}
              value={min}
              onChange={(event) => setMin(event.target.value)}
            />
          </Field>
          <Field label="Maksimum dəqiqə" hint="Ən uzun booking">
            <Input
              type="number"
              min={5}
              value={max}
              onChange={(event) => setMax(event.target.value)}
            />
          </Field>
          <Field label="Ləğv pəncərəsi" hint="Dəqiqə (cancellation window)">
            <Input
              type="number"
              min={0}
              value={cancelWindow}
              onChange={(event) => setCancelWindow(event.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Açılış saatları"
        description="Hər gün üçün açılış/bağlanış vaxtı və ya bağlı günlər."
        bodyClassName="space-y-2 p-5"
      >
        {WEEKDAYS.map(({ key, label }) => {
          const day = days[key] ?? DEFAULT_DAY;
          return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surfaceElevated/40 px-3 py-2.5"
            >
              <span className="flex w-12 items-center gap-1.5 text-sm font-semibold text-foreground">
                <Clock className="h-3.5 w-3.5 text-foregroundMuted" />
                {label}
              </span>
              {day.closed ? (
                <span className="flex-1 text-sm font-medium text-foregroundMuted">Bağlı</span>
              ) : (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    type="time"
                    value={day.open}
                    onChange={(event) => patchDay(key, { open: event.target.value })}
                    className="h-9 w-28"
                    aria-label={`${label} açılış`}
                  />
                  <span className="text-foregroundMuted">–</span>
                  <Input
                    type="time"
                    value={day.close}
                    onChange={(event) => patchDay(key, { close: event.target.value })}
                    className="h-9 w-28"
                    aria-label={`${label} bağlanış`}
                  />
                </div>
              )}
              <label className="ml-auto flex items-center gap-2 text-xs font-medium text-foregroundMuted">
                <input
                  type="checkbox"
                  checked={day.closed}
                  onChange={(event) => patchDay(key, { closed: event.target.checked })}
                  className="h-4 w-4 rounded border-borderStrong accent-[var(--color-accent,#B7F233)]"
                />
                Bağlı
              </label>
            </div>
          );
        })}
      </SectionCard>

      <div className="xl:col-span-2">
        <Button onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Qaydaları yadda saxla
        </Button>
      </div>
    </div>
  );
}
