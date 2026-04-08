/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Flow Brand — Fresh Vibrant Green ─────────────────────────────────
        brand: {
          50:  '#ecfdf5',   // emerald-50
          100: '#d1fae5',   // emerald-100
          200: '#a7f3d0',   // emerald-200
          300: '#6ee7b7',   // emerald-300
          400: '#34d399',   // emerald-400
          500: '#10b981',   // emerald-500  ← primary
          600: '#059669',   // emerald-600  ← hover
          700: '#047857',   // emerald-700  ← dark
          800: '#065f46',   // emerald-800
          900: '#064e3b',   // emerald-900
          950: '#022c22',   // emerald-950
        },
        // ── Teal accent (gradient partner) ───────────────────────────────────
        accent: {
          400: '#2dd4bf',   // teal-400
          500: '#14b8a6',   // teal-500
          600: '#0d9488',   // teal-600
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        'card':    '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
        'card-lg': '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
        'glow-sm': '0 0 0 3px rgb(16 185 129 / 0.15)',
        'glow':    '0 0 0 4px rgb(16 185 129 / 0.20)',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}
