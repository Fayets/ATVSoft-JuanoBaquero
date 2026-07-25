'use client'

import { login } from '@/features/auth/services/auth-service'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const username = String(formData.get('username') || '')
    const password = String(formData.get('password') || '')
    const result = await login(username, password)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    router.replace('/panel-diario')
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg border border-[var(--red-dark)] bg-[rgba(230,57,70,0.08)] px-4 py-3 text-sm text-[var(--red-light)]">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="username" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Usuario
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoComplete="username"
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
          placeholder="tu_usuario"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Contrasena
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={6}
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
          placeholder="Minimo 6 caracteres"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-all hover:opacity-90 hover:-translate-y-0.5 disabled:opacity-30 disabled:cursor-not-allowed disabled:translate-y-0"
      >
        {pending ? 'Cargando...' : 'Iniciar sesion'}
      </button>

    </form>
  )
}
