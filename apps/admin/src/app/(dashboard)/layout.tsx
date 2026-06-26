import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";

// Shared httpOnly access cookie set by the API. Read server-side here (the
// browser cannot) as defense-in-depth on top of the edge proxy gate.
const ACCESS_TOKEN_COOKIE = "lf_access";

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

  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
