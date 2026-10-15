/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#0B0E17',
        background: '#0B0E17',
        surface: '#131826',
        'surface-elevated': '#131826',
        card: '#131826',
        border: 'rgba(255, 255, 255, 0.08)',
        primary: {
          DEFAULT: '#38BDF8', // 极光青 Primary
          hover: '#0ea5e9',
        },
        secondary: {
          DEFAULT: '#818CF8', // 流光紫 Secondary
          hover: '#6366f1',
        },
        danmaku: {
          DEFAULT: '#F472B6', // 星芒粉 Danmaku
          pink: '#F472B6',
          cyan: '#38BDF8',
          yellow: '#FBBF24',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
