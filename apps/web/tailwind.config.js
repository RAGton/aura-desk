/** @type {import("tailwindcss").Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        aura: {
          canvas: "rgb(var(--bg-canvas) / <alpha-value>)",
          surface: "rgb(var(--bg-surface) / <alpha-value>)",
          elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
          overlay: "rgb(var(--bg-overlay) / <alpha-value>)",
          muted: "rgb(var(--bg-muted) / <alpha-value>)",
          primary: "rgb(var(--text-primary) / <alpha-value>)",
          secondary: "rgb(var(--text-secondary) / <alpha-value>)",
          "text-muted": "rgb(var(--text-muted) / <alpha-value>)",
          inverse: "rgb(var(--text-inverse) / <alpha-value>)",
          border: "rgb(var(--border-subtle) / <alpha-value>)",
          "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
          focus: "rgb(var(--border-focus) / <alpha-value>)",
          accent: "rgb(var(--accent-primary) / <alpha-value>)",
          "accent-secondary": "rgb(var(--accent-secondary) / <alpha-value>)",
          success: "rgb(var(--status-success) / <alpha-value>)",
          warning: "rgb(var(--status-warning) / <alpha-value>)",
          danger: "rgb(var(--status-danger) / <alpha-value>)",
          info: "rgb(var(--status-info) / <alpha-value>)",
        },
      },
      borderRadius: {
        "aura-sm": "var(--radius-sm)",
        "aura-md": "var(--radius-md)",
        "aura-lg": "var(--radius-lg)",
        "aura-xl": "var(--radius-xl)",
      },
      boxShadow: {
        "aura-surface": "var(--shadow-surface)",
        "aura-elevated": "var(--shadow-elevated)",
      },
    },
  },
  plugins: [],
};
