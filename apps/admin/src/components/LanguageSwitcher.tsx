"use client";

import {
  ADMIN_LANGUAGES,
  adminLanguageLabel,
  adminLanguageName,
  useI18n,
  type AdminLanguage,
} from "@/lib/i18n";
import { cn } from "@/lib/cn";

export function LanguageSwitcher({
  compact = false,
}: {
  compact?: boolean;
}): React.JSX.Element {
  const { language, setLanguage } = useI18n();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surfaceElevated p-1",
        compact ? "gap-0.5" : "gap-1",
      )}
      aria-label="Language"
    >
      {ADMIN_LANGUAGES.map((item: AdminLanguage) => (
        <button
          key={item}
          type="button"
          title={adminLanguageName(item)}
          onClick={() => setLanguage(item)}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold transition",
            language === item
              ? "bg-accent text-black"
              : "text-foregroundMuted hover:text-foreground",
          )}
        >
          {adminLanguageLabel(item)}
        </button>
      ))}
    </div>
  );
}
