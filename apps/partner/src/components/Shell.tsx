"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarCheck2,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Trophy,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { getCurrentUser, logout, type AdminUser } from "@/lib/auth";

const OWNER_BASE_PATH = process.env.NEXT_PUBLIC_OWNER_BASE_PATH || "/owner";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "İdarəetmə",
    items: [
      { href: "/", label: "Ümumi Baxış", icon: LayoutDashboard },
      { href: "/bookings", label: "Rezervasiyalar və Təqvim", icon: CalendarCheck2 },
      { href: "/courts", label: "Kortlarım", icon: Building2 },
    ],
  },
  {
    title: "Fəaliyyət",
    items: [
      { href: "/revenue", label: "Gəlir Hesabatı", icon: Wallet },
      { href: "/tournaments", label: "Turnirlər", icon: Trophy },
      { href: "/waitlist", label: "Gözləmə Siyahısı", icon: Hourglass },
      { href: "/reviews", label: "Rəylər", icon: MessageSquare },
    ],
  },
  {
    title: "Konfiqurasiya",
    items: [{ href: "/settings", label: "Məkan Ayarları", icon: Settings }],
  },
];

function isItemActive(href: string, pathname: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

function initialsFor(name: string | undefined): string {
  if (!name) return "LF";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "LF";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { data: user } = useQuery<AdminUser>({
    queryKey: ["me"],
    queryFn: getCurrentUser,
  });

  // Close the mobile drawer whenever navigation changes.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar pathname={pathname} user={user} />

      {/* Mobile drawer + overlay */}
      {mobileOpen ? (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Menyunu bağla"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <Sidebar
            pathname={pathname}
            user={user}
            className="relative z-10 flex w-72 max-w-[82%] shadow-lift"
            onClose={() => setMobileOpen(false)}
          />
        </div>
      ) : null}

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  pathname,
  user,
  className,
  onClose,
}: {
  pathname: string;
  user: AdminUser | undefined;
  className?: string;
  onClose?: () => void;
}): React.JSX.Element {
  return (
    <aside
      className={cn(
        "w-72 shrink-0 flex-col border-r border-border bg-surface",
        onClose ? "flex" : "hidden md:flex",
        className,
      )}
    >
      {/* Brand header */}
      <div className="h-16 px-5 flex items-center justify-between gap-2 border-b border-border">
        <Link
          href="/"
          className="flex items-center gap-2.5 min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          aria-label="Linkfit Tərəfdaş Portalı"
        >
          <Image
            src={`${OWNER_BASE_PATH}/brand/logolinkfit.png`}
            alt="Linkfit"
            width={150}
            height={24}
            priority
            unoptimized
            className="h-6 w-auto object-contain"
          />
        </Link>
        {onClose ? (
          <button
            type="button"
            aria-label="Menyunu bağla"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-foregroundMuted transition-colors hover:bg-surfaceElevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 space-y-5 overflow-y-auto px-3 py-5"
        aria-label="Əsas naviqasiya"
      >
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 font-display text-[10px] font-semibold text-muted">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = isItemActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                      isActive
                        ? "bg-accent text-accent-ink shadow-[0_4px_12px_rgba(197,242,53,0.18)]"
                        : "text-foregroundMuted hover:bg-surfaceElevated hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0",
                        isActive
                          ? "text-accent-ink"
                          : "text-muted group-hover:text-foreground",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Venue / user identity */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl bg-surfaceElevated px-3 py-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent font-display text-xs font-bold text-accent-ink">
            {initialsFor(user?.display_name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {user?.display_name ?? "Yüklənir…"}
            </p>
            <p className="truncate text-[11px] text-foregroundMuted">
              {user?.admin_role
                ? String(user.admin_role).toUpperCase()
                : "Tərəfdaş hesabı"}
            </p>
          </div>
        </div>
        <p className="px-1 pt-3 text-[11px] text-muted">Linkfit Owner • v0.1.0</p>
      </div>
    </aside>
  );
}

function TopBar({
  user,
  onMenu,
}: {
  user: AdminUser | undefined;
  onMenu: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const onLogout = async (): Promise<void> => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };
  return (
    <header className="h-16 border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between gap-3 px-4 md:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          aria-label="Menyunu aç"
          onClick={onMenu}
          className="md:hidden grid h-9 w-9 place-items-center rounded-lg text-foregroundMuted transition-colors hover:bg-surfaceElevated hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-foreground truncate">
            Tərəfdaş Portalı
          </p>
          <p className="text-[11px] text-foregroundMuted truncate">
            {user ? `Giriş edilib: ${user.display_name}` : "Yüklənir…"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {user?.admin_role ? (
          <span className="hidden sm:inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent  ">
            {user.admin_role}
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={onLogout}
          disabled={busy}
          aria-label="Hesabdan çıxış"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Çıxış</span>
        </Button>
      </div>
    </header>
  );
}
