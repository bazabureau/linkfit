"use client";

import { useEffect, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VenuePhotoUploader } from "@/components/venues/VenuePhotoUploader";
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

export function VenueForm({
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: VenueFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
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
    <form onSubmit={submit} className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="venue-name"
        >
          Name
        </label>
        <Input id="venue-name" {...register("name")} placeholder="Venue name" />
        {fe.name && <p className="mt-1 text-xs text-danger">{fe.name.message}</p>}
      </div>

      <div>
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="venue-address"
        >
          Address
        </label>
        <Input
          id="venue-address"
          {...register("address")}
          placeholder="Street, city"
        />
        {fe.address && (
          <p className="mt-1 text-xs text-danger">{fe.address.message}</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-foreground">Photo</p>
        <VenuePhotoUploader
          value={photoUrl}
          onChange={setPhotoUrl}
          disabled={submitting}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Location</p>
          {previewCoords && (
            <a
              href={buildOsmUrl(lat, lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <MapPin className="h-3 w-3" />
              Pick on map
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className="mb-1 block text-xs font-medium text-foregroundMuted"
              htmlFor="venue-lat"
            >
              Latitude
            </label>
            <Input
              id="venue-lat"
              type="number"
              step="any"
              {...register("lat", { valueAsNumber: true })}
              placeholder="40.4093"
            />
            {fe.lat && <p className="mt-1 text-xs text-danger">{fe.lat.message}</p>}
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium text-foregroundMuted"
              htmlFor="venue-lng"
            >
              Longitude
            </label>
            <Input
              id="venue-lng"
              type="number"
              step="any"
              {...register("lng", { valueAsNumber: true })}
              placeholder="49.8671"
            />
            {fe.lng && <p className="mt-1 text-xs text-danger">{fe.lng.message}</p>}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-foregroundMuted">
          Tip: open the map link, drag the marker, copy the new lat/lng from
          the address bar back into the fields.
        </p>
      </div>

      <div>
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="venue-phone"
        >
          Phone (optional)
        </label>
        <Input id="venue-phone" {...register("phone")} placeholder="+994 ..." />
        {fe.phone && (
          <p className="mt-1 text-xs text-danger">{fe.phone.message}</p>
        )}
      </div>

      <div>
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="venue-description"
        >
          Description (optional)
        </label>
        <textarea
          id="venue-description"
          {...register("description")}
          rows={3}
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground placeholder:text-foregroundMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:border-accent/60"
          placeholder="Short description shown on detail pages"
        />
        {fe.description && (
          <p className="mt-1 text-xs text-danger">{fe.description.message}</p>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          {...register("is_partner")}
          className="h-4 w-4 rounded border-border bg-surfaceElevated text-accent focus:ring-accent"
        />
        Partner venue
      </label>

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
          {submitting ? "Saving..." : initial ? "Save changes" : "Create venue"}
        </Button>
      </div>
    </form>
  );
}
