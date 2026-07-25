'use client'

import { useTheme } from './theme-provider'

type ThemeToggleProps = {
  className?: string
}

/** Media luna (creciente) — silueta clara a tamaño chico. */
function IconMoon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z" />
    </svg>
  )
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      aria-label={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
      aria-pressed={isLight}
      className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border2)] bg-[var(--bg3)] text-[var(--text2)] transition-all hover:border-[var(--accent)] hover:bg-[var(--accent-faint)] hover:text-[var(--accent)] ${className}`}
    >
      <IconMoon className={isLight ? 'opacity-100' : 'opacity-90'} />
    </button>
  )
}
