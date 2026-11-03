/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1020",
        panel: "#121a2b",
        line: "#263247",
        muted: "#91a0b8",
        mint: "#75e0b2"
      },
      boxShadow: {
        glow: "0 18px 60px rgba(0,0,0,.25)"
      }
    }
  },
  plugins: []
};
