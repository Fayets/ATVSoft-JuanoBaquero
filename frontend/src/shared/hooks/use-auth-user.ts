'use client'

import { useState, useEffect } from 'react'
import { resolveBackendUserId, resolveSessionUsername } from '@/lib/api'

/** `user_id` entero del login FastAPI (string en el cliente), o null si no hay sesión. */
export function useAuthUser() {
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sync = () => {
      setUserId(resolveBackendUserId())
      setUsername(resolveSessionUsername())
    }
    sync()
    setReady(true)
    window.addEventListener('auth-session-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('auth-session-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return { userId, username, ready }
}
