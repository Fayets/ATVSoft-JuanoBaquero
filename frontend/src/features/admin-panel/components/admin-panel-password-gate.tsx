'use client'

import { useState } from 'react'
import { unlockAdminPanel } from '../services/admin-panel-service'

type Props = {
  onUnlocked: (token: string) => void
}

export function AdminPanelPasswordGate({ onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!password.trim()) {
      setError('Ingresá la contraseña.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const token = await unlockAdminPanel(password)
      onUnlocked(token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Contraseña incorrecta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4">
      <div className="glass-card glass-card--performant p-6">
        <div className="mb-1 flex items-center gap-2 text-[var(--accent)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h1 className="text-[15px] font-semibold text-[var(--text)]">Acceso restringido</h1>
        </div>
        <p className="mb-5 text-[13px] leading-relaxed text-[var(--text3)]">
          Panel de corrección de reportes closer. Ingresá la contraseña para continuar.
        </p>
        <label className="mb-4 block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--text2)]">
            Contraseña
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            autoComplete="current-password"
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2.5 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            placeholder="••••••••"
          />
        </label>
        {error ? <p className="mb-3 text-[12px] text-[var(--accent)]">{error}</p> : null}
        <button
          type="button"
          disabled={loading}
          onClick={() => void submit()}
          className="w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 disabled:opacity-50"
        >
          {loading ? 'Verificando…' : 'Ingresar'}
        </button>
      </div>
    </div>
  )
}
