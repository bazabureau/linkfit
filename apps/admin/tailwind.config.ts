import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Linkfit admin light palette.
        background: "#F4F7F8",
        surface: "#FFFFFF",
        surfaceElevated: "#F8FAFB",
        border: "#D7DEE4",
        muted: "#7B8794",
        foreground: "#101820",
        foregroundMuted: "#606C7C",
        accent: {
          DEFAULT: "#B7F233",
          hover: "#A5DF22",
          subtle: "#B7F23333",
        },
        // Brand alias used by feature pages.
        brand: {
          green: "#B7F233",
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
        card: "0 1px 2px rgba(16,24,32,0.04), 0 14px 34px rgba(16,24,32,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
