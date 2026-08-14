'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/shared/components/sidebar'
import { Topbar } from '@/shared/components/topbar'

type MainLayoutShellProps = {
  children: React.ReactNode
}

export function MainLayoutShell({ children }: MainLayoutShellProps) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      <Sidebar className="hidden md:flex" />
      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Cerrar menú"
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <Sidebar className="fixed inset-y-0 left-0 z-50 flex md:hidden" />
        </>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main
          className={`flex-1 p-4 sm:p-6 lg:p-8 ${
            pathname === '/panel-diario'
              ? 'max-w-none overflow-x-hidden'
              : 'max-w-[1580px] overflow-x-hidden'
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
