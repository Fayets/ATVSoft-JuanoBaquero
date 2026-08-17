import { apiFetch } from '@/lib/api'
import { DEFAULT_DAILY_CLOSER } from '../constants'
import type { DailyCall, DailyCallsResponse, ManualCallInput } from '../types'

type ApiDailyCallRow = {
  id: number
  hora: string
  call?: string | null
  lead: string
  closer?: string
  triajer?: string
  setter?: string
  triaje_hecho?: boolean
  outbound?: boolean
  link_llamada?: string
  call_link?: string
  status: string
  payment?: number
  owed?: number
  program_offered?: string
  programada_ofrecido_llamada?: string
  calificacion_llamada?: string
}

function normalizeCalificacion(raw: string | undefined): DailyCall['calificacion_llamada'] {
  const val = (raw || '').trim().toLowerCase()
  if (val === 'calificado' || val === 'descalificado') return val
  return ''
}

export async function getTeamClosers(): Promise<string[]> {
  const res = await apiFetch('/team/members')
  const data = (await res.json().catch(() => ({}))) as {
    closers?: { nombre: string; activo?: boolean }[]
    detail?: string
  }
  if (!res.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudieron cargar los closers.')
  }
  const active = (m: { nombre: string; activo?: boolean }) =>
    m.activo !== false && String(m.nombre || '').trim()
  return [...new Set((data.closers ?? []).filter(active).map((m) => m.nombre.trim()))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
}

export async function getTeamTriajers(): Promise<string[]> {
  const res = await apiFetch('/team/members')
  const data = (await res.json().catch(() => ({}))) as {
    triajers?: { nombre: string; activo?: boolean }[]
    detail?: string
  }
  if (!res.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudieron cargar los triajers.')
  }
  const active = (m: { nombre: string; activo?: boolean }) =>
    m.activo !== false && String(m.nombre || '').trim()
  return [...new Set((data.triajers ?? []).filter(active).map((m) => m.nombre.trim()))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
}

export async function getTeamSetters(): Promise<string[]> {
  const res = await apiFetch('/team/members')
  const data = (await res.json().catch(() => ({}))) as {
    setters?: { nombre: string; activo?: boolean }[]
    detail?: string
  }
  if (!res.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudieron cargar los setters.')
  }
  const active = (m: { nombre: string; activo?: boolean }) =>
    m.activo !== false && String(m.nombre || '').trim()
  return [...new Set((data.setters ?? []).filter(active).map((m) => m.nombre.trim()))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
}

/** Usa solo un nombre que exista en el catálogo de Equipo. */
export function resolveDefaultCloser(closerNames: string[]): string {
  if (closerNames.length === 0) return ''
  const target = DEFAULT_DAILY_CLOSER.toLowerCase()
  const exact = closerNames.find((n) => n.toLowerCase() === target)
  if (exact) return exact
  const xander = closerNames.find((n) => {
    const low = n.toLowerCase()
    return low.includes('nick') && low.includes('xander')
  })
  if (xander) return xander
  return closerNames[0]
}

function foldCloserName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

function normalizeTeamCloser(closer: string, teamClosers: string[]): string | null {
  const needle = closer.trim()
  if (!needle) return null
  const exact = teamClosers.find((n) => n.trim().toLowerCase() === needle.toLowerCase())
  if (exact) return exact
  const folded = foldCloserName(needle)
  return teamClosers.find((n) => foldCloserName(n) === folded) ?? null
}

export async function getDailyCalls(
  teamClosers: string[],
  defaultCloser: string,
  fecha?: string,
): Promise<DailyCallsResponse> {
  void defaultCloser
  const q = fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''
  const res = await apiFetch(`/leads/llamadas-hoy${q}`)
  const raw = (await res.json().catch(() => ({}))) as DailyCallsResponse & {
    detail?: string
    llamadas?: ApiDailyCallRow[]
  }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudieron cargar las llamadas.')
  }

  const llamadas: DailyCall[] = []
  const patchCloser: { id: number; closer: string }[] = []

  for (const row of Array.isArray(raw.llamadas) ? raw.llamadas : []) {
    const closerRaw = (row.closer || '').trim()
    const fromTeam = normalizeTeamCloser(closerRaw, teamClosers)
    const effective = fromTeam ?? closerRaw
    // Solo persistir corrección de catálogo (acentos/alias). Nunca el closer default.
    if (fromTeam && fromTeam !== closerRaw) {
      patchCloser.push({ id: row.id, closer: fromTeam })
    }
    llamadas.push({
      id: row.id,
      hora: row.hora,
      call: row.call?.trim() || null,
      lead: row.lead,
      closer: effective,
      triajer: (row.triajer || '').trim(),
      setter: (row.setter || '').trim(),
      triaje_hecho: Boolean(row.triaje_hecho),
      outbound: Boolean(row.outbound),
      call_link: row.link_llamada || row.call_link || '',
      status: row.status,
      calificacion_llamada: normalizeCalificacion(row.calificacion_llamada),
      program_offered: (row.program_offered || '').trim(),
      programada_ofrecido_llamada: (row.programada_ofrecido_llamada || '').trim(),
      payment: Number(row.payment) || 0,
      owed: Number(row.owed) || 0,
    })
  }

  // No bloquear la carga del panel: persistir closers por defecto en background.
  if (patchCloser.length > 0) {
    void Promise.all(
      patchCloser.map(({ id, closer }) => patchLeadCloser(id, closer).catch(() => undefined)),
    )
  }

  return { fecha: raw.fecha || '', llamadas }
}

export async function createManualCall(input: ManualCallInput): Promise<void> {
  const res = await apiFetch('/leads/manual-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: input.client_name.trim(),
      closer: input.closer.trim(),
      hora: input.hora.trim(),
      fecha: input.fecha?.trim() || undefined,
      ig_handle: input.ig_handle?.trim() || null,
    }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo agregar la llamada.'
    throw new Error(detail)
  }
}

export async function patchLeadCalificacion(
  leadId: number,
  calificacion: DailyCall['calificacion_llamada'],
): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calificacion_llamada: calificacion || '' }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo guardar la calificación.'
    throw new Error(detail)
  }
}

