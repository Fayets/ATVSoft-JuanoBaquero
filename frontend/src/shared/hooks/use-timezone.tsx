'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch, backendAuthHeaders } from '@/lib/api'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import {
  DEFAULT_TIMEZONE,
  findTimezoneOption,
  type TimezoneOption,
} from '@/shared/lib/timezone'

type TimezoneContextValue = {
  timeZone: string
  option: TimezoneOption
  ready: boolean
  saving: boolean
  setTimezone: (timeZone: string) => Promise<void>
}

const TimezoneContext = createContext<TimezoneContextValue | null>(null)

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, userId } = useAuthUser()
  const [timeZone, setTimeZoneState] = useState(DEFAULT_TIMEZONE)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!authReady) return
    if (!userId) {
      setTimeZoneState(DEFAULT_TIMEZONE)
      setReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/settings', { headers: backendAuthHeaders() })
        const data = (await res.json().catch(() => ({}))) as { timezone?: string }
        if (!cancelled && res.ok && data.timezone) {
          setTimeZoneState(findTimezoneOption(data.timezone).timeZone)
        }
      } catch {
        /* default */
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authReady, userId])

  const setTimezone = useCallback(
    async (next: string) => {
      const opt = findTimezoneOption(next)
      setTimeZoneState(opt.timeZone)
      if (!userId) return
      setSaving(true)
      try {
        const res = await apiFetch('/settings/timezone', {
          method: 'PUT',
          headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ timezone: opt.timeZone }),
        })
        const data = (await res.json().catch(() => ({}))) as { timezone?: string; detail?: string }
        if (res.ok && data.timezone) {
          setTimeZoneState(findTimezoneOption(data.timezone).timeZone)
        }
      } finally {
        setSaving(false)
      }
    },
    [userId],
  )

  const value = useMemo<TimezoneContextValue>(
    () => ({
      timeZone,
      option: findTimezoneOption(timeZone),
      ready,
      saving,
      setTimezone,
    }),
    [timeZone, ready, saving, setTimezone],
  )

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>
}

export function useTimezone(): TimezoneContextValue {
  const ctx = useContext(TimezoneContext)
  if (!ctx) throw new Error('useTimezone must be used within TimezoneProvider')
  return ctx
}
