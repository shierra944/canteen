import type { Config } from 'tailwindcss';

// Palette sampled from the QNHS logo (green ring, gold sun rays).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          50: '#EAF4EC',
          100: '#D3EAD9',
          200: '#A9D5B5',
          300: '#73BB89',
          400: '#3FA35F',
          500: '#119447',
          600: '#087A35',
          700: '#075B2B',
          800: '#064A24',
          900: '#05391C',
        },
        gold: {
          50: '#FDF9E3',
          100: '#FBF1C0',
          300: '#F4D84A',
          400: '#E9CB32',
          500: '#D4B21E',
          600: '#A98B12',
        },
        ink: {
          DEFAULT: '#202923',
          muted: '#6B756D',
          soft: '#8C958E',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          page: '#F7F9F7',
          sunken: '#F1F5F2',
          border: '#E4EAE5',
        },
        danger: { 50: '#FDF0EE', 500: '#D9534F', 600: '#B83E3A', 700: '#93302D' },
        warn: { 50: '#FFF7E6', 500: '#E59E0B', 600: '#B77A06', 700: '#8A5B04' },
        info: { 50: '#EEF4FB', 500: '#3B78C2', 600: '#2C5F9E' },
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 40, 24, 0.04), 0 1px 3px rgba(16, 40, 24, 0.06)',
        raised: '0 4px 12px rgba(16, 40, 24, 0.08), 0 2px 4px rgba(16, 40, 24, 0.04)',
        overlay: '0 18px 48px rgba(16, 40, 24, 0.18)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 160ms ease-out',
        'slide-in-left': 'slide-in-left 200ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
