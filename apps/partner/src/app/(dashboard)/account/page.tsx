"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  User as UserIcon,
  KeyRound,
  Mail,
  Save,
  Loader2,
  BadgeCheck,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  usePartnerAccount,
  useUpdatePartnerAccount,
} from "@/lib/partner-queries";

export default function AccountPage(): React.JSX.Element {
  const toast = useToast();
  const { data: account, isLoading, isError, refetch, isFetching } =
    usePartnerAccount();
  const updateMut = useUpdatePartnerAccount();

  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (account) setDisplayName(account.display_name);
  }, [account]);

  const nameDirty = account ? displayName.trim() !== account.display_name : false;

  const handleSaveProfile = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!displayName.trim()) {
      toast.error("Xəta", "Ad boş ola bilməz.");
      return;
    }
    try {
      await updateMut.mutateAsync({ display_name: displayName.trim() });
      toast.success("Profil yeniləndi", "Adınız uğurla dəyişdirildi.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat baş tutmadı", message || "Yadda saxlamaq mümkün olmadı.");
    }
  };

  const handleChangePassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error("Xəta", "Hər iki şifrə sahəsini doldurun.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Xəta", "Yeni şifrə ən azı 8 simvol olmalıdır.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Xəta", "Yeni şifrə təsdiqi uyğun gəlmir.");
      return;
    }
    setChangingPassword(true);
    try {
      // Call the endpoint directly with skipRefresh so a 401 ("Current password
      // is invalid") surfaces as an error toast instead of triggering the shared
      // client's refresh+logout flow, which would otherwise sign the partner out
      // on a simple wrong-password attempt.
      await api.patch(
        "/api/v1/partner/account",
        { current_password: currentPassword, password: newPassword },
        { skipRefresh: true },
      );
      toast.success("Şifrə dəyişdirildi", "Şifrəniz uğurla yeniləndi.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Əməliyyat baş tutmadı", message || "Şifrəni dəyişmək mümkün olmadı.");
    } finally {
      setChangingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="h-8 w-52 animate-pulse rounded-lg bg-surfaceElevated" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface" />
        <div className="h-72 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  if (isError || !account) {
    return (
      <div className="max-w-2xl">
        <Card className="flex flex-col items-center justify-center gap-4 py-20 text-center shadow-card">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/15">
            <AlertCircle className="h-7 w-7 text-danger" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-base font-bold text-foreground">
              Hesab məlumatı yüklənmədi
            </h3>
            <p className="max-w-sm text-sm text-foregroundMuted">
              Hesab məlumatınızı almaq mümkün olmadı. Yenidən cəhd edin.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RotateCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Yenidən cəhd et
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-7">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="flex items-center gap-2.5 font-display text-[1.6rem] font-bold text-foreground">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent">
            <ShieldCheck className="h-5 w-5" />
          </span>
          Hesab Təhlükəsizliyi
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-foregroundMuted">
          Hesab adınızı və giriş şifrənizi buradan idarə edin.
        </p>
      </header>

      {/* Account identity card */}
      {account ? (
        <Card className="flex items-center gap-4 p-5 shadow-card">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent font-display text-base font-bold text-accent-ink">
            {account.display_name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold text-foreground">
              {account.display_name}
            </p>
            <p className="flex items-center gap-1.5 truncate text-sm text-foregroundMuted">
              <Mail className="h-3.5 w-3.5" />
              {account.email}
            </p>
          </div>
          {account.is_owner ? (
            <Badge variant="success" className="gap-1">
              <BadgeCheck className="h-3.5 w-3.5" />
              Sahib
            </Badge>
          ) : (
            <Badge variant="info">{account.staff_title ?? "İşçi"}</Badge>
          )}
        </Card>
      ) : null}

      {/* Profile (display name) */}
      <Card className="space-y-5 p-6 shadow-card">
        <div className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Profil Məlumatı</h2>
        </div>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Ad Soyad</Label>
            <Input
              id="acc-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Adınız"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-email">E-poçt</Label>
            <Input
              id="acc-email"
              value={account?.email ?? ""}
              disabled
              readOnly
            />
            <p className="text-[10px] italic text-foregroundMuted/80">
              E-poçt ünvanını dəyişmək üçün administrator ilə əlaqə saxlayın.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!nameDirty || updateMut.isPending}
              className="gap-2"
            >
              {updateMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Yadda Saxla
            </Button>
          </div>
        </form>
      </Card>

      {/* Password change */}
      <Card className="space-y-5 p-6 shadow-card">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Şifrə Dəyişikliyi</h2>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc-current">Mövcud şifrə</Label>
            <Input
              id="acc-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="acc-new">Yeni şifrə</Label>
              <Input
                id="acc-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Ən azı 8 simvol"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-confirm">Yeni şifrə (təkrar)</Label>
              <Input
                id="acc-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Ən azı 8 simvol"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={changingPassword}
              className="gap-2"
            >
              {changingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Şifrəni Dəyiş
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
