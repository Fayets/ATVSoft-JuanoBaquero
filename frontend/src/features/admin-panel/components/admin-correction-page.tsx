'use client'

import { useCallback, useEffect, useState } from 'react'
import { DailyPanelPage } from '@/features/daily-panel/components/daily-panel-page'
import {
  readAdminPanelToken,
  verifyAdminPanelToken,
} from '../services/admin-panel-service'
import { AdminPanelPasswordGate } from './admin-panel-password-gate'

function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}

export function AdminCorrectionPage() {
  const [token, setToken] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    const stored = readAdminPanelToken()
    if (!stored) {
      setChecking(false)
      return
    }
    void verifyAdminPanelToken(stored, todayIso()).then((ok) => {
      if (cancelled) return
      setToken(ok ? stored : null)
      setChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleUnlocked = useCallback((next: string) => {
    setToken(next)
  }, [])

  if (checking) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-[var(--text3)]">
        Verificando acceso…
      </div>
    )
  }

  if (!token) {
    return <AdminPanelPasswordGate onUnlocked={handleUnlocked} />
  }

  return <DailyPanelPage mode="admin" adminToken={token} />
}
