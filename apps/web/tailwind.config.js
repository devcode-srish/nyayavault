/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        vault: {
          50: "#f4f6f8",
          100: "#e4e9ee",
          200: "#c7d1db",
          300: "#9dadc0",
          400: "#6c839f",
          500: "#4a6484",
          600: "#38506d",
          700: "#2e4159",
          800: "#28374b",
          900: "#0f1720",
          950: "#0a0f16",
        },
      },
    },
  },
  plugins: [],
};
