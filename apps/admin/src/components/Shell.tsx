"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CalendarCheck2,
  ClipboardList,
  Gamepad2,
  GraduationCap,
  LayoutDashboard,
  LogOut,
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
  { href: "/coaches", label: "Coaches", icon: GraduationCap },
  { href: "/tournaments", label: "Tournaments", icon: Trophy },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck2 },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/audit", label: "Audit", icon: ClipboardList },
];
const ADMIN_BASE_PATH = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "/admin";

function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function initialsOf(name: string | undefined): string {
  if (!name) return "LF";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const { data: user } = useQuery<AdminUser>({
    queryKey: ["me"],
    queryFn: getCurrentUser,
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar pathname={pathname ?? "/"} user={user} />
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <TopBar pathname={pathname ?? "/"} />
        <MobileNav pathname={pathname ?? "/"} />
        <main className="min-w-0 flex-1 px-3 py-5 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ pathname, user }: { pathname: string; user: AdminUser | undefined }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <aside
      aria-label={t("Primary")}
      className="hidden w-[244px] shrink-0 bg-ink text-white md:block"
    >
      <div className="sticky top-0 flex h-screen flex-col">
      {/* atmospheric top glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
        style={{ background: "radial-gradient(120% 80% at 18% 0%, rgba(183,242,51,0.10), transparent 70%)" }}
      />

      <div className="relative flex h-16 items-center px-5">
        <Image
          src={`${ADMIN_BASE_PATH}/brand/logolinkfit.png`}
          alt="LinkFit"
          width={150}
          height={22}
          priority
          unoptimized
          className="h-[22px] w-auto object-contain"
        />
      </div>

      <nav className="relative flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        <p className="px-3 pb-1.5 pt-2 font-display text-[10px] font-semibold   text-white/30">
          {t("Menu")}
        </p>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all",
                active
                  ? "bg-accent text-ink shadow-[0_8px_24px_-8px_rgba(183,242,51,0.6)]"
                  : "text-white/55 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors", active ? "text-ink" : "text-white/45 group-hover:text-accent")} />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>

      {/* user identity card */}
      <div className="relative border-t border-inkBorder px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-2.5 py-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent font-display text-[11px] font-bold text-ink">
            {initialsOf(user?.display_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold leading-tight text-white/90">
              {user?.display_name ?? t("Loading…")}
            </p>
            <p className="truncate text-[10.5px]   text-white/40">
              {user?.admin_role ?? "admin"}
            </p>
          </div>
        </div>
      </div>
      </div>
    </aside>
  );
}

function TopBar({ pathname }: { pathname: string }): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const { t } = useI18n();
  const current = NAV.find((n) => isActivePath(pathname, n.href));
  const onLogout = async (): Promise<void> => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };
  return (
    <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-3 py-2 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* mobile brand mark */}
        <Image
          src={`${ADMIN_BASE_PATH}/brand/appicon.svg`}
          alt=""
          width={30}
          height={30}
          priority
          unoptimized
          className="h-7 w-7 shrink-0 rounded-lg md:hidden"
        />
        <h1 className="truncate font-display text-[17px] font-semibold  text-foreground sm:text-[19px]">
          {t(current?.label ?? "Overview")}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <LanguageSwitcher compact />
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
    <nav
      aria-label={t("Primary")}
      className="sticky top-16 z-30 border-b border-border bg-background/95 px-2 py-2 backdrop-blur md:hidden"
    >
      <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                active
                  ? "border-ink bg-ink text-white"
                  : "border-border bg-surface text-foregroundMuted",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-accent" : "")} />
              {t(item.label)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
