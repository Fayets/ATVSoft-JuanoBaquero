'use client'

import { ChangePasswordForm } from '@/features/auth/components/change-password-form'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

function capitalizeFirstLetter(label: string): string {
  if (!label) return label
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export default function CuentaPage() {
  const { username, ready } = useAuthUser()
  const trimmed = username?.trim() || ''
  const displayName = !ready ? '…' : trimmed ? capitalizeFirstLetter(trimmed) : 'Usuario'

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">Mi cuenta</h2>
        <p className="mt-2 text-[13px] text-[var(--text3)]">
          Gestioná la seguridad de tu sesión. Usuario actual:{' '}
          <span className="font-medium text-[var(--text2)]">{displayName}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]">
        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
          Cambiar contraseña
        </h3>
        <p className="mb-6 text-[12px] text-[var(--text3)]">
          Ingresá tu contraseña actual y elegí una nueva. La próxima vez que inicies sesión vas a usar la nueva.
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  )
}
