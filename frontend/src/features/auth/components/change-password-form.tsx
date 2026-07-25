'use client'

import { changePassword } from '@/features/auth/services/auth-service'
import { FormEvent, useState } from 'react'

export function ChangePasswordForm() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setPending(true)

    const formData = new FormData(event.currentTarget)
    const currentPassword = String(formData.get('currentPassword') || '')
    const newPassword = String(formData.get('newPassword') || '')
    const confirmPassword = String(formData.get('confirmPassword') || '')

    const result = await changePassword(currentPassword, newPassword, confirmPassword)
    setPending(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setSuccess('Contraseña actualizada correctamente.')
    event.currentTarget.reset()
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-5">
      {error && (
        <div className="rounded-lg border border-[var(--red-dark)] bg-[rgba(230,57,70,0.08)] px-4 py-3 text-sm text-[var(--red-light)]">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-faint)] px-4 py-3 text-sm text-[var(--text)]">
          {success}
        </div>
      )}

      <div>
        <label
          htmlFor="currentPassword"
          className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]"
        >
          Contraseña actual
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
        />
      </div>

      <div>
        <label
          htmlFor="newPassword"
          className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]"
        >
          Nueva contraseña
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          autoComplete="new-password"
          minLength={6}
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
          placeholder="Minimo 6 caracteres"
        />
      </div>

      <div>
        <label
          htmlFor="confirmPassword"
          className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]"
        >
          Confirmar nueva contraseña
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          minLength={6}
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-all hover:opacity-90 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-30 disabled:translate-y-0"
      >
        {pending ? 'Guardando...' : 'Cambiar contraseña'}
      </button>
    </form>
  )
}
