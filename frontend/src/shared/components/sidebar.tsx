'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { logout } from '@/features/auth/services/auth-service'
import { useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { BrandLogo } from '@/shared/components/brand-logo'

type NavLeaf = { label: string; href: string }
/** `children` = subítems (ej. Métricas reels bajo Reels). */
type NavItem = NavLeaf & { children?: NavLeaf[] }
type NavGroup = {
  title: string
  icon: string
  items: NavItem[]
  defaultOpen?: boolean
  href?: string
}

const navigation: NavGroup[] = [
  {
    title: 'Dashboard diario',
    icon: '◆',
    href: '/panel-diario',
    items: [],
  },
  {
    title: 'Dashboard ventas',
    icon: '◆',
    href: '/sales-dashboard',
    items: [],
  },
  {
    title: 'Dashboard marketing',
    icon: '◆',
    href: '/dashboard',
    items: [],
  },
]

const dataGroups: NavGroup[] = [
  {
    title: 'Trackeo de contenido', icon: '📊',
    items: [
      { label: 'Reels', href: '/reels', children: [{ label: 'Métricas', href: '/metrica-reels' }] },
      { label: 'Historias', href: '/historias' },
      { label: 'YouTube', href: '/youtube' },
      { label: 'BIO', href: '/bio' },
      { label: 'Lead por reel', href: '/keywords', children: [{ label: 'Métricas', href: '/metrica-keywords' }] },
    ],
  },
  {
    title: 'Trackeo de ventas', icon: '💰',
    items: [
      { label: 'Leads', href: '/leads' },
      { label: 'Cobranzas', href: '/cobranzas' },
      { label: 'Reporte calls', href: '/reporte-calls' },
      { label: 'Reportes semanales', href: '/reportes-semanales' },
    ],
  },
  {
    title: 'Trackeo de equipo', icon: '👥',
    items: [
      { label: 'Dashboard equipo', href: '/team' },
      { label: 'Carga de Reportes', href: '/team/reportes' },
      { label: 'Historial de reportes', href: '/team/historial-reportes' },
      { label: 'Equipo', href: '/team/equipo' },
    ],
  },
]

const settingsGroup: NavGroup = {
  title: 'Ajustes',
  icon: '⚙',
  defaultOpen: true,
  items: [
    { label: 'Listas maestras', href: '/listas' },
    { label: 'Programas', href: '/programas' },
    { label: 'Avatares', href: '/avatares' },
    { label: 'Tasa de refresco', href: '/ajustes/tasa-refresco' },
    { label: 'Conexiones API', href: '/conexiones' },
  ],
}

function capitalizeFirstLetter(label: string): string {
  if (!label) return label
  return label.charAt(0).toUpperCase() + label.slice(1)
}

type SidebarProps = {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { username, ready } = useAuthUser()
  const trimmed = username?.trim() || ''
  const displayName = !ready ? '…' : trimmed ? capitalizeFirstLetter(trimmed) : 'Usuario'

  const onLogout = async () => {
    await logout()
    router.replace('/login')
  }

  return (
    <aside
      className={`sticky top-0 flex h-screen w-56 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg2)] ${className ?? ''}`}
    >
      <div className="flex justify-center px-4 pt-4 pb-3">
        <BrandLogo className="h-12 w-auto max-w-[72px] flex-shrink-0 object-contain opacity-95" />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex flex-col gap-1">
          {navigation.map((group) => (
            <CollapsibleGroup key={group.title} group={group} pathname={pathname} />
          ))}
        </div>

        <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--text3)]">
          Datos
        </div>
        <div className="flex flex-col gap-1">
          {dataGroups.map((group) => (
            <CollapsibleGroup key={group.title} group={group} pathname={pathname} showBadge />
          ))}
        </div>

        <div className="mt-1 flex flex-col gap-1 border-t border-[var(--border)] pt-2">
          <CollapsibleGroup group={settingsGroup} pathname={pathname} showBadge />
        </div>
      </nav>

      <div className="mt-1 border-t border-[var(--border)] px-4 pb-3 pt-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p
              className="truncate text-[13px] font-medium text-[var(--text2)]"
              title={displayName}
            >
              {displayName}
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--text3)]">© 2026 ATV</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/admin/correccion-closer"
              prefetch={false}
              aria-label="Corrección reportes"
              title="Corrección reportes (admin)"
              className={`inline-flex h-6 w-6 items-center justify-center rounded bg-transparent transition-all ${
                pathname === '/admin/correccion-closer'
                  ? 'bg-[var(--accent-faint)] text-[var(--accent)]'
                  : 'text-[var(--accent)] hover:bg-[var(--accent-faint)]'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
            <button
              type="button"
              onClick={onLogout}
              className="shrink-0 rounded bg-transparent px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] transition-all hover:bg-[var(--accent-faint)]"
            >
              Salir
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function groupContainsPath(group: NavGroup, pathname: string): boolean {
  return group.items.some(
    (item) =>
      pathname === item.href ||
      (item.children?.some((c) => pathname === c.href) ?? false),
  )
}

function CollapsibleGroup({ group, pathname, showBadge }: { group: NavGroup; pathname: string; showBadge?: boolean }) {
  const directActive = group.href ? pathname === group.href : false
  const hasActiveChild = groupContainsPath(group, pathname)
  const [open, setOpen] = useState(group.defaultOpen ?? hasActiveChild)

  if (group.href) {
    return (
      <div className="mb-0">
        <Link
          href={group.href}
          prefetch={false}
          className={`flex min-h-8 w-full items-center rounded-md px-3 py-1.5 text-[13px] font-medium transition-all text-left ${
            directActive
              ? 'bg-[var(--accent-faint)] text-[var(--text)]'
              : 'text-[var(--text2)] hover:bg-[var(--nav-hover)]'
          }`}
        >
          <span className="flex-1">{group.title}</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="mb-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? `Contraer menú: ${group.title}` : `Expandir menú: ${group.title}`}
        className={`flex min-h-8 w-full items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium text-left transition-all hover:bg-[var(--nav-hover)] ${
          hasActiveChild ? 'text-[var(--text)]' : 'text-[var(--text2)]'
        }`}
      >
        <span
          className={`shrink-0 text-[10px] text-[var(--text3)] transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="min-w-0 flex-1 truncate">{group.title}</span>
        {showBadge && group.items.length > 0 && (
          <span className="shrink-0 rounded-full bg-[var(--bg4)] px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-[var(--text3)]">
            {group.items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="mb-1 mt-0.5 flex flex-col gap-0.5 py-1 pr-1">
          {group.items.map((item) => {
            const childActive = item.children?.some((c) => pathname === c.href) ?? false
            const parentActive = pathname === item.href
            const hasChildren = Boolean(item.children?.length)
            return (
              <div key={item.href} className={`flex flex-col ${hasChildren ? 'mb-1' : ''}`}>
                <Link
                  href={item.href}
                  prefetch={false}
                  className={`flex min-h-8 items-center gap-2.5 truncate rounded-md py-1.5 pl-7 pr-2 text-[12px] transition-all outline-none focus-visible:ring-1 focus-visible:ring-[var(--border2)] ${
                    parentActive
                      ? 'bg-[var(--accent-faint)] font-medium text-[var(--text)]'
                      : childActive
                        ? 'text-[var(--text)] hover:bg-[var(--nav-hover)]'
                        : 'text-[var(--text2)] hover:bg-[var(--nav-hover)] hover:text-[var(--text)]'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      parentActive || childActive ? 'bg-[var(--accent)]' : 'bg-[var(--text3)]/40'
                    }`}
                    aria-hidden
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
                {hasChildren && (
                  <div
                    className="ml-10 mr-1 flex flex-col gap-0.5 border-l border-[var(--border2)] py-0.5 pl-4"
                    role="group"
                    aria-label={item.label}
                  >
                    {item.children!.map((sub) => {
                      const subActive = pathname === sub.href
                      return (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          prefetch={false}
                          className={`flex min-h-7 items-center truncate rounded-md py-1 pl-0.5 pr-2 text-[11px] transition-all outline-none focus-visible:ring-1 focus-visible:ring-[var(--border2)] ${
                            subActive
                              ? 'bg-[var(--bg4)] font-medium text-[var(--text)]'
                              : 'text-[var(--text3)] hover:bg-[var(--nav-hover)] hover:text-[var(--text2)]'
                          }`}
                        >
                          {sub.label}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
