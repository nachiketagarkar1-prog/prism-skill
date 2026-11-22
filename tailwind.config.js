import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      colors: {
        prism: {
          50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd",
          400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9",
        },
        gvr: { purple: "#351049", cyan: "#56CBF8", violet: "#A651D8" },
      },
      backgroundImage: {
        "prism-gradient": "linear-gradient(90deg, #7c5cff 0%, #5b8cff 50%, #22d3ee 100%)",
      },
      boxShadow: { composer: "0 8px 30px -8px rgba(76, 29, 149, 0.18)" },
    },
  },
  plugins: [typography],
};
