'use client'

import { signup } from '@/features/auth/services/auth-service'
import Link from 'next/link'
import { FormEvent, useState } from 'react'

export function SignupForm() {
  const [state, setState] = useState<{ error?: string }>({})
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    const result = await signup()
    setState(result)
    setPending(false)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {state.error && (
        <div className="rounded-lg border border-[var(--red-dark)] bg-[rgba(230,57,70,0.08)] px-4 py-3 text-sm text-[var(--red-light)]">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="fullName" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Nombre completo
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          disabled
          autoComplete="name"
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
          placeholder="Tu nombre"
        />
      </div>

      <div>
        <label htmlFor="email" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          disabled
          autoComplete="email"
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
          placeholder="tu@email.com"
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
          disabled
          autoComplete="new-password"
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
        {pending ? 'Verificando...' : 'Registro solo por Swagger'}
      </button>

      <p className="text-center text-sm text-[var(--text3)]">
        Ya tenes cuenta?{' '}
        <Link href="/login" className="text-[var(--accent)] hover:underline">
          Iniciar sesion
        </Link>
      </p>
    </form>
  )
}
