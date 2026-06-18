import type { Metadata } from "next";
import { Onest, Unbounded } from "next/font/google";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

const onest = Onest({
  subsets: ["latin", "latin-ext"],
  variable: "--font-onest",
  display: "swap",
});

const unbounded = Unbounded({
  subsets: ["latin", "latin-ext"],
  variable: "--font-unbounded",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LinkFit · Idarəetmə",
  description: "LinkFit administration panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="az" suppressHydrationWarning className={`${onest.variable} ${unbounded.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <I18nProvider>
          {children}
          <Toaster
            theme="light"
            position="top-right"
            toastOptions={{
              style: {
                background: "#FFFFFF",
                border: "1px solid #E2E8EC",
                borderRadius: "14px",
                boxShadow: "0 1px 2px rgba(11,16,22,0.04), 0 16px 40px rgba(11,16,22,0.10)",
                color: "#0B1016",
                fontFamily: "var(--font-onest)",
              },
            }}
          />
        </I18nProvider>
      </body>
    </html>
  );
}
