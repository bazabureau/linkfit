"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CalendarCheck2,
  ClipboardList,
  Gamepad2,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { getCurrentUser, logout, type AdminUser } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/venues", label: "Venues", icon: Building2 },
  { href: "/tournaments", label: "Tournaments", icon: Trophy },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck2 },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/audit", label: "Audit", icon: ClipboardList },
];

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const { data: user } = useQuery<AdminUser>({
    queryKey: ["me"],
    queryFn: getCurrentUser,
  });

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-background">
      <Sidebar pathname={pathname ?? "/"} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} />
        <MobileNav pathname={pathname ?? "/"} />
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ pathname }: { pathname: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="h-16 px-5 flex items-center gap-2 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-accent/15 grid place-items-center">
          <ShieldCheck className="h-4 w-4 text-accent" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight">Linkfit</span>
            <span className="text-[11px] uppercase tracking-wider text-foregroundMuted leading-tight">
            {t("Admin")}
          </span>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 text-[11px] text-foregroundMuted border-t border-border">
        v0.1.0
      </div>
    </aside>
  );
}

function TopBar({ user }: { user: AdminUser | undefined }): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const { t } = useI18n();
  const onLogout = async (): Promise<void> => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };
  return (
    <header className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-surface/90 px-3 py-2 backdrop-blur sm:min-h-16 sm:px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2 md:hidden">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15">
            <ShieldCheck className="h-4 w-4 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-foreground">Linkfit</div>
            <div className="text-[10px] uppercase tracking-wider text-foregroundMuted">
              {t("Admin")}
            </div>
          </div>
        </div>
        <div className="hidden truncate text-sm text-foregroundMuted md:block">
          {user ? `${t("Signed in as")} ${user.display_name}` : t("Loading…")}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <LanguageSwitcher compact />
        {user?.admin_role ? (
          <span className="hidden items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-accent sm:inline-flex">
            {user.admin_role}
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={onLogout}
          disabled={busy}
          className="px-2.5 sm:px-3"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">{t("Sign out")}</span>
        </Button>
      </div>
    </header>
  );
}

function MobileNav({ pathname }: { pathname: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <nav className="sticky top-14 z-30 border-b border-border bg-background/95 px-2 py-2 backdrop-blur md:hidden">
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
                isActive
                  ? "border-accent bg-accent text-black"
                  : "border-border bg-surface text-foregroundMuted",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.label)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
