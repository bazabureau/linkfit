"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Court, CourtPayload } from "@/lib/admin-venues";

export interface SportOption {
  id: string;
  slug: string;
  name: string;
}

export interface CourtFormProps {
  initial?: Court | null;
  sports: SportOption[];
  submitting?: boolean;
  onSubmit: (payload: CourtPayload) => void | Promise<void>;
  onCancel: () => void;
}

const courtSchema = z.object({
  sport_id: z.string().uuid("Pick a sport"),
  name: z.string().min(1, "Court name is required").max(120),
  hourly_price_major: z
    .number({ invalid_type_error: "Price must be a number" })
    .min(0, "Price cannot be negative")
    .max(100_000),
  currency: z
    .string()
    .length(3, "Currency must be a 3-letter code")
    .transform((v) => v.toUpperCase()),
});

type CourtFormValues = z.infer<typeof courtSchema>;

export function CourtForm({
  initial,
  sports,
  submitting = false,
  onSubmit,
  onCancel,
}: CourtFormProps): React.JSX.Element {
  const defaultSportId = initial?.sport_id ?? sports[0]?.id ?? "";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CourtFormValues>({
    resolver: zodResolver(courtSchema),
    defaultValues: {
      sport_id: defaultSportId,
      name: initial?.name ?? "",
      hourly_price_major: initial ? initial.hourly_price_minor / 100 : 0,
      currency: initial?.currency ?? "AZN",
    },
  });

  useEffect(() => {
    reset({
      sport_id: initial?.sport_id ?? sports[0]?.id ?? "",
      name: initial?.name ?? "",
      hourly_price_major: initial ? initial.hourly_price_minor / 100 : 0,
      currency: initial?.currency ?? "AZN",
    });
  }, [initial, sports, reset]);

  const submit = handleSubmit((values) => {
    const payload: CourtPayload = {
      sport_id: values.sport_id,
      name: values.name.trim(),
      hourly_price_minor: Math.round(values.hourly_price_major * 100),
      currency: values.currency,
    };
    return onSubmit(payload);
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="court-sport"
        >
          Sport
        </label>
        <select
          id="court-sport"
          {...register("sport_id")}
          className="flex h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
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
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="court-name"
        >
          Court name
        </label>
        <Input id="court-name" {...register("name")} placeholder="Court 1" />
        {errors.name && (
          <p className="mt-1 text-xs text-danger">{errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label
            className="mb-1 block text-sm font-medium text-foreground"
            htmlFor="court-price"
          >
            Hourly price
          </label>
          <Input
            id="court-price"
            type="number"
            step="0.01"
            min="0"
            {...register("hourly_price_major", { valueAsNumber: true })}
            placeholder="50.00"
          />
          {errors.hourly_price_major && (
            <p className="mt-1 text-xs text-danger">
              {errors.hourly_price_major.message}
            </p>
          )}
        </div>
        <div>
          <label
            className="mb-1 block text-sm font-medium text-foreground"
            htmlFor="court-currency"
          >
            Currency
          </label>
          <Input
            id="court-currency"
            maxLength={3}
            {...register("currency")}
            placeholder="AZN"
          />
          {errors.currency && (
            <p className="mt-1 text-xs text-danger">{errors.currency.message}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : initial ? "Save changes" : "Add court"}
        </Button>
      </div>
    </form>
  );
}
