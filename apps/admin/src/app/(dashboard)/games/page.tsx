import { GamesTable } from "./GamesTable";

export const metadata = {
  title: "Games · Linkfit Admin",
};

export default function GamesPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Games
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            Review, moderate, and triage scheduled games across all sports.
          </p>
        </div>
      </header>

      <GamesTable />
    </div>
  );
}
