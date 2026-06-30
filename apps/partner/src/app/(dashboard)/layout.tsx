import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookies";
import { API_BASE_URL, apiHeaders } from "@/lib/api";

// Roles permitted to load the owner dashboard shell. The `lf_access` cookie is
// a shared platform cookie (Domain=".linkfit.az"), so its mere presence only
// proves the visitor is logged in *somewhere* on Linkfit — not that they are a
// venue partner. We assert the role server-side before any chrome renders.
const ALLOWED_ROLES = new Set(["partner", "admin", "moderator"]);

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    redirect("/login");
  }

  // Server-side role assertion. ROBUSTNESS: only bounce on a positively
  // confirmed disallowed role (HTTP 200 + admin_role outside the allow-set). On
  // a network error or any non-200 we DO NOT redirect — the API still enforces
  // every data call (403s a non-partner), and a transient /me failure must
  // never lock a legitimate owner out of their dashboard. The redirect runs
  // outside the try so its NEXT_REDIRECT control signal is not swallowed below.
  let denied = false;
  try {
    const headers = apiHeaders();
    // JwtAuthenticate prefers the Authorization header and falls back to the
    // lf_access cookie; forward both so this server-side call authenticates the
    // same way the browser's credentialed requests do.
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Cookie", `${ACCESS_TOKEN_COOKIE}=${token}`);

    const res = await fetch(`${API_BASE_URL}/api/v1/me`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (res.ok) {
      const me = (await res.json()) as { admin_role?: string | null };
      denied = !ALLOWED_ROLES.has(me.admin_role ?? "");
    }
  } catch {
    // Transient/network failure — fail open; the API enforces per-call.
    denied = false;
  }

  if (denied) {
    redirect("/login");
  }

  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
