/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Editor theme colors (mapping to CSS variables in index.css)
        // accent/accent-hover use rgb(var(--..) / <alpha-value>) so Tailwind
        // opacity modifiers work (e.g. bg-editor-accent/10).
        editor: {
          bg: 'var(--color-background)',
          panel: 'var(--color-surface-container-lowest)',
          'panel-high': 'var(--color-surface-container-high)',
          'panel-low': 'var(--color-surface-container-low)',
          border: 'var(--color-outline-variant)',
          text: 'var(--color-on-surface)',
          'text-muted': 'var(--color-on-surface-variant)',
          accent: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
          'accent-hover': 'rgb(var(--color-primary-darker-rgb) / <alpha-value>)',
          hover: 'var(--color-surface-container)',
          workspace: 'var(--color-surface-container)',
          surface: {
            DEFAULT: 'var(--color-surface)',
            lowest: 'var(--color-surface-container-lowest)',
            low: 'var(--color-surface-container-low)',
            DEFAULT: 'var(--color-surface-container)',
            high: 'var(--color-surface-container-high)',
            highest: 'var(--color-surface-container-highest)',
          },
        },
        // shadcn/ui color tokens
        background: 'var(--color-background)',
        foreground: 'var(--color-on-background)',
        card: {
          DEFAULT: 'var(--color-surface-container-lowest)',
          foreground: 'var(--color-on-surface)',
        },
        popover: {
          DEFAULT: 'var(--color-surface-container-lowest)',
          foreground: 'var(--color-on-surface)',
        },
        primary: {
          DEFAULT: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
          foreground: 'var(--color-on-primary)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          foreground: 'var(--color-on-secondary)',
        },
        muted: {
          DEFAULT: 'var(--color-surface-container)',
          foreground: 'var(--color-on-surface-variant)',
        },
        accent: {
          DEFAULT: 'var(--color-surface-container-high)',
          foreground: 'var(--color-on-surface)',
        },
        destructive: {
          DEFAULT: 'rgb(220, 38, 38)',
          foreground: 'rgb(255, 255, 255)',
        },
        border: 'var(--color-outline-variant)',
        input: 'var(--color-outline-variant)',
        ring: 'var(--color-primary)',
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
}
