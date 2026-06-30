import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import { API_BASE_URL, apiHeaders } from "@/lib/api";

// Shared httpOnly access cookie set by the API. Read server-side here (the
// browser cannot) as defense-in-depth on top of the edge proxy gate.
const ACCESS_TOKEN_COOKIE = "lf_access";

// Roles allowed into the admin panel. The `lf_access` cookie is a SHARED
// platform cookie (Domain=.linkfit.az), so its mere presence only proves the
// visitor is logged in *somewhere* — not that they are staff. We assert the
// role server-side below before rendering any chrome.
const ALLOWED_ADMIN_ROLES = ["admin", "moderator"] as const;

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

  // Confirm the caller is actually staff. The cookie value is the raw access
  // JWT, so we forward it as both a Bearer header (which the API prefers) and
  // the lf_access cookie. IMPORTANT: only bounce on a POSITIVELY confirmed
  // non-staff role (200 + admin_role not in the allowed set). A network error
  // or any non-200 falls through and renders the shell — the API still enforces
  // authz on every data call, so a transient /me blip must never lock staff out.
  // The redirect is performed AFTER the try/catch: `redirect()` works by
  // throwing NEXT_REDIRECT, and calling it inside the try would let the catch
  // swallow that control-flow signal.
  let bounceNonStaff = false;
  try {
    const headers = apiHeaders();
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Cookie", `${ACCESS_TOKEN_COOKIE}=${token}`);

    const res = await fetch(`${API_BASE_URL}/api/v1/me`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (res.ok) {
      const me = (await res.json()) as { admin_role?: string | null };
      const role = me.admin_role ?? null;
      if (role === null || !ALLOWED_ADMIN_ROLES.includes(role as never)) {
        bounceNonStaff = true;
      }
    }
  } catch {
    // Genuine fetch/network failure — let the request through.
  }

  if (bounceNonStaff) {
    redirect("/login");
  }

  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
