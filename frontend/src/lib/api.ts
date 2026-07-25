const API_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

const BACKEND_USER_ID_KEYS = ['auth_user_id', 'user_id', 'evoluciona_user_id'] as const

/** ID numérico de AuthUser (FastAPI / Pony). Prioriza localStorage. */
export function readBackendUserId(): string | null {
  if (typeof window === 'undefined') return null
  for (const key of BACKEND_USER_ID_KEYS) {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key)
    const v = raw?.trim()
    if (v && /^\d+$/.test(v)) return v
  }
  return null
}

function readSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  return (
    sessionStorage.getItem('evoluciona_token') ||
    sessionStorage.getItem('access_token') ||
    sessionStorage.getItem('token') ||
    sessionStorage.getItem('auth_token')
  )
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

function readUserIdFromSession(token: string | null): string | null {
  const fromStorage = readBackendUserId()
  if (fromStorage) return fromStorage
  if (!token) return null
  const payload = decodeJwtPayload(token)
  const uid = payload?.user_id
  if (typeof uid === 'number' && Number.isFinite(uid)) return String(uid)
  if (typeof uid === 'string' && /^\d+$/.test(uid.trim())) return uid.trim()
  return null
}

/** Mismo user id que envía `apiFetch` (storage + JWT). */
export function resolveBackendUserId(): string | null {
  return readUserIdFromSession(readSessionToken())
}

/** Username del JWT (`sub`, coincide con login en FastAPI). */
export function resolveSessionUsername(): string | null {
  if (typeof window === 'undefined') return null
  const token = readSessionToken()
  if (!token) return null
  const payload = decodeJwtPayload(token)
  const sub = payload?.sub
  if (typeof sub === 'string' && sub.trim()) return sub.trim()
  return null
}

/**
 * Headers para fetch directo al backend (p. ej. `/api-backend/conexiones`).
 * Incluye `Authorization: Bearer` y `X-User-Id` cuando hay sesión de login.
 */
export function backendAuthHeaders(init?: HeadersInit): Headers {
  const token = readSessionToken()
  const userId = readUserIdFromSession(token)
  const headers = new Headers(init ?? undefined)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (userId && !headers.has('X-User-Id')) {
    headers.set('X-User-Id', userId)
  }
  return headers
}

export function formatApiDetail(detail: unknown, fallback = 'Error en la solicitud'): string {
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: unknown }).msg)
        return ''
      })
      .filter(Boolean)
    if (parts.length) return parts.join('. ')
  }
  return fallback
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = readSessionToken()
  const userId = readUserIdFromSession(token)
  const headers = new Headers(init?.headers || {})
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (userId && !headers.has('X-User-Id')) {
    headers.set('X-User-Id', userId)
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${API_BASE}/api${normalizedPath}`
  return fetch(url, { ...init, headers })
}
