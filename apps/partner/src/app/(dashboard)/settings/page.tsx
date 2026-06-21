"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building,
  Save,
  Image as ImageIcon,
  Loader2,
  Phone,
  MapPin,
  FileText,
  Wallet,
  Trophy,
  MessageSquare as MessageSquareIcon,
  Hourglass,
  Settings as SettingsIcon,
  Smartphone,
  Check,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { usePartnerVenue, partnerKeys } from "@/lib/partner-queries";
import { uploadVenueImage } from "@/lib/admin-venues";
import { api } from "@/lib/api";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";
import { PhotoUploader } from "./PhotoUploader";
import { AppPreviewCard } from "./AppPreviewCard";
import { RulesCard } from "./RulesCard";

const QUICK_LINKS: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { href: "/courts", label: "Kortlarım", icon: Building },
  { href: "/revenue", label: "Gəlir hesabatı", icon: Wallet },
  { href: "/tournaments", label: "Turnirlər", icon: Trophy },
  { href: "/reviews", label: "Rəylər", icon: MessageSquareIcon },
  { href: "/waitlist", label: "Gözləmə siyahısı", icon: Hourglass },
];

const DESC_MAX = 1000;

interface FormState {
  name: string;
  description: string;
  address: string;
  phone: string;
  photoUrl: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  address: "",
  phone: "",
  photoUrl: "",
};

