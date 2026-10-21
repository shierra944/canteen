import type { Config } from 'tailwindcss';

// Palette sampled from the QNHS logo (green ring, gold sun rays).
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      // Colours are CSS variables (src/index.css) so the dark theme can swap them.
      colors: {
        brand: {
          50: 'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: 'rgb(var(--c-brand-200) / <alpha-value>)',
          300: 'rgb(var(--c-brand-300) / <alpha-value>)',
          400: 'rgb(var(--c-brand-400) / <alpha-value>)',
          500: 'rgb(var(--c-brand-500) / <alpha-value>)',
          600: 'rgb(var(--c-brand-600) / <alpha-value>)',
          700: 'rgb(var(--c-brand-700) / <alpha-value>)',
          800: 'rgb(var(--c-brand-800) / <alpha-value>)',
          900: 'rgb(var(--c-brand-900) / <alpha-value>)',
        },
        gold: {
          50: 'rgb(var(--c-gold-50) / <alpha-value>)',
          100: 'rgb(var(--c-gold-100) / <alpha-value>)',
          300: 'rgb(var(--c-gold-300) / <alpha-value>)',
          400: 'rgb(var(--c-gold-400) / <alpha-value>)',
          500: 'rgb(var(--c-gold-500) / <alpha-value>)',
          600: 'rgb(var(--c-gold-600) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          soft: 'rgb(var(--c-ink-soft) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          page: 'rgb(var(--c-surface-page) / <alpha-value>)',
          sunken: 'rgb(var(--c-surface-sunken) / <alpha-value>)',
          border: 'rgb(var(--c-surface-border) / <alpha-value>)',
          strong: 'rgb(var(--c-surface-strong) / <alpha-value>)',
        },
        sidebar: 'rgb(var(--c-sidebar) / <alpha-value>)',
        danger: {
          50: 'rgb(var(--c-danger-50) / <alpha-value>)',
          500: 'rgb(var(--c-danger-500) / <alpha-value>)',
          600: 'rgb(var(--c-danger-600) / <alpha-value>)',
          700: 'rgb(var(--c-danger-700) / <alpha-value>)',
        },
        warn: {
          50: 'rgb(var(--c-warn-50) / <alpha-value>)',
          500: 'rgb(var(--c-warn-500) / <alpha-value>)',
          600: 'rgb(var(--c-warn-600) / <alpha-value>)',
          700: 'rgb(var(--c-warn-700) / <alpha-value>)',
        },
        info: {
          50: 'rgb(var(--c-info-50) / <alpha-value>)',
          500: 'rgb(var(--c-info-500) / <alpha-value>)',
          600: 'rgb(var(--c-info-600) / <alpha-value>)',
        },
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
        // uses the separate `scale` property so it never overrides the
        // translate(-50%, -50%) that centres dialogs (a `transform` keyframe
        // would make them slide in from the bottom-right)
        'scale-in': { from: { opacity: '0', scale: '0.97' }, to: { opacity: '1', scale: '1' } },
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
