import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // LinkFit dark "Meydan" palette — partner portal.
        background: "#0A0D12",
        surface: "#141A22",
        surfaceElevated: "#1E2530",
        border: "#262F3D",
        borderStrong: "#33404F",
        muted: "#8A94A6",
        foreground: "#E6EAF2",
        foregroundMuted: "#9CA6B8",
        // Brand lime accent (LinkFit), great on the dark canvas.
        accent: {
          DEFAULT: "#C5F235",
          hover: "#B2E024",
          subtle: "#C5F2351F",
          ink: "#0A0D12",
        },
        // Brand alias used by feature pages.
        brand: {
          green: "#C5F235",
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
          "var(--font-onest)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        display: ["var(--font-unbounded)", "var(--font-onest)", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)",
        lift: "0 2px 0 rgba(255,255,255,0.05), 0 24px 48px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};

export default config;
