"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAdmin } from "@/lib/auth";
import { APIError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type LoginValues = z.infer<typeof LoginSchema>;
const ADMIN_BASE_PATH = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "/admin";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const { t } = useI18n();
  const [redirectTo, setRedirectTo] = React.useState("/");
  // Only accept a same-origin relative path for `from` (block //evil.com,
  // https://evil.com, etc.) — otherwise login becomes an open redirect.
  React.useEffect(() => { if (typeof window === "undefined") return; const p = new URLSearchParams(window.location.search); const r = p.get("from"); if (r && r.startsWith("/") && !r.startsWith("//")) setRedirectTo(r); }, []);
  

  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await loginAdmin(values.email, values.password);
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      if (err instanceof APIError) {
        if (err.code === "forbidden_not_admin" || err.status === 403) {
          setServerError(t("This account does not have admin access."));
        } else if (err.status === 401) {
          setServerError(t("Incorrect email or password."));
        } else {
          setServerError(err.message || t("Sign in failed."));
        }
      } else {
        setServerError(t("Sign in failed. Try again."));
      }
    }
  });

  return (
    <main className="min-h-screen bg-[#f4f7f8] text-[#111827]">
      <div className="grid min-h-screen lg:grid-cols-[1.04fr_0.96fr]">
        <section className="relative hidden overflow-hidden lg:block">
          <Image
            src={`${ADMIN_BASE_PATH}/brand/site/padel-player.jpg`}
            alt=""
            fill
            priority
            unoptimized
            sizes="52vw"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,10,18,0.82),rgba(4,10,18,0.38)_58%,rgba(4,10,18,0.08))]" />
          <div className="relative flex h-full flex-col justify-end p-12">
            <div className="max-w-xl pb-8 text-white">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm backdrop-blur">
                <ShieldCheck className="h-4 w-4 text-[#b7f233]" />
                {t("Admin panel")}
              </div>
              <h1 className="text-5xl font-semibold leading-[1.02] ">
                Platforma nəzarəti bir yerdə.
              </h1>
              <p className="mt-5 max-w-md text-base leading-7 text-white/78">
                İstifadəçilər, məkanlar, courtlar, oyunlar və rezervasiyalar üçün Linkfit idarəetməsi.
              </p>
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[460px]">
            <div className="mb-10 flex items-center justify-between gap-4">
              <Image
                src={`${ADMIN_BASE_PATH}/brand/logolinkfit-dark.png`}
                alt="Linkfit"
                width={230}
                height={32}
                priority
                unoptimized
                className="h-8 w-auto object-contain"
              />
              <LanguageSwitcher />
            </div>

            <div className="mb-8">
              <p className="mb-3 text-sm font-semibold  text-[#6b7280]">
                {t("Admin panel")}
              </p>
              <h2 className="text-4xl font-semibold leading-tight  text-[#0f172a]">
                {t("Sign in")}
              </h2>
              <p className="mt-3 text-base leading-7 text-[#5f6b7a]">
                {t("Use your Linkfit admin account to continue.")}
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[#273241]">
                  {t("Email")}
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b8794]" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="admin@linkfit.az"
                    aria-invalid={Boolean(errors.email)}
                    className="h-12 rounded-xl border-[#d7dee4] bg-white pl-11 text-[#111827] placeholder:text-[#8a94a3] focus-visible:border-[#b7f233] focus-visible:ring-[#b7f233]/45"
                    {...register("email")}
                  />
                </div>
                {errors.email ? (
                  <p className="text-sm font-medium text-[#dc2626]">{t(errors.email.message ?? "")}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[#273241]">
                  {t("Password")}
                </Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b8794]" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-invalid={Boolean(errors.password)}
                    className="h-12 rounded-xl border-[#d7dee4] bg-white pl-11 text-[#111827] placeholder:text-[#8a94a3] focus-visible:border-[#b7f233] focus-visible:ring-[#b7f233]/45"
                    {...register("password")}
                  />
                </div>
                {errors.password ? (
                  <p className="text-sm font-medium text-[#dc2626]">{t(errors.password.message ?? "")}</p>
                ) : null}
              </div>

              {serverError ? (
                <div className="rounded-xl border border-[#fecaca] bg-[#fff1f2] px-4 py-3 text-sm font-medium text-[#b91c1c]">
                  {serverError}
                </div>
              ) : null}

              <Button
                type="submit"
                className="h-12 w-full rounded-xl bg-[#b7f233] text-[#101820] hover:bg-[#a5df22]"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("Signing in…")}
                  </>
                ) : (
                  <>
                    {t("Sign in")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-6 text-sm leading-6 text-[#6b7280]">
              {t("Need access? Ask an existing admin to provision your account.")}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
