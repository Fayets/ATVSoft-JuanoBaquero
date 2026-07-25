import { apiFetch, backendAuthHeaders, formatApiDetail } from '@/lib/api'

const API_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

export type WeeklyReport = {
  id: number
  semana_inicio: string
  semana_fin: string
  contenido: string
  estado: 'pendiente' | 'generando' | 'listo' | 'error' | string
  error_msg: string
  llamadas_count: number
  closer_dias_count: number
  feedback_marketing?: string
  created_at: string
  updated_at: string | null
}

export type WeeklyPreview = {
  semana_inicio: string
  semana_fin: string
  llamadas_count: number
  closer_dias_count: number
  dias_seleccionados: number
}

export type WeeklyPeriod = {
  fecha_inicio: string
  fecha_fin: string
  dias: string[]
}

export async function getWeeklyReports(): Promise<WeeklyReport[]> {
  const res = await apiFetch('/weekly-reports')
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(formatApiDetail((raw as { detail?: unknown }).detail, 'Error al cargar reportes.'))
  }
  const list = (raw as { weekly_reports?: WeeklyReport[] }).weekly_reports
  return Array.isArray(list) ? list : []
}

export async function getWeeklyReport(id: number): Promise<WeeklyReport> {
  const res = await apiFetch(`/weekly-reports/${id}`)
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(formatApiDetail((raw as { detail?: unknown }).detail, 'Reporte no encontrado.'))
  }
  return raw as WeeklyReport
}

export async function previewWeeklyReport(period: WeeklyPeriod): Promise<WeeklyPreview> {
  const q = new URLSearchParams({
    fecha_inicio: period.fecha_inicio,
    fecha_fin: period.fecha_fin,
  })
  if (period.dias.length > 0) {
    q.set('dias', period.dias.join(','))
  }
  const res = await apiFetch(`/weekly-reports/preview?${q}`)
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo calcular la vista previa.'))
  }
  return raw as WeeklyPreview
}

export async function generateWeeklyReport(period: WeeklyPeriod): Promise<{ id: number; estado: string }> {
  const res = await apiFetch('/weekly-reports/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fecha_inicio: period.fecha_inicio,
      fecha_fin: period.fecha_fin,
      dias: period.dias.length > 0 ? period.dias : null,
    }),
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo generar el reporte.'))
  }
  return raw as { id: number; estado: string }
}

export function formatWeekRange(inicio: string, fin: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  return `${fmt(inicio)} – ${fmt(fin)}`
}

export function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}

export function mondayOfWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetweenInclusive(desde: string, hasta: string): string[] {
  if (!desde || !hasta || desde > hasta) return []
  const out: string[] = []
  let cur = desde
  while (cur <= hasta) {
    out.push(cur)
    cur = addDaysIso(cur, 1)
  }
  return out
}

export function defaultWeekPeriod(): WeeklyPeriod {
  const today = todayIso()
  const fecha_inicio = mondayOfWeek(today)
  const fecha_fin = addDaysIso(fecha_inicio, 6)
  return {
    fecha_inicio,
    fecha_fin,
    dias: daysBetweenInclusive(fecha_inicio, fecha_fin),
  }
}

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return DAY_LABELS[d.getDay()] ?? ''
}

export function dayNumber(iso: string): string {
  return iso.split('-')[2] ?? ''
}

export async function deleteWeeklyReport(id: number): Promise<void> {
  const res = await apiFetch(`/weekly-reports/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const raw = await res.json().catch(() => ({}))
    throw new Error(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo borrar el reporte.'))
  }
}

export async function downloadWeeklyReport(id: number): Promise<void> {
  const headers = backendAuthHeaders()
  const res = await fetch(`${API_BASE}/api/weekly-reports/${id}/download`, { headers })
  if (!res.ok) {
    const raw = await res.json().catch(() => ({}))
    throw new Error(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo descargar el PDF.'))
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const match = /filename="?([^";]+)"?/i.exec(cd)
  const name = match?.[1] || `reporte_semanal_${id}.pdf`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
