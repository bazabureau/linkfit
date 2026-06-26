import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Səhifə tapılmadı · LinkFit",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/20">
        <Compass className="h-8 w-8" />
      </div>
      <div className="space-y-2">
        <p className="font-display text-sm font-semibold text-accent tabular-nums">
          404
        </p>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Səhifə tapılmadı
        </h1>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-foregroundMuted">
          Axtardığınız səhifə mövcud deyil və ya köçürülüb. Ümumi baxış panelinə
          qayıda bilərsiniz.
        </p>
      </div>
      <Button asChild className="gap-2">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" />
          Ümumi Baxışa Qayıt
        </Link>
      </Button>
    </main>
  );
}
