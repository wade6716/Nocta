/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f1115',
        surface: '#161922',
        card: '#1d212c',
        border: '#2a303f',
        primary: {
          DEFAULT: '#00a4dc', // Emby Blue
          hover: '#1ab1e5',
        },
        danmaku: {
          pink: '#ff4d88',
          cyan: '#00e5ff',
          yellow: '#ffe600',
        }
      },
    },
  },
  plugins: [],
}
