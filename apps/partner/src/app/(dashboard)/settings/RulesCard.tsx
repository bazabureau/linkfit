"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCog, Loader2, Save, Clock, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  usePartnerRules,
  useUpdatePartnerRules,
} from "@/lib/partner-queries";
import { SectionCard } from "./SectionCard";

interface RulesForm {
  bookingSlotMinutes: string;
  minBookingMinutes: string;
  maxBookingMinutes: string;
  cancellationWindowMinutes: string;
}

const EMPTY: RulesForm = {
  bookingSlotMinutes: "",
  minBookingMinutes: "",
  maxBookingMinutes: "",
  cancellationWindowMinutes: "",
};

/**
 * Booking-rules editor wired to GET/PUT /partner/rules. Opening-hours editing is
 * intentionally left to a future iteration; here we manage the numeric slot /
 * duration / cancellation-window rules that drive availability and refunds.
 */
export function RulesCard({ step }: { step: number }): React.JSX.Element {
  const toast = useToast();
  const { data: rules, isLoading, isError, refetch, isFetching } = usePartnerRules();
  const updateMut = useUpdatePartnerRules();

  const [form, setForm] = useState<RulesForm>(EMPTY);
  const [saved, setSaved] = useState<RulesForm>(EMPTY);

  // Seed the form + snapshot once, on the first rules load. Gated by a ref so a
  // later background refetch can't overwrite edits the user is making.
  const initialised = useRef(false);
  useEffect(() => {
    if (rules && !initialised.current) {
      initialised.current = true;
      const next: RulesForm = {
        bookingSlotMinutes: String(rules.booking_slot_minutes),
        minBookingMinutes: String(rules.min_booking_minutes),
        maxBookingMinutes: String(rules.max_booking_minutes),
        cancellationWindowMinutes: String(rules.cancellation_window_minutes),
      };
      setForm(next);
      setSaved(next);
    }
  }, [rules]);

  const setField = (key: keyof RulesForm, value: string): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isDirty = useMemo(
    () =>
      form.bookingSlotMinutes !== saved.bookingSlotMinutes ||
      form.minBookingMinutes !== saved.minBookingMinutes ||
      form.maxBookingMinutes !== saved.maxBookingMinutes ||
      form.cancellationWindowMinutes !== saved.cancellationWindowMinutes,
    [form, saved],
  );

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const slot = Number(form.bookingSlotMinutes);
    const min = Number(form.minBookingMinutes);
    const max = Number(form.maxBookingMinutes);
    const cancel = Number(form.cancellationWindowMinutes);

    if ([slot, min, max, cancel].some((n) => Number.isNaN(n))) {
      toast.error("Xəta", "Bütün dəyərlər rəqəm olmalıdır.");
      return;
    }
    if (min > max) {
      toast.error("Xəta", "Minimum müddət maksimumdan böyük ola bilməz.");
      return;
    }

    try {
      await updateMut.mutateAsync({
        booking_slot_minutes: slot,
        min_booking_minutes: min,
        max_booking_minutes: max,
        cancellation_window_minutes: cancel,
      });
      setSaved(form);
      toast.success("Qaydalar yeniləndi", "Rezervasiya qaydaları yadda saxlanıldı.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat baş tutmadı", message || "Yadda saxlamaq mümkün olmadı.");
    }
  };

  return (
    <SectionCard
      step={step}
      icon={CalendarCog}
      title="Rezervasiya qaydaları"
      description="Slot addımı, minimum/maksimum müddət və ləğv pəncərəsi rezervasiya davranışını idarə edir."
    >
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surfaceElevated/60" />
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/15">
            <AlertCircle className="h-6 w-6 text-danger" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              Qaydalar yüklənmədi
            </h3>
            <p className="mx-auto max-w-sm text-sm text-foregroundMuted">
              Rezervasiya qaydalarını almaq mümkün olmadı. Yenidən cəhd edin.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RotateCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Yenidən cəhd et
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-slot">Slot addımı (dəqiqə)</Label>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                <Input
                  id="rule-slot"
                  type="number"
                  min={15}
                  max={240}
                  step={5}
                  value={form.bookingSlotMinutes}
                  onChange={(e) => setField("bookingSlotMinutes", e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-cancel">Ləğv pəncərəsi (dəqiqə)</Label>
              <Input
                id="rule-cancel"
                type="number"
                min={0}
                max={10080}
                step={15}
                value={form.cancellationWindowMinutes}
                onChange={(e) =>
                  setField("cancellationWindowMinutes", e.target.value)
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-min">Minimum müddət (dəqiqə)</Label>
              <Input
                id="rule-min"
                type="number"
                min={15}
                max={480}
                step={15}
                value={form.minBookingMinutes}
                onChange={(e) => setField("minBookingMinutes", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-max">Maksimum müddət (dəqiqə)</Label>
              <Input
                id="rule-max"
                type="number"
                min={15}
                max={480}
                step={15}
                value={form.maxBookingMinutes}
                onChange={(e) => setField("maxBookingMinutes", e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button
              type="submit"
              disabled={!isDirty || updateMut.isPending}
              className="gap-2"
            >
              {updateMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Qaydaları Saxla
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}
