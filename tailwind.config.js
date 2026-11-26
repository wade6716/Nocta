/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--nocta-canvas) / <alpha-value>)',
        background: 'rgb(var(--nocta-canvas) / <alpha-value>)',
        surface: 'rgb(var(--nocta-surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--nocta-elevated) / <alpha-value>)',
        card: 'rgb(var(--nocta-surface) / <alpha-value>)',
        border: 'rgba(255, 255, 255, 0.08)',
        primary: {
          DEFAULT: 'rgb(var(--nocta-primary) / <alpha-value>)', // 极光青 Primary
          hover: 'rgb(var(--nocta-primary-hover) / <alpha-value>)',
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
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Segoe UI Variable Display"',
          '"Segoe UI Variable Text"',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
