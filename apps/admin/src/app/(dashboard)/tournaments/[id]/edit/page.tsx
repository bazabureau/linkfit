"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTournament } from "@/lib/admin-tournaments";
import { TournamentWizard } from "../../TournamentWizard";

export default function EditTournamentPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, isLoading, isError } = useTournament(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/tournaments/${id}`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to detail
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Edit tournament</h1>
        <p className="text-sm text-foregroundMuted">
          Update any step and save.
        </p>
      </div>
      {isLoading && (
        <Card className="p-6 text-sm text-foregroundMuted">Loading tournament…</Card>
      )}
      {isError && (
        <Card className="p-6 text-sm text-danger">Could not load tournament.</Card>
      )}
      {data && <TournamentWizard initial={data} />}
    </div>
  );
}
