import { AlertTriangle } from "lucide-react";
import { ReportsQueue } from "./ReportsQueue";

export const metadata = {
  title: "Reports — LinkFit Admin",
};

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Reports
          </h1>
        </div>
        <p className="mt-1 text-sm text-foregroundMuted">
          Triage user-submitted reports. Reviewed and dismissed items remain
          searchable.
        </p>
      </header>
      <ReportsQueue />
    </div>
  );
}
