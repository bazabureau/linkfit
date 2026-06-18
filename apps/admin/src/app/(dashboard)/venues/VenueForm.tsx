"use client";

import { useEffect, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExternalLink, Handshake, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VenuePhotoUploader } from "@/components/venues/VenuePhotoUploader";
import { useI18n } from "@/lib/i18n";
import type { Venue, VenuePayload } from "@/lib/admin-venues";

// Baku centre by default — matches our seed data so first-time admins land
// somewhere sensible on the map.
const DEFAULT_LAT = 40.4093;
const DEFAULT_LNG = 49.8671;

const venueSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(120),
  address: z.string().min(3, "Address is required").max(255),
  lat: z
    .number({ invalid_type_error: "Latitude must be a number" })
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90"),
  lng: z
    .number({ invalid_type_error: "Longitude must be a number" })
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180"),
  phone: z
    .string()
    .max(40)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  description: z
    .string()
    .max(2000)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  is_partner: z.boolean(),
});

export type VenueFormValues = z.infer<typeof venueSchema>;

export interface VenueFormProps {
  initial?: Venue | null;
  submitting?: boolean;
  onSubmit: (values: VenuePayload) => void | Promise<void>;
  onCancel: () => void;
}

function buildOsmUrl(lat: number, lng: number): string {
  // OpenStreetMap "share" page with marker + 17-zoom layer. Admins can drag
  // the marker, copy the new coords from the URL bar, and paste them back.
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

function FieldLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="mb-1.5 block text-xs font-semibold   text-foregroundMuted">
      {children}
    </span>
  );
}

export function VenueForm({
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: VenueFormProps): React.JSX.Element {
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<VenueFormValues>({
    resolver: zodResolver(venueSchema),
    defaultValues: {
      name: initial?.name ?? "",
      address: initial?.address ?? "",
      lat: initial?.lat ?? DEFAULT_LAT,
      lng: initial?.lng ?? DEFAULT_LNG,
      phone: initial?.phone ?? "",
      description: initial?.description ?? "",
      is_partner: initial?.is_partner ?? false,
    },
  });

  // Photo URL is stored outside react-hook-form so the uploader can mutate
  // it imperatively (uploads are async + multipart, not a typical form input).
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial?.photo_url ?? null);

  useEffect(() => {
    reset({
      name: initial?.name ?? "",
      address: initial?.address ?? "",
      lat: initial?.lat ?? DEFAULT_LAT,
      lng: initial?.lng ?? DEFAULT_LNG,
      phone: initial?.phone ?? "",
      description: initial?.description ?? "",
      is_partner: initial?.is_partner ?? false,
    });
    setPhotoUrl(initial?.photo_url ?? null);
  }, [initial, reset]);

  const lat = watch("lat");
  const lng = watch("lng");
  const isPartner = watch("is_partner");
  const previewCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const submit = handleSubmit((values) => {
    const payload: VenuePayload = {
      name: values.name.trim(),
      address: values.address.trim(),
      lat: values.lat,
      lng: values.lng,
      phone: values.phone?.trim() || null,
      description: values.description?.trim() || null,
      photo_url: photoUrl,
      is_partner: values.is_partner,
    };
    return onSubmit(payload);
  });

  const fe = errors as FieldErrors<VenueFormValues>;

  return (
    <form onSubmit={submit} className="max-h-[72vh] space-y-5 overflow-y-auto pr-1">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>{t("Name")}</FieldLabel>
          <Input {...register("name")} placeholder={t("Venue name")} />
          {fe.name ? <p className="mt-1 text-xs text-danger">{fe.name.message}</p> : null}
        </div>
        <div>
          <FieldLabel>{t("Phone (optional)")}</FieldLabel>
          <Input {...register("phone")} placeholder="+994 ..." />
          {fe.phone ? <p className="mt-1 text-xs text-danger">{fe.phone.message}</p> : null}
        </div>
      </div>

      <div>
        <FieldLabel>{t("Address")}</FieldLabel>
        <Input {...register("address")} placeholder={t("Street, city")} />
        {fe.address ? <p className="mt-1 text-xs text-danger">{fe.address.message}</p> : null}
      </div>

      <div>
        <FieldLabel>{t("Photo")}</FieldLabel>
        <VenuePhotoUploader value={photoUrl} onChange={setPhotoUrl} disabled={submitting} />
      </div>

      {/* Location card */}
      <div className="rounded-2xl border border-border bg-surfaceElevated/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold   text-foregroundMuted">
            <MapPin className="h-3.5 w-3.5" />
            {t("Location")}
          </span>
          {previewCoords ? (
            <a
              href={buildOsmUrl(lat, lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              {t("Pick on map")}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>{t("Latitude")}</FieldLabel>
            <Input
              type="number"
              step="any"
              {...register("lat", { valueAsNumber: true })}
              placeholder="40.4093"
            />
            {fe.lat ? <p className="mt-1 text-xs text-danger">{fe.lat.message}</p> : null}
          </div>
          <div>
            <FieldLabel>{t("Longitude")}</FieldLabel>
            <Input
              type="number"
              step="any"
              {...register("lng", { valueAsNumber: true })}
              placeholder="49.8671"
            />
            {fe.lng ? <p className="mt-1 text-xs text-danger">{fe.lng.message}</p> : null}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-foregroundMuted">
          {t(
            "Tip: open the map link, drag the marker, copy the new lat/lng from the address bar back into the fields.",
          )}
        </p>
      </div>

      <div>
        <FieldLabel>{t("Description (optional)")}</FieldLabel>
        <textarea
          {...register("description")}
          rows={3}
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground placeholder:text-foregroundMuted focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          placeholder={t("Short description shown on detail pages")}
        />
        {fe.description ? (
          <p className="mt-1 text-xs text-danger">{fe.description.message}</p>
        ) : null}
      </div>

      {/* Partner toggle */}
      <button
        type="button"
        onClick={() => setValue("is_partner", !isPartner, { shouldDirty: true })}
        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
          isPartner
            ? "border-accent/40 bg-accent/10"
            : "border-border bg-surfaceElevated/50 hover:border-borderStrong"
        }`}
      >
        <span className="flex items-center gap-3">
          <span
            className={`grid h-9 w-9 place-items-center rounded-lg ${
              isPartner ? "bg-accent/20 text-[#3f6b00]" : "bg-surfaceElevated text-foregroundMuted"
            }`}
          >
            <Handshake className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">{t("Partner venue")}</span>
            <span className="block text-xs text-foregroundMuted">
              {t("Promoted across the app as an official partner.")}
            </span>
          </span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            isPartner ? "bg-accent" : "bg-borderStrong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
              isPartner ? "left-[22px]" : "left-0.5"
            }`}
          />
        </span>
        <input type="checkbox" {...register("is_partner")} className="sr-only" />
      </button>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {initial ? t("Save changes") : t("Create venue")}
        </Button>
      </div>
    </form>
  );
}
