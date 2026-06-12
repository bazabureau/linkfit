"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { loginAdmin } from "@/lib/auth";
import { APIError } from "@/lib/api";

const LoginSchema = z.object({
  email: z.string().email("Düzgün e-poçt ünvanı daxil edin"),
  password: z.string().min(1, "Şifrə məcburidir"),
});
type LoginValues = z.infer<typeof LoginSchema>;

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [redirectTo, setRedirectTo] = React.useState("/");
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const r = p.get("from");
    if (r) setRedirectTo(r);
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
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-accent/15 grid place-items-center">
            <ShieldCheck className="h-5 w-5 text-accent" />
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight">Linkfit</div>
            <div className="text-xs uppercase tracking-[0.08em] font-bold text-foregroundMuted">
              Tərəfdaş Portalı
            </div>
          </div>
        </div>

        <Card className="p-2 md:p-4">
          <CardHeader>
            <CardTitle className="text-xl font-bold">Daxil ol</CardTitle>
            <CardDescription>
              Davam etmək üçün Linkfit tərəfdaş hesabınızla daxil olun.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-poçt</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="admin@linkfit.az"
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
                {errors.email ? (
                  <p className="text-xs text-danger">{errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Şifrə</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={Boolean(errors.password)}
                  {...register("password")}
                />
                {errors.password ? (
                  <p className="text-xs text-danger">{errors.password.message}</p>
                ) : null}
              </div>

              {serverError ? (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {serverError}
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Daxil olunur...
                  </>
                ) : (
                  "Daxil ol"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-foregroundMuted">
          Giriş icazəniz yoxdur? Hesabınızın aktivləşdirilməsi üçün sistem administratoruna müraciət edin.
        </p>
      </div>
    </div>
  );
}
