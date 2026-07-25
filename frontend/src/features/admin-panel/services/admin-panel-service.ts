import { apiFetch } from '@/lib/api'
import type { DailyCall, DailyCallsResponse, ManualCallInput } from '@/features/daily-panel/types'

const TOKEN_KEY = 'atvmkt_admin_panel_token'

type ApiDailyCallRow = {
  id: number
  hora: string
  call?: string | null
  lead: string
  closer?: string
  link_llamada?: string
  call_link?: string
  status: string
  payment?: number
  owed?: number
  program_offered?: string
  programada_ofrecido_llamada?: string
  calificacion_llamada?: string
}

function adminHeaders(token: string): HeadersInit {
  return { 'X-Admin-Panel-Token': token }
}

function normalizeCalificacion(raw: string | undefined): DailyCall['calificacion_llamada'] {
  const val = (raw || '').trim().toLowerCase()
  if (val === 'calificado' || val === 'descalificado') return val
  return ''
}

export function readAdminPanelToken(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(TOKEN_KEY)
}

export function writeAdminPanelToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearAdminPanelToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function unlockAdminPanel(password: string): Promise<string> {
  const res = await apiFetch('/admin/panel/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'Contraseña incorrecta.'
    throw new Error(detail)
  }
  const token = String((raw as { token?: string }).token || '')
  if (!token) throw new Error('No se recibió token de acceso.')
  writeAdminPanelToken(token)
  return token
}

export async function getAdminDailyCalls(
  fecha: string,
  token: string,
  teamClosers: string[],
  defaultCloser: string,
): Promise<DailyCallsResponse> {
  const q = new URLSearchParams({ fecha })
  const res = await apiFetch(`/admin/panel/llamadas?${q}`, {
    headers: adminHeaders(token),
  })
  const raw = (await res.json().catch(() => ({}))) as DailyCallsResponse & {
    detail?: string
    llamadas?: ApiDailyCallRow[]
  }
  if (res.status === 403) {
    clearAdminPanelToken()
    throw new Error('Sesión admin expirada. Volvé a ingresar la contraseña.')
  }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudieron cargar las llamadas.')
  }

  const llamadas: DailyCall[] = (Array.isArray(raw.llamadas) ? raw.llamadas : []).map((row) => {
    const closerRaw = (row.closer || '').trim()
    const fromTeam = teamClosers.find((n) => n.trim().toLowerCase() === closerRaw.toLowerCase())
    const effective = fromTeam ?? defaultCloser
    return {
      id: row.id,
      hora: row.hora,
      call: row.call?.trim() || null,
      lead: row.lead,
      closer: effective,
      call_link: row.link_llamada || row.call_link || '',
      status: row.status,
      calificacion_llamada: normalizeCalificacion(row.calificacion_llamada),
      program_offered: (row.program_offered || '').trim(),
      programada_ofrecido_llamada: (row.programada_ofrecido_llamada || '').trim(),
      payment: Number(row.payment) || 0,
      owed: Number(row.owed) || 0,
    }
  })

  return { fecha: raw.fecha || fecha, llamadas }
}

export async function createAdminManualCall(
  fecha: string,
  token: string,
  input: ManualCallInput,
): Promise<void> {
  const res = await apiFetch('/admin/panel/manual-call', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...adminHeaders(token),
    },
    body: JSON.stringify({
      client_name: input.client_name.trim(),
      closer: input.closer.trim(),
      hora: input.hora.trim(),
      fecha,
      ig_handle: input.ig_handle?.trim() || null,
    }),
  })
  const raw = await res.json().catch(() => ({}))
  if (res.status === 403) {
    clearAdminPanelToken()
    throw new Error('Sesión admin expirada.')
  }
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo agregar la llamada.'
    throw new Error(detail)
  }
}

export async function verifyAdminPanelToken(token: string, fecha: string): Promise<boolean> {
  const q = new URLSearchParams({ fecha })
  const res = await apiFetch(`/admin/panel/llamadas?${q}`, {
    headers: adminHeaders(token),
  })
  if (res.status === 403) {
    clearAdminPanelToken()
    return false
  }
  return res.ok
}
