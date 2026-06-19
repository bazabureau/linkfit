"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Building2, Loader2, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAdmin } from "@/lib/auth";
import { APIError } from "@/lib/api";

const LoginSchema = z.object({
  email: z.string().email("Düzgün e-poçt ünvanı daxil edin"),
  password: z.string().min(1, "Şifrə məcburidir"),
});
type LoginValues = z.infer<typeof LoginSchema>;
const OWNER_BASE_PATH = process.env.NEXT_PUBLIC_OWNER_BASE_PATH || "/owner";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [redirectTo, setRedirectTo] = React.useState("/");
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const r = p.get("from");
    // Only a same-origin relative path — block //evil.com, https://… open redirects.
    if (r && r.startsWith("/") && !r.startsWith("//")) setRedirectTo(r);
  }, []);

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
        if (err.code === "forbidden_not_partner" || err.status === 403) {
          setServerError("Bu hesabın tərəfdaş portalına giriş icazəsi yoxdur.");
        } else if (err.status === 401) {
          setServerError("E-poçt ünvanı və ya şifrə yanlışdır.");
        } else {
          setServerError(err.message || "Sistemə giriş zamanı xəta baş verdi.");
        }
      } else {
        setServerError("Sistemə daxil olmaq mümkün olmadı. Yenidən cəhd edin.");
      }
    }
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        {/* Brand panel */}
        <section className="relative hidden overflow-hidden lg:block">
          <Image
            src={`${OWNER_BASE_PATH}/brand/site/padel-player.jpg`}
            alt=""
            fill
            priority
            unoptimized
            sizes="52vw"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(10,13,18,0.94),rgba(10,13,18,0.62)_55%,rgba(10,13,18,0.30))]" />
          {/* lime glow accent */}
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-accent/20 blur-[120px]" />
          <div className="relative flex h-full flex-col justify-end p-12">
            <div className="max-w-xl pb-8">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm font-medium text-accent backdrop-blur">
                <Building2 className="h-4 w-4" />
                Court owner panel
              </div>
              <h1 className="font-display text-5xl font-semibold leading-[1.05]  text-foreground">
                Meydanlar, rezervasiyalar və komanda bir yerdə.
              </h1>
              <p className="mt-5 max-w-md text-base leading-7 text-foregroundMuted">
                Linkfit owner paneli court əməliyyatlarını rahat idarə etmək üçün hazırlanıb.
              </p>
            </div>
          </div>
        </section>

        {/* Form panel */}
        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[440px]">
            <div className="mb-10 flex items-center justify-between">
              <Image
                src={`${OWNER_BASE_PATH}/brand/logolinkfit.png`}
                alt="Linkfit"
                width={210}
                height={30}
                priority
                unoptimized
                className="h-8 w-auto object-contain"
              />
              <div className="rounded-full border border-border bg-surfaceElevated px-3 py-1.5 font-display text-[11px] font-semibold text-foregroundMuted">
                Owner
              </div>
            </div>

            <div className="mb-8">
              <p className="mb-3 font-display text-xs font-semibold text-accent">
                Court idarəetməsi
              </p>
              <h2 className="font-display text-4xl font-semibold leading-tight  text-foreground">
                Hesabınıza daxil olun
              </h2>
              <p className="mt-3 text-base leading-7 text-foregroundMuted">
                Rezervasiyaları, court cədvəllərini və venue əməliyyatlarını idarə edin.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">E-poçt</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="owner@linkfit.az"
                    aria-invalid={Boolean(errors.email)}
                    className="h-12 rounded-xl pl-10"
                    {...register("email")}
                  />
                </div>
                {errors.email ? (
                  <p className="text-sm font-medium text-danger">{errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Şifrə</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foregroundMuted" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-invalid={Boolean(errors.password)}
                    className="h-12 rounded-xl pl-10"
                    {...register("password")}
                  />
                </div>
                {errors.password ? (
                  <p className="text-sm font-medium text-danger">{errors.password.message}</p>
                ) : null}
              </div>

              {serverError ? (
                <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
                  {serverError}
                </div>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                className="h-12 w-full rounded-xl text-base"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Daxil olunur...
                  </>
                ) : (
                  <>
                    Daxil ol
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-6 text-sm leading-6 text-foregroundMuted">
              Giriş icazəniz yoxdursa, venue administratoru və ya Linkfit komandası ilə əlaqə saxlayın.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
