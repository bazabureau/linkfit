"use client";

import * as React from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ImageIcon,
  ImagePlus,
  Images,
  Loader2,
  RotateCcw,
  Save,
  Star,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  MAX_VENUE_IMAGE_BYTES,
  uploadVenueImage,
  type Venue,
} from "@/lib/admin-venues";
import { VenuePhotoUploader } from "@/components/venues/VenuePhotoUploader";
import { SectionCard } from "./detail-ui";

// New user-facing strings are Azerbaijani source text, matching the rest of the
// venue detail panels (CourtsPanel / PartnersPanel / VenueRulesPanel) which use
// hardcoded AZ rather than the t() helper.

export interface VenueMediaDraft {
  logo_url: string | null;
  photo_url: string | null;
  photo_urls: string[];
}

const ACCEPT = "image/jpeg,image/jpg,image/png,image/webp,image/gif";

function describeError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: string }).message;
    if (message) return message;
  }
  return fallback;
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function VenueMediaPanel({
  venue,
  busy,
  onSave,
}: {
  venue: Venue;
  busy: boolean;
  onSave: (data: VenueMediaDraft) => Promise<void>;
}): React.JSX.Element {
  const toast = useToast();

  const initialLogo = venue.logo_url ?? null;
  const initialCover = venue.photo_url ?? null;
  const initialGallery = React.useMemo(
    () => venue.photo_urls ?? [],
    [venue.photo_urls],
  );

  const [logo, setLogo] = React.useState<string | null>(initialLogo);
  const [cover, setCover] = React.useState<string | null>(initialCover);
  const [gallery, setGallery] = React.useState<string[]>(initialGallery);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Re-sync local draft when the venue prop changes (e.g. after a save the
  // parent re-renders with a freshly fetched, server-normalized venue). Mirrors
  // VenueRulesPanel so the panel never drifts from the persisted state.
  React.useEffect(() => {
    setLogo(venue.logo_url ?? null);
    setCover(venue.photo_url ?? null);
    setGallery(venue.photo_urls ?? []);
  }, [venue]);

  const dirty =
    logo !== initialLogo ||
    cover !== initialCover ||
    !sameList(gallery, initialGallery);

  const locked = busy || uploading;

  const addFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const images = list.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) {
        toast.error("Yararsız fayl", "JPG, PNG, WEBP və ya GIF seçin.");
        return;
      }
      setUploading(true);
      const added: string[] = [];
      for (const file of images) {
        if (file.size > MAX_VENUE_IMAGE_BYTES) {
          toast.error("Şəkil çox böyükdür", `${file.name} — maksimum 4 MB`);
          continue;
        }
        try {
          const url = await uploadVenueImage(file);
          added.push(url);
        } catch (err) {
          toast.error("Yükləmə alınmadı", describeError(err, file.name));
        }
      }
      if (added.length > 0) {
        setGallery((prev) => {
          const next = [...prev];
          for (const url of added) {
            if (!next.includes(url)) next.push(url);
          }
          return next;
        });
        toast.success(
          "Qalereya yeniləndi",
          `${added.length} şəkil əlavə edildi`,
        );
      }
      setUploading(false);
    },
    [toast],
  );

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files;
    if (files && files.length > 0) void addFiles(files);
    event.target.value = "";
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    if (locked) return;
    const files = event.dataTransfer.files;
    if (files && files.length > 0) void addFiles(files);
  }

  function removeAt(index: number): void {
    setGallery((prev) => prev.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number): void {
    setGallery((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      if (item === undefined) return prev;
      next.splice(target, 0, item);
      return next;
    });
  }

  function makeCover(url: string): void {
    setCover(url);
    toast.success("Əsas şəkil təyin edildi");
  }

  function reset(): void {
    setLogo(initialLogo);
    setCover(initialCover);
    setGallery(initialGallery);
  }

  async function save(): Promise<void> {
    try {
      await onSave({ logo_url: logo, photo_url: cover, photo_urls: gallery });
    } catch {
      // Parent surfaces the error toast; keep the local draft intact so the
      // admin doesn't lose their edits on a transient failure.
    }
  }

  return (
    <div className="space-y-4">
      {/* Unsaved-changes banner */}
      {dirty ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-foreground">
            Yadda saxlanmamış dəyişikliklər var.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={reset}
              disabled={locked}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Sıfırla
            </Button>
            <Button size="sm" onClick={save} disabled={locked}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Yadda saxla
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Logo */}
        <SectionCard
          title="Loqo"
          description="Məkanın loqosu — listinqlərdə və profil başlığında göstərilir."
          bodyClassName="p-5"
        >
          <VenuePhotoUploader value={logo} onChange={setLogo} disabled={locked} />
        </SectionCard>

        {/* Cover / hero photo */}
        <SectionCard
          title="Əsas şəkil"
          description="Məkan kartının və detal səhifəsinin hero şəkli."
          bodyClassName="p-5"
        >
          <VenuePhotoUploader value={cover} onChange={setCover} disabled={locked} />
        </SectionCard>
      </div>

      {/* Gallery */}
      <SectionCard
        title="Qalereya"
        description="Bir neçə şəkil yüklə, sırala və ya əsas şəkil təyin et."
        bodyClassName="space-y-4 p-5"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surfaceElevated px-2.5 py-1 text-xs font-medium text-foregroundMuted ring-1 ring-inset ring-border">
            <Images className="h-3.5 w-3.5" />
            {gallery.length} şəkil
          </span>
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={onInputChange}
          disabled={locked}
        />

        {/* Drop / pick area */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => !locked && inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (!locked) inputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!locked) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surfaceElevated/40 p-6 text-center transition-colors",
            "hover:border-accent/60 hover:bg-surfaceElevated",
            dragOver && "border-accent/80 bg-accent/5",
            locked && "pointer-events-none opacity-60",
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
              {uploading
                ? "Yüklənir…"
                : "Şəkilləri buraxın və ya seçmək üçün klikləyin"}
            </p>
            <p className="text-xs text-foregroundMuted">
              JPG, PNG, WEBP və ya GIF — hər biri 4 MB-a qədər, bir neçə fayl
            </p>
          </div>
        </div>

        {/* Grid */}
        {gallery.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surfaceElevated/30 px-6 py-10 text-center">
            <ImageIcon className="h-7 w-7 text-foregroundMuted" />
            <p className="text-sm text-foregroundMuted">
              Hələ qalereya şəkli yoxdur.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {gallery.map((url, index) => {
              const isCover = url === cover;
              return (
                <li
                  key={`${url}-${index}`}
                  className="group relative overflow-hidden rounded-xl border border-border bg-surfaceElevated"
                >
                  <div className="relative aspect-square w-full">
                    <Image
                      src={url}
                      alt={`${venue.name} şəkil ${index + 1}`}
                      fill
                      sizes="200px"
                      unoptimized
                      className="object-cover"
                    />
                  </div>

                  {/* Index + cover badge */}
                  <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1">
                    <span className="grid h-5 min-w-5 place-items-center rounded-md bg-black/60 px-1 text-[10px] font-bold text-white">
                      {index + 1}
                    </span>
                    {isCover ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold text-[#101820]">
                        <Star className="h-2.5 w-2.5" />
                        Əsas
                      </span>
                    ) : null}
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    title="Sil"
                    aria-label="Şəkli sil"
                    onClick={() => removeAt(index)}
                    disabled={locked}
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-black/55 text-white opacity-0 transition hover:bg-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  {/* Action bar */}
                  <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 rounded-lg bg-black/55 px-1 py-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <span className="flex items-center gap-1">
                      <TileAction
                        title="Sola"
                        onClick={() => move(index, -1)}
                        disabled={locked || index === 0}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </TileAction>
                      <TileAction
                        title="Sağa"
                        onClick={() => move(index, 1)}
                        disabled={locked || index === gallery.length - 1}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </TileAction>
                    </span>
                    <TileAction
                      title="Əsas şəkil et"
                      onClick={() => makeCover(url)}
                      disabled={locked || isCover}
                      active={isCover}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </TileAction>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Save bar */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={reset} disabled={locked || !dirty}>
          <RotateCcw className="h-4 w-4" />
          Sıfırla
        </Button>
        <Button onClick={save} disabled={locked || !dirty}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Şəkilləri yadda saxla
        </Button>
      </div>
    </div>
  );
}

function TileAction({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40",
        active && "text-accent",
      )}
    >
      {children}
    </button>
  );
}
