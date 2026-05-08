import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette Matix — sobre, ocre/sable Sénégal, à affiner Phase 1
        brand: {
          50: '#fdf6ed',
          100: '#fae9cc',
          200: '#f4d090',
          300: '#edb557',
          400: '#e69f30',
          500: '#cc7f17',
          600: '#a55f12',
          700: '#7d4510',
          800: '#5a3210',
          900: '#3a200b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
