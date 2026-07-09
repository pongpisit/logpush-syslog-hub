/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tangerine: "#F6821F",
        ruby: "#FF6633",
        mango: "#FBAD41",
      },
    },
  },
  plugins: [],
};
