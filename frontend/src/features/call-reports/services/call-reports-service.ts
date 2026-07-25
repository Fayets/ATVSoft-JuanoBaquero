import { apiFetch, backendAuthHeaders } from '@/lib/api'
import type { CallReport, ClaudeApiStatus, FathomApiStatus } from '../types'

const API_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

type ListResponse = {
  call_reports?: CallReport[]
}

export async function getCallReports(): Promise<CallReport[]> {
  const res = await apiFetch('/call-reports')
  const raw = (await res.json().catch(() => ({}))) as ListResponse & { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudieron cargar los reportes.')
  }
  return Array.isArray(raw.call_reports) ? raw.call_reports : []
}

export async function getClaudeApiStatus(): Promise<ClaudeApiStatus> {
  const res = await apiFetch('/call-reports/claude-status')
  const raw = (await res.json().catch(() => ({}))) as ClaudeApiStatus & { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo verificar Claude.')
  }
  return {
    status: raw.status || 'unavailable',
    message: raw.message || 'Estado desconocido.',
    api_key_masked: raw.api_key_masked ?? null,
  }
}

export async function getFathomApiStatus(): Promise<FathomApiStatus> {
  const res = await apiFetch('/call-reports/fathom-status')
  const raw = (await res.json().catch(() => ({}))) as FathomApiStatus & { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo verificar Fathom.')
  }
  return {
    status: raw.status || 'unavailable',
    message: raw.message || 'Estado desconocido.',
    api_key_masked: raw.api_key_masked ?? null,
  }
}

export async function reanalyzeCallReport(id: string): Promise<void> {
  const res = await apiFetch(`/call-reports/${encodeURIComponent(id)}/reanalyze`, {
    method: 'POST',
  })
  const raw = (await res.json().catch(() => ({}))) as { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo reintentar el análisis.')
  }
}

export async function sendCallReportToDiscord(id: string): Promise<void> {
  const res = await apiFetch(`/call-reports/${encodeURIComponent(id)}/discord`, {
    method: 'POST',
  })
  const raw = (await res.json().catch(() => ({}))) as { detail?: string; sent?: boolean }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo enviar a Discord.')
  }
}

export async function getCallReport(id: string): Promise<CallReport> {
  const res = await apiFetch(`/call-reports/${encodeURIComponent(id)}`)
  const raw = (await res.json().catch(() => ({}))) as CallReport & { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'Reporte no encontrado.')
  }
  return raw as CallReport
}

export async function deleteCallReport(id: string): Promise<void> {
  const res = await apiFetch(`/call-reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const raw = (await res.json().catch(() => ({}))) as { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo eliminar el reporte.')
  }
}

export async function bulkDeleteCallReports(ids: string[]): Promise<number> {
  const res = await apiFetch('/call-reports/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids.map((id) => Number(id)).filter((n) => Number.isFinite(n)) }),
  })
  const raw = (await res.json().catch(() => ({}))) as { deleted?: number; detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudieron eliminar los reportes.')
  }
  return typeof raw.deleted === 'number' ? raw.deleted : 0
}

async function downloadBlob(path: string, init?: RequestInit, fallbackName = 'reporte'): Promise<void> {
  const headers = backendAuthHeaders(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(`${API_BASE}/api${normalizedPath}`, { ...init, headers })
  if (!res.ok) {
    const raw = (await res.json().catch(() => ({}))) as { detail?: string }
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo descargar.')
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
  const name = decodeURIComponent(match?.[1] || match?.[2] || fallbackName)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadCallReport(id: string): Promise<void> {
  await downloadBlob(
    `/call-reports/${encodeURIComponent(id)}/download`,
    { method: 'GET' },
    'reporte_(Sin nombre).pdf',
  )
}

export async function bulkDownloadCallReports(ids: string[]): Promise<void> {
  await downloadBlob(
    `/call-reports/bulk-download`,
    {
      method: 'POST',
      body: JSON.stringify({ ids: ids.map((id) => Number(id)).filter((n) => Number.isFinite(n)) }),
    },
    'reporte_(Sin nombre).pdf',
  )
}
