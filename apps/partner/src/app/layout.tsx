import type { Metadata } from "next";
import { Onest, Unbounded } from "next/font/google";
import { Toaster } from "sonner";
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
  title: "LinkFit · Partnyor portalı",
  description: "LinkFit B2B court operator and partner portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="az" className={`dark ${onest.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: "#141A22",
              border: "1px solid #2A3441",
              borderRadius: "14px",
              color: "#E6EAF2",
              fontFamily: "var(--font-onest)",
            },
          }}
        />
      </body>
    </html>
  );
}
