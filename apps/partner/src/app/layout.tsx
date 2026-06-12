import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linkfit Partner Portal",
  description: "Linkfit B2B court operator and partner portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="az" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: "#141A22",
              border: "1px solid #262F3D",
              color: "#E6EAF2",
            },
          }}
        />
      </body>
    </html>
  );
}
