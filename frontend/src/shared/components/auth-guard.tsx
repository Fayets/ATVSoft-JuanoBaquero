'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

function hasSession(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    sessionStorage.getItem('evoluciona_token') ||
      sessionStorage.getItem('access_token') ||
      sessionStorage.getItem('token') ||
      sessionStorage.getItem('auth_token')
  )
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login')
      return
    }
    setChecking(false)
  }, [router])

  if (checking) {
    return <div className="p-8 text-sm text-[var(--text3)]">Validando sesion...</div>
  }

  return <>{children}</>
}
