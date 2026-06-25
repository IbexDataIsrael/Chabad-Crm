/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Core status indicators matching the source spreadsheet markers.
      colors: {
        status: {
          magenta: "#d6006e",
          green: "#1faa00",
          yellow: "#f2c200",
          darkred: "#8b0000",
          orange: "#ff7a00",
        },
      },
    },
  },
  plugins: [],
};
