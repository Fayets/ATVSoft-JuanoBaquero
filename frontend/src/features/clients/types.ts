export type CrmClient = {
  id: string
  lead_id: string
  full_name: string
  program_name: string
  program_duration_months: number | null
  start_date: string | null
  sale_status: 'abierto' | 'cerrado'
  lead_status: string
  wins: string[]
  notes: string
  progress_percent: number | null
  end_date: string | null
  months_elapsed: number | null
  tags: string[]
  is_complete: boolean
  missing_fields: string[]
  field_sources: Record<string, string>
  created_at: string
  updated_at: string | null
}

export const FIELD_SOURCE_LABELS: Record<string, string> = {
  'leads.nombre': 'Leads',
  'leads.programa_ofrecido': 'Leads (prog. comprado)',
  'leads.programada_ofrecido_llamada': 'Leads (prog. en llamada)',
  'leads.status': 'Leads (status)',
  'leads.pago': 'Leads (pago)',
  'leads.agendo': 'Leads (fecha agendo)',
  'leads.created_at': 'Leads (alta)',
  'leads.razon_compra': 'Wins del cliente',
  'programas.duration_months': 'Catálogo Programas',
  'programas.family_default': 'Premium/VIP (6 meses)',
  'cobranzas.primer_pago': 'Cobranzas (1er pago)',
  'call_report.program_offered': 'Reporte call',
  'call_report.razon_compra': 'Reporte call',
  'crm_client.manual': 'CRM (manual)',
  manual: 'Completar manual',
  'parsed.program_name': 'Detectado del nombre',
  'parsed.leads.programa_ofrecido': 'Detectado del programa',
  'parsed.leads.programada_ofrecido_llamada': 'Detectado del programa',
}

export type CrmClientTrackingGroup = {
  key: string
  label: string
  description: string
  clients: CrmClient[]
}

export type CrmClientTrackingResponse = {
  total_clients: number
  groups: CrmClientTrackingGroup[]
}

export const SALE_STATUS_OPTIONS = [
  { value: 'cerrado', label: 'Cerrado' },
  { value: 'abierto', label: 'Abierto' },
] as const

export const DURATION_PRESETS = [3, 6, 9, 12, 18, 24] as const

export const MISSING_FIELD_LABELS: Record<string, string> = {
  nombre: 'Nombre (completar en Leads)',
  programa: 'Programa (completar en Leads)',
  program_duration_months: 'Duración del programa',
  start_date: 'Fecha de inicio',
}
