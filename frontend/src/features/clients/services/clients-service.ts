import { apiFetch, formatApiDetail } from '@/lib/api'
import type { CrmClient, CrmClientTrackingResponse } from '../types'

async function parseJson(res: Response) {
  return res.json().catch(() => ({}))
}

export async function fetchClients(): Promise<{ clients: CrmClient[]; error?: string }> {
  const res = await apiFetch('/clients')
  const data = await parseJson(res)
  if (!res.ok) {
    return { clients: [], error: formatApiDetail((data as { detail?: unknown }).detail) }
  }
  return { clients: (data as { clients?: CrmClient[] }).clients ?? [] }
}

export async function fetchClientsTracking(): Promise<{ data: CrmClientTrackingResponse | null; error?: string }> {
  const res = await apiFetch('/clients/tracking')
  const data = await parseJson(res)
  if (!res.ok) {
    return { data: null, error: formatApiDetail((data as { detail?: unknown }).detail) }
  }
  return { data: data as CrmClientTrackingResponse }
}

export type ClientCrmPayload = {
  full_name?: string
  program_name?: string
  program_duration_months?: number | null
  start_date?: string | null
  sale_status?: string
  wins?: string[]
  notes?: string
}

export async function upsertClientCrm(
  leadId: string,
  payload: ClientCrmPayload,
): Promise<{ client?: CrmClient; error?: string }> {
  const res = await apiFetch('/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lead_id: Number(leadId), ...payload }),
  })
  const data = await parseJson(res)
  if (!res.ok) {
    return { error: formatApiDetail((data as { detail?: unknown }).detail) }
  }
  return { client: data as CrmClient }
}

export async function patchClientCrm(
  leadId: string,
  payload: ClientCrmPayload,
): Promise<{ client?: CrmClient; error?: string }> {
  const res = await apiFetch(`/clients/${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJson(res)
  if (!res.ok) {
    return { error: formatApiDetail((data as { detail?: unknown }).detail) }
  }
  return { client: data as CrmClient }
}
