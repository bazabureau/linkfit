"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { APIError } from "@/lib/api";
import { useCreateUser, type CreateUserPayload } from "@/lib/admin-queries";

// New strings are Azerbaijani source text (the i18n layer maps AZ → RU/EN).
const ROLE_OPTIONS = [
  { value: "none", label: "İstifadəçi" },
  { value: "admin", label: "Admin" },
  { value: "moderator", label: "Moderator" },
] as const;

const schema = z.object({
  email: z.string().email("Düzgün e-poçt daxil edin"),
  display_name: z.string().trim().min(1, "Ad tələb olunur").max(120),
  password: z.string().min(12, "Şifrə ən azı 12 simvol olmalıdır"),
  role: z.enum(["none", "admin", "moderator"]),
  email_verified: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

/** Sentence-case field label — intentionally no  / tracking (brand rule). */
function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
}): React.JSX.Element {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-sm font-semibold text-foreground">{children}</span>
      {hint ? <span className="text-xs font-normal text-foregroundMuted">{hint}</span> : null}
    </label>
  );
}

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const createUser = useCreateUser();
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      display_name: "",
      password: "",
      role: "none",
      email_verified: false,
    },
  });

  // Reset the form each time the dialog opens.
  React.useEffect(() => {
    if (open) {
      reset({
        email: "",
        display_name: "",
        password: "",
        role: "none",
        email_verified: false,
      });
      setShowPassword(false);
    }
  }, [open, reset]);

  const emailVerified = watch("email_verified");

  const submit = handleSubmit((values) => {
    const payload: CreateUserPayload = {
      email: values.email.trim(),
      display_name: values.display_name.trim(),
      password: values.password,
      admin_role: values.role === "none" ? null : values.role,
      email_verified: values.email_verified,
    };
    createUser.mutate(payload, {
      onSuccess: (user) => {
        toast.success(t("İstifadəçi yaradıldı"), user.email);
        onOpenChange(false);
      },
      onError: (err) => {
        const conflict =
          err instanceof APIError &&
          (err.status === 409 ||
            err.code === "email_conflict" ||
            err.code === "email_taken");
        if (conflict) {
          toast.error(
            t("Bu e-poçt artıq istifadə olunur"),
            t("Başqa e-poçt ünvanı seçin."),
          );
        } else {
          const message =
            err instanceof APIError ? err.message : t("Yenidən cəhd edin");
          toast.error(t("İstifadəçi yaradılmadı"), message);
        }
      },
    });
  });

  const busy = createUser.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-[#3f6b00]">
            <UserPlus className="h-5 w-5" />
          </div>
          <DialogTitle>{t("Yeni istifadəçi")}</DialogTitle>
          <DialogDescription>
            {t("Yeni hesab yaradın. İstifadəçi e-poçt və şifrə ilə daxil ola biləcək.")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="create-user-email">{t("E-poçt")}</FieldLabel>
            <Input
              id="create-user-email"
              type="email"
              autoComplete="off"
              placeholder="ad@linkfit.az"
              {...register("email")}
            />
            {errors.email ? (
              <p className="mt-1 text-xs text-danger">{t(errors.email.message ?? "")}</p>
            ) : null}
          </div>

          <div>
            <FieldLabel htmlFor="create-user-name">{t("Ad")}</FieldLabel>
            <Input
              id="create-user-name"
              autoComplete="off"
              placeholder={t("Ad Soyad")}
              {...register("display_name")}
            />
            {errors.display_name ? (
              <p className="mt-1 text-xs text-danger">
                {t(errors.display_name.message ?? "")}
              </p>
            ) : null}
          </div>

          <div>
            <FieldLabel
              htmlFor="create-user-password"
              hint={t("Ən azı 12 simvol")}
            >
              {t("Şifrə")}
            </FieldLabel>
            <div className="relative">
              <Input
                id="create-user-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••••••"
                className="pr-10"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
                aria-label={showPassword ? t("Şifrəni gizlət") : t("Şifrəni göstər")}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password ? (
              <p className="mt-1 text-xs text-danger">
                {t(errors.password.message ?? "")}
              </p>
            ) : null}
          </div>

          <div>
            <FieldLabel htmlFor="create-user-role" hint={t("İstəyə bağlı")}>
              {t("Rol")}
            </FieldLabel>
            <select
              id="create-user-role"
              {...register("role")}
              className="h-10 w-full rounded-lg border border-border bg-surfaceElevated px-3 text-sm text-foreground outline-none transition focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setValue("email_verified", !emailVerified)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surfaceElevated px-3.5 py-3 text-left transition hover:border-borderStrong"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {t("E-poçt təsdiqlənib")}
              </span>
              <span className="block text-xs text-foregroundMuted">
                {t("Aktiv olsa, istifadəçidən e-poçt təsdiqi istənməyəcək.")}
              </span>
            </span>
            <span
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                emailVerified ? "bg-accent" : "bg-border"
              }`}
              aria-hidden
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  emailVerified ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("Ləğv et")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {busy ? t("Yaradılır...") : t("İstifadəçi yarat")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
