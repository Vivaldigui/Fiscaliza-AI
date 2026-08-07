import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14211a',
        paper: '#f6f7f3',
        brand: {
          50: '#edf7f0',
          100: '#d8edde',
          500: '#257147',
          600: '#1b5e3a',
          700: '#174c31',
          900: '#123424',
        },
        amber: '#c27b19',
        danger: '#b33a3a',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,33,26,.06), 0 12px 28px rgba(20,33,26,.05)',
      },
    },
  },
  plugins: [],
} satisfies Config;
