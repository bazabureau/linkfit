"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
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
import type { PartnerAccount } from "@/lib/admin-venues";

// New strings are Azerbaijani source text. No  / tracking (brand rule).

const OWNER_PORTAL = "owner.linkfit.az";

const createSchema = z.object({
  email: z.string().email("Düzgün e-poçt daxil edin"),
  display_name: z.string().trim().min(1, "Ad tələb olunur").max(120),
  password: z.string().min(12, "Şifrə ən azı 12 simvol olmalıdır"),
  staff_title: z.string().trim().max(120).optional(),
});

const editSchema = z.object({
  email: z.string().email("Düzgün e-poçt daxil edin"),
  display_name: z.string().trim().min(1, "Ad tələb olunur").max(120),
  // On edit, leave blank to keep the current password.
  password: z.string().max(200).optional(),
  staff_title: z.string().trim().max(120).optional(),
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

export interface PartnerAccountSubmit {
  email: string;
  display_name: string;
  password?: string;
  staff_title?: string | null;
}

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

export function PartnerAccountDialog({
  open,
  initial,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** When provided the dialog runs in edit mode. */
  initial: PartnerAccount | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PartnerAccountSubmit) => void;
}): React.JSX.Element {
  const isEdit = initial !== null;
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateValues | EditValues>({
    resolver: zodResolver(isEdit ? editSchema : createSchema),
    defaultValues: {
      email: "",
      display_name: "",
      password: "",
      staff_title: "Məkan sahibi",
    },
  });

  React.useEffect(() => {
    if (!open) return;
    reset({
      email: initial?.email ?? "",
      display_name: initial?.display_name ?? "",
      password: "",
      staff_title: initial?.staff_title ?? "Məkan sahibi",
    });
    setShowPassword(false);
  }, [open, initial, reset]);

  const submit = handleSubmit((values) => {
    const password = values.password?.trim() || undefined;
    onSubmit({
      email: values.email.trim(),
      display_name: values.display_name.trim(),
      // In edit mode an empty password means "keep current".
      password,
      staff_title: values.staff_title?.trim() ? values.staff_title.trim() : null,
    });
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-[#3f6b00]">
            <KeyRound className="h-5 w-5" />
          </div>
          <DialogTitle>
            {isEdit ? "Tərəfdaş hesabını redaktə et" : "Tərəfdaş hesabı yarat"}
          </DialogTitle>
          <DialogDescription>
            Bu hesab owner portalına ({OWNER_PORTAL}) daxil olub bu məkanı idarə edə bilər.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="partner-email">E-poçt</FieldLabel>
            <Input
              id="partner-email"
              type="email"
              autoComplete="off"
              placeholder="sahib@linkfit.az"
              {...register("email")}
            />
            {errors.email ? (
              <p className="mt-1 text-xs text-danger">{errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <FieldLabel htmlFor="partner-name">Ad</FieldLabel>
            <Input
              id="partner-name"
              autoComplete="off"
              placeholder="Ad Soyad"
              {...register("display_name")}
            />
            {errors.display_name ? (
              <p className="mt-1 text-xs text-danger">{errors.display_name.message}</p>
            ) : null}
          </div>

          <div>
            <FieldLabel
              htmlFor="partner-password"
              hint={isEdit ? "Dəyişmək üçün doldurun" : "Ən azı 12 simvol"}
            >
              Şifrə
            </FieldLabel>
            <div className="relative">
              <Input
                id="partner-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={isEdit ? "••••••• (dəyişmə üçün boş saxla)" : "••••••••••••"}
                className="pr-10"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-foregroundMuted transition hover:bg-border/60 hover:text-foreground"
                aria-label={showPassword ? "Şifrəni gizlət" : "Şifrəni göstər"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password ? (
              <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
            ) : null}
          </div>

          <div>
            <FieldLabel htmlFor="partner-title" hint="İstəyə bağlı">
              Vəzifə
            </FieldLabel>
            <Input
              id="partner-title"
              placeholder="Məkan sahibi"
              {...register("staff_title")}
            />
            {errors.staff_title ? (
              <p className="mt-1 text-xs text-danger">{errors.staff_title.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Ləğv et
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting
                ? "Yadda saxlanır..."
                : isEdit
                  ? "Yadda saxla"
                  : "Hesab yarat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
