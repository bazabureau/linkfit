"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarCheck2,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { getCurrentUser, logout, type AdminUser } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/", label: "Ümumi Baxış", icon: LayoutDashboard },
  { href: "/bookings", label: "Rezervasiyalar və Təqvim Planı", icon: CalendarCheck2 },
  { href: "/courts", label: "Kortlarım", icon: Building2 },
  { href: "/settings", label: "Məkan Ayarları", icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const { data: user } = useQuery<AdminUser>({
    queryKey: ["me"],
    queryFn: getCurrentUser,
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar pathname={pathname ?? "/"} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} />
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ pathname }: { pathname: string }): React.JSX.Element {
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="h-16 px-5 flex items-center gap-2 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-accent/15 grid place-items-center">
          <ShieldCheck className="h-4 w-4 text-accent" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight">Linkfit</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-foregroundMuted leading-tight">
            Tərəfdaş Portalı
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
              <span>{item.label}</span>
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
  const onLogout = async (): Promise<void> => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };
  return (
    <header className="h-16 border-b border-border bg-surface/80 backdrop-blur sticky top-0 z-30 flex items-center justify-between px-6">
      <div className="text-sm text-foregroundMuted">
        {user ? `Giriş edilib: ${user.display_name}` : "Yüklənir…"}
      </div>
      <div className="flex items-center gap-3">
        {user?.admin_role ? (
          <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent uppercase tracking-wider">
            {user.admin_role}
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={onLogout}
          disabled={busy}
        >
          <LogOut className="h-4 w-4" />
          Çıxış
        </Button>
      </div>
    </header>
  );
}
