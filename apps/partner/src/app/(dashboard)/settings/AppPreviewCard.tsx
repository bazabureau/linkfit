"use client";

import { ImageIcon, MapPin, Star } from "lucide-react";

interface AppPreviewCardProps {
  name: string;
  address: string;
  photoUrl: string;
}

/**
 * Approximate render of how the venue appears as a card inside the Linkfit
 * mobile app. Purely presentational — updates live as the partner edits.
 */
export function AppPreviewCard({
  name,
  address,
  photoUrl,
}: AppPreviewCardProps): React.JSX.Element {
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="relative aspect-video w-full bg-surfaceElevated">
          {photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-foregroundMuted">
              <ImageIcon className="h-7 w-7" />
            </div>
          )}
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur-sm">
            <Star className="h-3 w-3 fill-accent text-accent" />
            Yeni
          </div>
        </div>
        <div className="space-y-1 p-3">
          <p className="truncate text-sm font-semibold text-foreground">
            {name.trim() || "Məkan adı"}
          </p>
          <p className="flex items-center gap-1 truncate text-[11px] text-foregroundMuted">
            <MapPin className="h-3 w-3 shrink-0" />
            {address.trim() || "Ünvan göstərilməyib"}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-foregroundMuted">
        Bu, məkanınızın mobil tətbiqdəki təxmini kart görünüşüdür.
      </p>
    </div>
  );
}
