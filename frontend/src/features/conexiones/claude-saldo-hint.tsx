'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

type ClaudeStatusKind =
  | 'not_configured'
  | 'ok'
  | 'no_balance'
  | 'invalid_key'
  | 'permission_denied'
  | 'rate_limited'
  | 'unavailable'

function hintForStatus(status: ClaudeStatusKind): { text: string; className: string } | null {
  switch (status) {
    case 'ok':
      return { text: 'Saldo disponible', className: 'text-[var(--green)]' }
    case 'no_balance':
      return { text: 'Sin saldo', className: 'text-[var(--red)]' }
    case 'invalid_key':
      return { text: 'Key inválida', className: 'text-[var(--red)]' }
    case 'not_configured':
      return null
    default:
      return null
  }
}

export function ClaudeSaldoHint({ refreshKey = 0 }: { refreshKey?: number }) {
  const [status, setStatus] = useState<ClaudeStatusKind | 'loading'>('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await apiFetch('/call-reports/claude-status')
      const raw = (await res.json().catch(() => ({}))) as { status?: ClaudeStatusKind }
      if (!res.ok) {
        setStatus('unavailable')
        return
      }
      setStatus(raw.status || 'unavailable')
    } catch {
      setStatus('unavailable')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (status === 'loading') return null

  const hint = hintForStatus(status)
  if (!hint) return null

  return <p className={`mt-1 text-[10px] ${hint.className}`}>{hint.text}</p>
}
