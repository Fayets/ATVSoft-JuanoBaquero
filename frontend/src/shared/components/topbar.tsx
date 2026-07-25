'use client'

import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/shared/components/theme-toggle'
import { TimezoneSelector } from '@/shared/components/timezone-selector'

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/reels': 'Reels',
  '/keywords': 'Lead por reel',
  '/historias': 'Historias',
  '/youtube': 'YouTube',
  '/leads': 'Leads',
  '/panel-diario': 'Dashboard diario',
  '/reporte-calls': 'Reporte calls',
  '/reportes-semanales': 'Reportes semanales',
  '/hot-leads': 'Hot Leads',
  '/sales-dashboard': 'Ventas',
  '/team': 'Equipo',
  '/bio': 'BIO',
  '/referidos': 'Referidos',
  '/diferidos': 'Diferidos',
  '/objetivos': 'Objetivos',
  '/listas': 'Listas Maestras',
  '/programas': 'Programas',
  '/avatares': 'Avatares',
  '/conexiones': 'Conexiones API',
  '/ajustes/cuenta': 'Mi cuenta',
  '/ajustes/tasa-refresco': 'Tasa de refresco',
  '/admin/correccion-closer': 'Corrección reportes',
}

const subtitles: Record<string, string> = {
  '/dashboard': 'Contenido',
  '/sales-dashboard': 'Dashboard',
  '/team': 'Dashboard',
  '/bio': 'Canal directo',
  '/referidos': 'Canal directo',
  '/diferidos': 'Atribucion cruzada',
  '/listas': 'Configuracion',
  '/programas': 'Configuracion',
  '/avatares': 'Configuracion',
  '/conexiones': 'Configuracion',
  '/panel-diario': 'Dashboard',
  '/ajustes/cuenta': 'Ajustes',
  '/ajustes/tasa-refresco': 'Ajustes',
  '/admin/correccion-closer': 'Admin',
}

type TopbarProps = {
  onMenuClick?: () => void
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const pathname = usePathname()
  const hideTitleForPath = [
    '/panel-diario',
    '/reels',
    '/keywords',
    '/historias',
    '/youtube',
    '/bio',
    '/listas',
    '/programas',
    '/avatares',
    '/conexiones',
    '/ajustes/cuenta',
    '/ajustes/tasa-refresco',
    '/admin/correccion-closer',
    '/team',
    '/team/reportes',
    '/team/historial-reportes',
  ].includes(pathname)
  const title = titles[pathname] || 'Dashboard'
  const subtitle = subtitles[pathname]

  return (
    <header className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--topbar-bg)] px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8 lg:py-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {onMenuClick ? (
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border2)] text-[var(--text2)] hover:bg-[var(--nav-hover)] md:hidden"
            aria-label="Abrir menú"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        ) : null}
        {!hideTitleForPath && (
          <h1 className="text-[15px] font-semibold tracking-tight">
            {title}
            {subtitle && (
              <span className="font-semibold text-[var(--text2)]"> {subtitle}</span>
            )}
          </h1>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <TimezoneSelector />
        <ThemeToggle />
      </div>
    </header>
  )
}
