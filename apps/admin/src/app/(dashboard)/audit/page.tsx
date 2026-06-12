import { Activity } from "lucide-react";
import { AuditTable } from "./AuditTable";

export const metadata = {
  title: "Audit log — LinkFit Admin",
};

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Audit log
          </h1>
        </div>
        <p className="mt-1 text-sm text-foregroundMuted">
          Read-only chronological history of administrative actions across the
          platform.
        </p>
      </header>
      <AuditTable />
    </div>
  );
}
