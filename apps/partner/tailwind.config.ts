import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Linkfit dark palette — mirrors iOS tokens.
        background: "#0A0E14",
        surface: "#141A22",
        surfaceElevated: "#1E2530",
        border: "#262F3D",
        muted: "#8A94A6",
        foreground: "#E6EAF2",
        foregroundMuted: "#9CA6B8",
        accent: {
          DEFAULT: "#22C55E",
          hover: "#16A34A",
          subtle: "#22C55E1A",
        },
        // Brand alias used by feature pages (matches the iOS brand-green).
        brand: {
          green: "#22C55E",
        },
        danger: {
          DEFAULT: "#EF4444",
          subtle: "#EF44441A",
        },
        warning: {
          DEFAULT: "#F59E0B",
          subtle: "#F59E0B1A",
        },
        info: {
          DEFAULT: "#3B82F6",
          subtle: "#3B82F61A",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
