import * as React from "react";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
