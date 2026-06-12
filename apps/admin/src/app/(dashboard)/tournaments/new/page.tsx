"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TournamentWizard } from "../TournamentWizard";

export default function NewTournamentPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/tournaments">
            <ArrowLeft className="h-3.5 w-3.5" />
            All tournaments
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">New tournament</h1>
        <p className="text-sm text-foregroundMuted">
          Walk through each step to get your tournament live.
        </p>
      </div>
      <TournamentWizard />
    </div>
  );
}
