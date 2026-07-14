/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand (primary use)
        "brand-bg": "#0a0a0a",
        "brand-surface": "#141414",
        "brand-border": "#262626",
        "brand-border-hover": "#3f3f46",
        "brand-text": "#f4f4f5",
        "brand-text-muted": "#a1a1aa",
        "brand-primary": "#10b981",
        // Surface hierarchy (Obsidian Flux)
        "surface-dim": "#12131a",
        "surface-bright": "#383940",
        "surface-container-lowest": "#0c0e14",
        "surface-container-low": "#1a1b22",
        "surface-container": "#1e1f26",
        "surface-container-high": "#282a31",
        "surface-container-highest": "#33343c",
        "surface-variant": "#33343c",
        "on-surface": "#e2e1eb",
        "on-surface-variant": "#bbcabf",
        "outline": "#86948a",
        "outline-variant": "#3c4a42",
        // Semantic
        "primary": "#4edea3",
        "on-primary": "#003824",
        "primary-container": "#10b981",
        "secondary": "#adc6ff",
        "on-secondary": "#002e6a",
        "secondary-container": "#0566d9",
        "on-secondary-container": "#e6ecff",
        "tertiary": "#ddb7ff",
        "tertiary-container": "#c487ff",
        "error": "#ffb4ab",
        // Legacy aliases (backward compat)
        "bg": "#0a0a0a",
        "accent": "#10b981",
        "border": "#262626",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist", "ui-monospace", "monospace"],
      },
      maxWidth: {
        "container": "1440px",
      },
    },
  },
  plugins: [],
};