export default function SettingsPage(): React.JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: venue, isLoading: isQueryLoading } = usePartnerVenue();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Snapshot of the last saved/loaded values — used to detect unsaved changes.
  const [saved, setSaved] = useState<FormState>(EMPTY_FORM);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Sync form + snapshot when the query resolves.
  useEffect(() => {
    if (venue) {
      const next: FormState = {
        name: venue.name,
        description: venue.description ?? "",
        address: venue.address,
        phone: venue.phone ?? "",
        photoUrl: venue.photo_url ?? "",
      };
      setForm(next);
      setSaved(next);
    }
  }, [venue]);

  const isDirty = useMemo(
    () =>
      form.name !== saved.name ||
      form.description !== saved.description ||
      form.address !== saved.address ||
      form.phone !== saved.phone ||
      form.photoUrl !== saved.photoUrl,
    [form, saved],
  );

  const handleReset = (): void => {
    setForm(saved);
  };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim()) {
      toast.error("Xəta", "Məkan adı və ünvanı məcburidir.");
      return;
    }

    setSaving(true);
    try {
      // The partner venue endpoint accepts `photo_urls` (array), not a single
      // `photo_url`. Send the array so the cover image is actually persisted.
      await api.put("/api/v1/partner/venue", {
        name: form.name,
        description: form.description || null,
        address: form.address,
        phone: form.phone || null,
        photo_urls: form.photoUrl ? [form.photoUrl] : [],
      });
      await qc.invalidateQueries({ queryKey: partnerKeys.venue });
      setSaved(form);
      toast.success("Profil yeniləndi", "Məkan məlumatları uğurla yadda saxlanıldı.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Yadda saxlamaq mümkün olmadı.");
    } finally {
      setSaving(false);
    }
  };

  if (isQueryLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <div className="h-8 w-44 animate-pulse rounded-lg bg-surfaceElevated" />
        <div className="h-10 w-72 animate-pulse rounded-lg bg-surfaceElevated" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-[30rem] animate-pulse rounded-2xl bg-surface lg:col-span-2" />
          <div className="h-[30rem] animate-pulse rounded-2xl bg-surface" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-7 pb-28">
      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Button
              key={link.href}
              asChild
              variant="secondary"
              size="sm"
              className="gap-1.5"
            >
              <Link href={link.href}>
                <Icon className="h-3.5 w-3.5" />
                {link.label}
              </Link>
            </Button>
          );
        })}
      </div>

      {/* Header */}
      <header className="space-y-2">
        <h1 className="flex items-center gap-2.5 font-display text-[1.7rem] font-bold leading-tight text-foreground">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent">
            <SettingsIcon className="h-5 w-5" />
          </span>
          Məkan ayarları
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-foregroundMuted">
          Burada məkanınızın adını, əlaqə məlumatlarını, ünvanını və örtük şəklini
          idarə edirsiniz. Bu məlumatlar Linkfit mobil tətbiqində oyunçulara
          göstərilir — diqqətli və aydın doldurun.
        </p>
      </header>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column — the editable form */}
          <div className="space-y-6 lg:col-span-2">
            <SectionCard
              step={1}
              icon={Building}
              title="Məkan profili"
              description="Oyunçuların məkanı tanıması üçün əsas məlumatlar."
            >
              <div className="space-y-5">
                <Field
                  id="venue-name"
                  label="Məkanın adı"
                  required
                  hint="Tətbiqdə başlıq kimi göstərilir. Qısa və tanınan bir ad seçin."
                >
                  <div className="relative">
                    <Building className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                    <Input
                      id="venue-name"
                      value={form.name}
                      onChange={(e) => setField("name", e.target.value)}
                      placeholder="Məs. Linkfit Yasamal Arena"
                      className="pl-9"
                      required
                    />
                  </div>
                </Field>

                <Field
                  id="venue-desc"
                  label="Məkan təsviri"
                  hint="Duş, soyunub-geyinmə otağı, parkinq və digər şəraitlər haqqında qeyd edin."
                  meta={
                    <span
                      className={
                        "font-display text-[11px] tabular-nums " +
                        (form.description.length > DESC_MAX - 50
                          ? "text-warning"
                          : "text-foregroundMuted")
                      }
                    >
                      {form.description.length} / {DESC_MAX}
                    </span>
                  }
                >
                  <div className="relative">
                    <FileText className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-foregroundMuted" />
                    <Textarea
                      id="venue-desc"
                      value={form.description}
                      onChange={(e) => setField("description", e.target.value)}
                      placeholder="Məkan haqqında geniş məlumat, mövcud şəraitlər və oyunçular üçün faydalı qeydlər..."
                      className="min-h-[150px] pl-9"
                      maxLength={DESC_MAX}
                    />
                  </div>
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              step={2}
              icon={MapPin}
              title="Əlaqə və ünvan"
              description="Oyunçular sizinlə əlaqə saxlaya və məkanı tapa bilsin."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="venue-phone"
                  label="Əlaqə telefonu"
                  hint="Oyunçular sorğular üçün bu nömrəyə zəng edə bilər."
                  className="sm:col-span-2"
                >
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                    <Input
                      id="venue-phone"
                      type="tel"
                      inputMode="tel"
                      value={form.phone}
                      onChange={(e) => setField("phone", e.target.value)}
                      placeholder="Məs. +994 50 123 45 67"
                      className="pl-9"
                    />
                  </div>
                </Field>

                <Field
                  id="venue-address"
                  label="Ünvan"
                  required
                  hint="Şəhər, rayon və küçə daxil olmaqla tam ünvanı yazın."
                  className="sm:col-span-2"
                >
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                    <Input
                      id="venue-address"
                      value={form.address}
                      onChange={(e) => setField("address", e.target.value)}
                      placeholder="Məs. Bakı, Yasamal r., Salatın Əsgərova küç. 45"
                      className="pl-9"
                      required
                    />
                  </div>
                </Field>
              </div>
            </SectionCard>
          </div>

          {/* Right column — photo + live preview */}
          <div className="space-y-6">
            <SectionCard
              step={3}
              icon={ImageIcon}
              title="Örtük şəkli"
              description="Tətbiqdə kart kimi göstərilən əsas şəkil."
            >
              <PhotoUploader
                value={form.photoUrl}
                onChange={(url) => setField("photoUrl", url)}
                onUpload={uploadVenueImage}
                uploading={uploading}
                setUploading={setUploading}
                onError={(message) => toast.error("Yükləmə xətası", message)}
                onSuccess={() =>
                  toast.success("Şəkil yükləndi", "Yadda saxlayanda tətbiqdə görünəcək.")
                }
              />
            </SectionCard>

            <SectionCard
              step={4}
              icon={Smartphone}
              title="Tətbiqdə görünüş"
              description="Dəyişikliklər anında burada əks olunur."
            >
              <AppPreviewCard
                name={form.name}
                address={form.address}
                photoUrl={form.photoUrl}
              />
            </SectionCard>
          </div>
        </div>

        {/* Sticky save bar */}
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lift backdrop-blur-md sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isDirty ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                <span className="truncate">Yadda saxlanılmamış dəyişikliklər var</span>
              </span>
            ) : (
              <span className="hidden items-center gap-1.5 text-xs text-foregroundMuted sm:flex">
                <Check className="h-3.5 w-3.5 text-accent" />
                Bütün dəyişikliklər yadda saxlanılıb
              </span>
            )}
          </div>

          {isDirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={handleReset}
              disabled={saving || uploading}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Ləğv et</span>
            </Button>
          ) : null}

          <Button
            type="submit"
            disabled={saving || uploading || !isDirty}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saxlanılır..." : "Yadda saxla"}
          </Button>
        </div>
      </form>

      {/* Booking rules — separate form (its own save), kept outside the venue form. */}
      <RulesCard step={5} />
    </div>
  );
}
