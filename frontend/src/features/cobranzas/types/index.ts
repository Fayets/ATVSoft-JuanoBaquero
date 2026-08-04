export type CobranzaLead = {
  id: string
  nombre: string
  ig: string
  telefono: string
  email: string
  avatar: string
  status: string
  closer: string
  setter: string
  programa_ofrecido: string
  /** Referencia de tabla leads (solo lectura) */
  pago: number
  debe: number
  comprobante_url?: string | null
  total_pagado_historial: number
  cantidad_pagos: number
}

export type LeadPayment = {
  id: string
  lead_id: string
  monto: number
  fecha: string
  nota: string
  comprobante_url?: string | null
  created_at: string
}

export type CobranzaPerfil = {
  lead: CobranzaLead
  pagos: LeadPayment[]
}

/** Saldo pendiente en cobranzas: Debe (Leads) − cuotas del historial. No muta la tabla leads. */
export function debeRestante(lead: Pick<CobranzaLead, 'debe' | 'total_pagado_historial'>): number {
  const debe = Number(lead.debe) || 0
  const hist = Number(lead.total_pagado_historial) || 0
  return Math.max(0, debe - hist)
}

export function formatUsd(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n || 0)
}

export function formatIsoDateToDdMmYyyy(raw: string | null | undefined): string {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return '—'
  const head = s.includes('T') ? s.split('T')[0] : s.split(' ')[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return s
  const [y, mo, d] = head.split('-').map(Number)
  if (!y || !mo || !d) return s
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
}

export function todayIsoLocal(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
