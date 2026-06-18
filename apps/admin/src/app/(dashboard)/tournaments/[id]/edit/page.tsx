"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useTournament } from "@/lib/admin-tournaments";
import { TournamentWizard } from "../../TournamentWizard";

export default function EditTournamentPage(): React.JSX.Element {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, isLoading, isError } = useTournament(id);

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/tournaments/${id}`}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("Detala qayıt")}
        </Link>
      </Button>
      <div>
        <p className="text-xs font-semibold   text-accent">
          {t("Tournaments")}
        </p>
        <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
          {t("Turniri redaktə et")}
        </h1>
        <p className="mt-1 text-sm text-foregroundMuted">{t("İstənilən addımı yenilə və saxla.")}</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="h-14 animate-pulse rounded-2xl bg-surfaceElevated" />
          <div className="h-96 animate-pulse rounded-2xl bg-surfaceElevated" />
        </div>
      ) : null}
      {isError ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-16 text-center">
          <XCircle className="h-8 w-8 text-danger" />
          <p className="text-sm font-medium text-foreground">{t("Turnir yüklənmədi.")}</p>
        </div>
      ) : null}
      {data && <TournamentWizard initial={data} />}
    </div>
  );
}
