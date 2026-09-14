import animate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 语义色板由 CSS 变量驱动，支持明暗主题切换并保留透明度修饰符
        surface: {
          900: 'rgb(var(--surface-900) / <alpha-value>)',
          800: 'rgb(var(--surface-800) / <alpha-value>)',
          700: 'rgb(var(--surface-700) / <alpha-value>)',
          600: 'rgb(var(--surface-600) / <alpha-value>)'
        },
        ink: {
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)'
        },
        line: 'rgb(var(--line) / <alpha-value>)',
        brand: {
          indigo: '#6366F1',
          violet: '#8B5CF6',
          cyan: '#22D3EE'
        },
        state: {
          ok: '#22C55E',
          warn: '#F59E0B',
          danger: '#EF4444',
          info: '#38BDF8'
        }
      },
      fontFamily: {
        sans: ['思源黑体', 'Source Han Sans SC', 'Microsoft YaHei', 'system-ui', 'sans-serif']
      },
      fontSize: {
        heading: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        subheading: ['14px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['13px', { lineHeight: '21px', fontWeight: '400' }],
        micro: ['11px', { lineHeight: '16px', fontWeight: '400' }]
      },
      boxShadow: {
        glass: '0 8px 32px rgba(4, 8, 20, 0.45)',
        card: '0 1px 2px rgba(4, 8, 20, 0.35), 0 8px 24px rgba(4, 8, 20, 0.25)',
        glow: '0 0 0 1px rgba(99, 102, 241, 0.35), 0 8px 24px rgba(99, 102, 241, 0.25)'
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 55%, #22D3EE 100%)',
        'panel-gradient':
          'linear-gradient(180deg, rgb(var(--surface-800) / 0.92) 0%, rgb(var(--surface-900) / 0.96) 100%)'
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' }
        }
      },
      animation: {
        'fade-up': 'fade-up 220ms ease-out both',
        'fade-in': 'fade-in 180ms ease-out both',
        shimmer: 'shimmer 1.4s linear infinite'
      }
    }
  },
  plugins: [animate]
}
