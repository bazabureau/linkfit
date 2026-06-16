import type { Metadata } from "next";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linkfit Admin",
  description: "Linkfit administration panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="az" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <I18nProvider>
          {children}
          <Toaster
            theme="light"
            position="top-right"
            toastOptions={{
              style: {
                background: "#FFFFFF",
                border: "1px solid #D7DEE4",
                color: "#101820",
              },
            }}
          />
        </I18nProvider>
      </body>
    </html>
  );
}
