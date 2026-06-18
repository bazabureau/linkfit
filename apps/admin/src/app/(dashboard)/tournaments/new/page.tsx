"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { TournamentWizard } from "../TournamentWizard";

export default function NewTournamentPage(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href="/tournaments">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("Bütün turnirlər")}
        </Link>
      </Button>
      <div>
        <p className="text-xs font-semibold   text-accent">
          {t("Tournaments")}
        </p>
        <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
          {t("Yeni turnir")}
        </h1>
        <p className="mt-1 text-sm text-foregroundMuted">
          {t("Turniri canlı etmək üçün hər addımı keç.")}
        </p>
      </div>
      <TournamentWizard />
    </div>
  );
}
