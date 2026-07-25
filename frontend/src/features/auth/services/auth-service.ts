'use client'

import { z } from 'zod'

const loginSchema = z.object({
  username: z.string().min(1, 'Usuario requerido'),
  password: z.string().min(6, 'Minimo 6 caracteres'),
})

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresa tu contraseña actual'),
    newPassword: z.string().min(6, 'Minimo 6 caracteres'),
    confirmPassword: z.string().min(1, 'Confirma la nueva contraseña'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })

export type AuthResult = {
  error?: string
  ok?: boolean
}

const BACKEND_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

type LoginResponseBody = {
  detail?: string
  access_token?: string
  user_id?: number
}

function persistSession(token: string, userIdFromServer?: number) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem('access_token', token)
  sessionStorage.setItem('evoluciona_token', token)
  sessionStorage.setItem('auth_token', token)

  if (userIdFromServer != null && Number.isFinite(userIdFromServer)) {
    const id = String(userIdFromServer)
    localStorage.setItem('auth_user_id', id)
    sessionStorage.setItem('auth_user_id', id)
    sessionStorage.setItem('user_id', id)
    sessionStorage.setItem('evoluciona_user_id', id)
  }

  window.dispatchEvent(new Event('auth-session-changed'))
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const parsed = loginSchema.safeParse({ username, password })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const response = await fetch(`${BACKEND_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  })
  const data = (await response.json().catch(() => null)) as LoginResponseBody | null

  if (!response.ok) {
    return { error: data?.detail || 'No se pudo iniciar sesion' }
  }

  const token = data?.access_token
  if (!token) return { error: 'Respuesta invalida del servidor' }

  const uid = data?.user_id
  if (typeof uid !== 'number' || !Number.isFinite(uid)) {
    return { error: 'Respuesta invalida del servidor (falta user_id)' }
  }

  persistSession(token, uid)
  return { ok: true }
}

export async function signup(): Promise<AuthResult> {
  return { error: 'Registro deshabilitado. Crear usuarios desde Swagger /auth/register.' }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<AuthResult> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword,
    newPassword,
    confirmPassword,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const token =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('evoluciona_token') ||
        sessionStorage.getItem('access_token') ||
        sessionStorage.getItem('auth_token')
      : null

  if (!token) {
    return { error: 'Sesion expirada. Inicia sesion de nuevo.' }
  }

  const response = await fetch(`${BACKEND_BASE}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      current_password: parsed.data.currentPassword,
      new_password: parsed.data.newPassword,
    }),
  })
  const data = (await response.json().catch(() => null)) as { detail?: string } | null

  if (!response.ok) {
    return { error: data?.detail || 'No se pudo cambiar la contraseña' }
  }

  return { ok: true }
}

export async function logout() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem('access_token')
  sessionStorage.removeItem('evoluciona_token')
  sessionStorage.removeItem('token')
  sessionStorage.removeItem('auth_token')
  sessionStorage.removeItem('user_id')
  sessionStorage.removeItem('evoluciona_user_id')
  sessionStorage.removeItem('auth_user_id')
  localStorage.removeItem('auth_user_id')
  window.dispatchEvent(new Event('auth-session-changed'))
}
