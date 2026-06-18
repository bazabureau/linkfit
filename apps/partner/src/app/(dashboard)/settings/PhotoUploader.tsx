"use client";

import { useId, useRef, useState } from "react";
import { ImageIcon, Loader2, Trash2, Upload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

interface PhotoUploaderProps {
  value: string;
  onChange: (url: string) => void;
  /** Performs the real upload and resolves with the persisted URL. */
  onUpload: (file: File) => Promise<string>;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  /** Surfaces upload errors as toasts in the parent. */
  onError: (message: string) => void;
  onSuccess: () => void;
}

/**
 * Comfortable cover-photo uploader: large drag-and-drop dropzone with live
 * preview, replace/remove controls, and a collapsible manual URL field. Wraps
 * the existing `uploadVenueImage` flow passed in via `onUpload`.
 */
export function PhotoUploader({
  value,
  onChange,
  onUpload,
  uploading,
  setUploading,
  onError,
  onSuccess,
}: PhotoUploaderProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const urlFieldId = useId();
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  const runUpload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("Yalnız şəkil faylları qəbul olunur.");
      return;
    }
    setUploading(true);
    try {
      const url = await onUpload(file);
      onChange(url);
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message || "Şəkli yükləmək mümkün olmadı.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const openPicker = (): void => inputRef.current?.click();

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading}
        onChange={(e) => void runUpload(e.target.files?.[0])}
      />

      {value ? (
        <div className="group relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Məkan örtük şəkli" className="h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={uploading}
              onClick={openPicker}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Dəyiş
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              className="gap-1.5"
              disabled={uploading}
              onClick={() => onChange("")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Sil
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void runUpload(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex aspect-video w-full flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed bg-surfaceElevated/30 px-4 text-center transition",
            "hover:border-accent/50 hover:bg-surfaceElevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            dragging ? "border-accent/70 bg-accent/5" : "border-border",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-accent" />
              <span className="text-sm text-foregroundMuted">Yüklənir...</span>
            </>
          ) : (
            <>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-accent/12 text-accent">
                <ImageIcon className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium text-foreground">
                Şəkli buraya sürüşdürün və ya seçmək üçün klikləyin
              </span>
              <span className="text-xs text-foregroundMuted">
                PNG və ya JPG · maksimum 4 MB
              </span>
            </>
          )}
        </button>
      )}

      {!value ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full gap-2"
          disabled={uploading}
          onClick={openPicker}
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Yüklənir...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Kompüterdən şəkil seç
            </>
          )}
        </Button>
      ) : null}

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowUrl((s) => !s)}
          className="text-xs font-medium text-foregroundMuted transition hover:text-accent"
        >
          {showUrl ? "URL sahəsini gizlət" : "Və ya şəkil URL-i daxil edin"}
        </button>
        {showUrl ? (
          <Input
            id={urlFieldId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://..."
            className="text-xs"
          />
        ) : null}
      </div>
    </div>
  );
}
