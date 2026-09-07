import type { Config } from 'tailwindcss';

/**
 * Token diambil dari UIUX_ACM.md §2.
 * Warna severity sengaja TIDAK ikut berubah antara mode terang dan gelap
 * (UIUX §2.3) — maknanya harus tetap sama di layar mana pun.
 */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          base: 'var(--surface-base)',
          elevated: 'var(--surface-elevated)',
        },
        brand: {
          DEFAULT: 'var(--brand-primary)',
          hover: 'var(--brand-primary-hover)',
          soft: 'var(--brand-primary-soft)',
        },
        content: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
        },
        line: 'var(--border-default)',
        severity: {
          critical: '#E24B4A',
          warning: '#EF9F27',
          info: 'var(--brand-primary)',
          unknown: '#888780',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        // Data identitas unit (VHCID, no. plat, timestamp) selalu monospace,
        // supaya mata operator langsung membedakannya dari teks naratif (UIUX §3).
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sidebar: '28px',
        topbar: '24px',
        card: '20px',
        alert: '16px',
        btn: '12px',
        input: '10px',
      },
    },
  },
  plugins: [],
} satisfies Config;
