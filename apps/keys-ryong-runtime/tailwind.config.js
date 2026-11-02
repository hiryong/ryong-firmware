/** @type {import('tailwindcss').Config} */
import trac from "tailwindcss-react-aria-components";
import contQueries from "@tailwindcss/container-queries";

export default {
  content: ["./index.html", "./download.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    fontSize: {
      xs: "0.4rem",
    },
    extend: {
      // ryong: true black, one typeface (Geist + Pretendard), hairlines — matches ryong.com CMS.
      fontFamily: {
        sans: ["Geist", "Pretendard Variable", "Pretendard", "system-ui"],
      },
      colors: {
        primary: "#FCFDFF",
        "primary-content": "#000000",
        secondary: "#A1A4A5",
        accent: "#FCFDFF",
        "base-content": "#FCFDFF",
        "base-100": "#000000",
        "base-200": "#0A0A0A",
        "base-300": "#141414",
      },
    },

    fontFamily: {
      keycap: ["Geist", "Pretendard Variable", "Pretendard", "system-ui"],
    },
  },
  plugins: [contQueries, trac({ prefix: "rac" })],
};
