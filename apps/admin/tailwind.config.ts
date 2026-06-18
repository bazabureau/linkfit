import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // LinkFit admin — refined light canvas + ink control rail.
        background: "#F5F7F8",
        surface: "#FFFFFF",
        surfaceElevated: "#F8FAFB",
        border: "#E4E9ED",
        borderStrong: "#D2DAE0",
        muted: "#7B8794",
        foreground: "#0B1016",
        foregroundMuted: "#5C6675",
        // Dark "control room" rail.
        ink: "#0E1116",
        inkElevated: "#161B22",
        inkBorder: "rgba(255,255,255,0.07)",
        accent: {
          DEFAULT: "#B7F233",
          hover: "#A5DF22",
          subtle: "#B7F23322",
          ink: "#0E1116",
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
        card: "0 1px 2px rgba(11,16,22,0.04), 0 14px 34px rgba(11,16,22,0.07)",
        lift: "0 2px 6px rgba(11,16,22,0.06), 0 24px 50px rgba(11,16,22,0.12)",
        rail: "0 0 0 1px rgba(255,255,255,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
