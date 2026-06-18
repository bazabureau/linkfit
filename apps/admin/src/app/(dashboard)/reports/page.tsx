import { ReportsQueue } from "./ReportsQueue";

export const metadata = {
  title: "Reports — LinkFit Admin",
};

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      {/* Header — plain text nodes are translated by the i18n DOM observer */}
      <div>
        <p className="text-xs font-semibold   text-accent">Reports</p>
        <h1 className="mt-2 font-display text-[1.6rem] font-bold  text-foreground">
          Şikayət moderasiyası
        </h1>
        <p className="mt-1 text-sm text-foregroundMuted">
          İstifadəçi şikayətlərini triaj et. Baxılmış və rədd edilmiş şikayətlər axtarışda qalır.
        </p>
      </div>
      <ReportsQueue />
    </div>
  );
}
