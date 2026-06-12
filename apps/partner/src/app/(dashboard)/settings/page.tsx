"use client";

import { useEffect, useState } from "react";
import {
  Building,
  Save,
  Image as ImageIcon,
  Loader2,
  Phone,
  MapPin,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  usePartnerVenue,
  useUpdatePartnerVenue,
} from "@/lib/partner-queries";
import { uploadVenueImage } from "@/lib/admin-venues";

export default function SettingsPage(): React.JSX.Element {
  const toast = useToast();

  const { data: venue, isLoading: isQueryLoading } = usePartnerVenue();
  const updateMut = useUpdatePartnerVenue();

  // Form Fields State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const [uploading, setUploading] = useState(false);

  // Sync form state when query resolves
  useEffect(() => {
    if (venue) {
      setName(venue.name);
      setDescription(venue.description ?? "");
      setAddress(venue.address);
      setPhone(venue.phone ?? "");
      setPhotoUrl(venue.photo_url ?? "");
    }
  }, [venue]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadVenueImage(file);
      setPhotoUrl(url);
      toast.success("Şəkil yükləndi", "Məkan şəkli uğurla yaddaşa yazıldı.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Yükləmə xətası", message || "Şəkli yükləmək mümkün olmadı.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) {
      toast.error("Xəta", "Məkan adı və ünvanı məcburidir.");
      return;
    }

    try {
      await updateMut.mutateAsync({
        name,
        description: description || null,
        address,
        phone: phone || null,
        photo_url: photoUrl || null,
      });
      toast.success("Profil yeniləndi", "Məkan məlumatları uğurla yadda saxlanıldı.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat uğursuz oldu", message || "Yadda saxlamaq mümkün olmadı.");
    }
  };

  if (isQueryLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Məkan Ayarları
        </h1>
        <p className="text-sm text-foregroundMuted">
          İdman məkanınızın profil şəkillərini, əlaqə nömrələrini, ünvanını və təsvirini idarə edin.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="grid gap-6 md:grid-cols-3">
          {/* Main Card (Settings Form) */}
          <Card className="md:col-span-2 border border-border bg-surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-4 w-4 text-accent" />
                Məkan Profili
              </CardTitle>
              <CardDescription>
                Bu məlumatlar Linkfit mobil tətbiqində oyunçulara görünəcəkdir.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="venue-name">Məkanın Adı</Label>
                <div className="relative">
                  <Building className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                  <Input
                    id="venue-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Məs. Linkfit Yasamal Arena"
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="venue-phone">Əlaqə Telefonu</Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                  <Input
                    id="venue-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Məs. +994 50 123 45 67"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="venue-address">Ünvan</Label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                  <Input
                    id="venue-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Məs. Bakı şəhəri, Yasamal rayonu, Salatın Əsgərova küç. 45"
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="venue-desc">Məkan Təsviri</Label>
                <div className="relative">
                  <FileText className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-foregroundMuted" />
                  <Textarea
                    id="venue-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Məkan haqqında geniş məlumat, duş, soyunub-geyinmə otağı, parkinq və digər şəraitlər haqqında qeydlər..."
                    className="min-h-[140px] pl-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sidebar Picture Upload Card */}
          <Card className="border border-border bg-surface flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-accent" />
                Məkan Şəkli
              </CardTitle>
              <CardDescription>
                Məkanın əsas örtük şəkli (maks. 4MB).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
              <div className="space-y-4 flex-1">
                {photoUrl ? (
                  <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-border bg-background">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl}
                      alt="Məkan şəkli"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="aspect-video w-full rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-foregroundMuted bg-surfaceElevated/30">
                    <ImageIcon className="h-8 w-8 text-foregroundMuted" />
                    <span className="text-xs">Şəkil seçilməyib</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="venue-photo-url">Şəkil URL-i</Label>
                  <Input
                    id="venue-photo-url"
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder="Şəklin internet ünvanını daxil edin"
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border mt-4">
                <input
                  type="file"
                  id="image-file-input"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full gap-2"
                  disabled={uploading}
                  onClick={() => document.getElementById("image-file-input")?.click()}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Yüklənir...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="h-4 w-4" />
                      Kompüterdən Şəkil Seç
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Actions bar */}
        <div className="flex justify-end gap-2">
          <Button
            type="submit"
            disabled={updateMut.isPending}
            className="gap-2"
          >
            {updateMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Məlumatları Yadda Saxla
          </Button>
        </div>
      </form>
    </div>
  );
}
