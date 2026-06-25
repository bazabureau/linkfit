import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookies";

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
