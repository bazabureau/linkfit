"use client";

import * as React from "react";
import Image from "next/image";
import { ImagePlus, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { MAX_VENUE_IMAGE_BYTES, uploadVenueImage } from "@/lib/admin-venues";

const ACCEPT = "image/jpeg,image/jpg,image/png,image/webp,image/gif";

export interface VenuePhotoUploaderProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

/**
 * Drag-and-drop image uploader. Streams the picked file through the shared
 * `/api/v1/messages/upload-image` endpoint and returns the persisted URL.
 *
 * Notes:
 *  - We don't write any state to disk; the parent owns the URL value.
 *  - Max client-side size: 4 MB. The backend has its own 8 MiB ceiling but we
 *    enforce 4 MB here per product spec.
 *  - Preview uses `next/image` with `unoptimized` so any host (including the
 *    same-origin /uploads/* path) renders without remote-pattern config.
 */
export function VenuePhotoUploader({
  value,
  onChange,
  disabled = false,
}: VenuePhotoUploaderProps): React.JSX.Element {
  const toast = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  const handleFile = React.useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Invalid file", "Pick a JPG, PNG, WEBP, or GIF image.");
        return;
      }
      if (file.size > MAX_VENUE_IMAGE_BYTES) {
        toast.error("Image too large", "Maximum size is 4 MB.");
        return;
      }
      setUploading(true);
      try {
        const url = await uploadVenueImage(file);
        onChange(url);
        toast.success("Image uploaded", file.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not upload image";
        toast.error("Upload failed", message);
      } finally {
        setUploading(false);
      }
    },
    [onChange, toast],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Allow re-selecting the same file later.
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const openPicker = (): void => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onInputChange}
        disabled={disabled || uploading}
      />

      {value ? (
        <div className="flex items-start gap-4">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-border bg-surfaceElevated">
            <Image
              src={value}
              alt="Venue photo preview"
              fill
              sizes="112px"
              unoptimized
              className="object-cover"
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-foregroundMuted break-all line-clamp-2">{value}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={openPicker}
                disabled={disabled || uploading}
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Replace
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => onChange(null)}
                disabled={disabled || uploading}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled && !uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surfaceElevated/40 p-6 text-center transition-colors",
            "hover:border-accent/60 hover:bg-surfaceElevated",
            dragOver && "border-accent/80 bg-accent/5",
            (disabled || uploading) && "pointer-events-none opacity-60",
          )}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          ) : dragOver ? (
            <UploadCloud className="h-6 w-6 text-accent" />
          ) : (
            <ImagePlus className="h-6 w-6 text-foregroundMuted group-hover:text-accent" />
          )}
          <div>
            <p className="text-sm font-medium text-foreground">
              {uploading ? "Uploading…" : "Drop an image, or click to choose"}
            </p>
            <p className="text-xs text-foregroundMuted">
              JPG, PNG, WEBP or GIF — up to 4 MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