export async function patchLeadStatus(leadId: number, status: string): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo actualizar el status.'
    throw new Error(detail)
  }
}

export async function patchLeadCloser(leadId: number, closer: string): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closer: closer.trim() }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo actualizar el closer.'
    throw new Error(detail)
  }
}

export async function patchLeadTriajer(leadId: number, triajer: string): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triajer: triajer.trim() }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo actualizar el triajer.'
    throw new Error(detail)
  }
}

export async function patchLeadSetter(leadId: number, setter: string): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setter: setter.trim() }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo actualizar el setter.'
    throw new Error(detail)
  }
}

export async function patchLeadTriajeHecho(leadId: number, triajeHecho: boolean): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triaje_hecho: triajeHecho }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo actualizar el triaje.'
    throw new Error(detail)
  }
}

export async function patchLeadOutbound(leadId: number, outbound: boolean): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outbound }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo actualizar outbound.'
    throw new Error(detail)
  }
}

/** Asigna triajer a todas las llamadas del día sin uno. */
export async function assignTriajersForDay(fecha: string): Promise<{
  assigned: number
  pending: number
}> {
  const q = new URLSearchParams({ fecha })
  const res = await apiFetch(`/leads/asignar-triajers-dia?${q}`, { method: 'POST' })
  const raw = (await res.json().catch(() => ({}))) as {
    detail?: string
    assigned?: number
    pending?: number
  }
  if (!res.ok) {
    throw new Error(
      typeof raw.detail === 'string' ? raw.detail : 'No se pudieron asignar triajers.',
    )
  }
  return {
    assigned: Number(raw.assigned) || 0,
    pending: Number(raw.pending) || 0,
  }
}

export async function patchLeadCallLink(leadId: number, callLink: string | null): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_link: callLink ?? '' }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo guardar el link.'
    throw new Error(detail)
  }
}

export async function getProgramOptions(): Promise<string[]> {
  const res = await apiFetch('/programs')
  const data = (await res.json().catch(() => ({}))) as {
    programs?: { name: string }[]
    detail?: string
  }
  if (!res.ok) {
    return ['']
  }
  const names = [...new Set((data.programs ?? []).map((p) => String(p.name || '').trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'es'),
  )
  return ['', ...names]
}

export async function patchLeadPayment(leadId: number, payment: number): Promise<void> {
  const amount = Number.isFinite(payment) ? Math.max(0, payment) : 0
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment: amount }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo guardar el pago.'
    throw new Error(detail)
  }
}

export async function patchLeadOwed(leadId: number, owed: number): Promise<void> {
  const amount = Number.isFinite(owed) ? Math.max(0, owed) : 0
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owed: amount }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo guardar el debe.'
    throw new Error(detail)
  }
}

export async function patchLeadProgramOffered(leadId: number, program: string): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ program_offered: program }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo guardar el programa comprado.'
    throw new Error(detail)
  }
}

export async function patchLeadProgramadaOfrecido(
  leadId: number,
  program: string,
): Promise<void> {
  const res = await apiFetch(`/leads/${encodeURIComponent(String(leadId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ programada_ofrecido_llamada: program }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo guardar el programa ofrecido.'
    throw new Error(detail)
  }
}

export function buildCloserOptions(closerNames: string[]): string[] {
  return [...new Set(closerNames.map((n) => n.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
}

export async function generateCloserReportsForDay(fecha: string): Promise<{
  generated: number
  discord_sent: boolean
}> {
  const q = new URLSearchParams({ fecha })
  const res = await apiFetch(`/team/closer-reports/generate-day?${q}`, { method: 'POST' })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudo generar el reporte del día.'
    throw new Error(detail)
  }
  const data = raw as { generated?: number; discord_sent?: boolean }
  return {
    generated: Number(data.generated) || 0,
    discord_sent: Boolean(data.discord_sent),
  }
}

/** Sync GHL solo del día indicado (sincrónico). */
export async function syncGhlForDay(fecha: string): Promise<{ created: number; updated: number }> {
  const q = new URLSearchParams({ fecha })
  const res = await apiFetch(`/ghl/sync?${q}`, { method: 'POST' })
  const raw = (await res.json().catch(() => ({}))) as {
    detail?: string
    created?: number
    updated?: number
  }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo sincronizar GHL.')
  }
  return {
    created: Number(raw.created) || 0,
    updated: Number(raw.updated) || 0,
  }
}

export type RefrescarClosersResult = {
  revisadas: number
  actualizadas: number
  sin_cambio: number
  api_error: number
  detalle: Array<{
    lead_id: number
    nombre: string
    antes: string
    despues: string
  }>
  desde: string
  hasta: string
}

/** Refresca closer/closer_norm desde GHL (solo leads con ghl_appointment_id). */
export async function refrescarClosersFromGhl(
  desde?: string,
  hasta?: string,
): Promise<RefrescarClosersResult> {
  const q = new URLSearchParams()
  if (desde) q.set('desde', desde)
  if (hasta) q.set('hasta', hasta)
  const suffix = q.toString() ? `?${q}` : ''
  const res = await apiFetch(`/ghl/refrescar-closers${suffix}`, { method: 'POST' })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : 'No se pudieron refrescar los closers desde GHL.'
    throw new Error(detail)
  }
  return raw as RefrescarClosersResult
}
