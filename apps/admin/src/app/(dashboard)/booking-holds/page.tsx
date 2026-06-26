"use client";

import * as React from "react";
import { Hourglass, Rocket } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { HoldsPanel } from "./HoldsPanel";
import { LaunchWaitlistPanel } from "./LaunchWaitlistPanel";

type Tab = "holds" | "launch";

const TABS: Array<{ key: Tab; label: string; icon: typeof Hourglass }> = [
  { key: "holds", label: "Booking holds", icon: Hourglass },
  { key: "launch", label: "Launch waitlist", icon: Rocket },
];

export default function BookingHoldsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<Tab>("holds");

  const heading =
    tab === "holds" ? t("Booking holds") : t("Launch waitlist");
  const subtitle =
    tab === "holds"
      ? t("Temporary slot reservations held during checkout before payment.")
      : t("Early-access web signups from the “coming soon” page.");
  const HeadingIcon = tab === "holds" ? Hourglass : Rocket;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("Operations")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <HeadingIcon className="h-6 w-6 text-accent" />
            {heading}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">{subtitle}</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((item) => {
          const active = tab === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
                active
                  ? "border-ink bg-ink text-white shadow-sm"
                  : "border-border bg-surface text-foregroundMuted hover:border-borderStrong hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(item.label)}
            </button>
          );
        })}
      </div>

      {tab === "holds" ? <HoldsPanel /> : <LaunchWaitlistPanel />}
    </div>
  );
}
