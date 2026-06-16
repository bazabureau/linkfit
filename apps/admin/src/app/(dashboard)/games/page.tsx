import { GamesTable } from "./GamesTable";

export const metadata = {
  title: "Oyunlar · Linkfit Admin",
};

export default function GamesPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Oyunlar
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">
            Padel və tenis oyunlarını yoxlayın, ləğv edin və idarə edin.
          </p>
        </div>
      </header>

      <GamesTable />
    </div>
  );
}
