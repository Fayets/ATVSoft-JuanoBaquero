export const PAYMENT_CONCEPTOS = [
  'PIF',
  '1ra Cuota',
  '2da Cuota',
  '3ra Cuota',
  'Fee',
  'Otro',
] as const

export type PaymentConcepto = (typeof PAYMENT_CONCEPTOS)[number]

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
  pago: number
  /** null = deuda desconocida (sin precio de contrato) */
  debe: number | null
  precio_contrato?: number | null
  debe_desconocido?: boolean
  comprobante_url?: string | null
  total_pagado_historial: number
  cantidad_pagos: number
}

export type LeadPayment = {
  id: string
  lead_id: string
  monto: number
  fecha: string
  concepto: string
  nota: string
  comprobante_url?: string | null
  created_at: string
}

export type CobranzaPerfil = {
  lead: CobranzaLead
  pagos: LeadPayment[]
}

const CUOTA_SEQUENCE: PaymentConcepto[] = ['1ra Cuota', '2da Cuota', '3ra Cuota']

/** Sugiere la cuota siguiente según historial (PIF/cierres → 2da, etc.). */
export function suggestPaymentConcepto(pagos: Pick<LeadPayment, 'concepto'>[]): PaymentConcepto {
  const concepts = new Set(
    pagos.map((p) => (p.concepto || '').trim()).filter(Boolean) as PaymentConcepto[],
  )
  if (concepts.has('PIF')) return 'Otro'
  for (const step of CUOTA_SEQUENCE) {
    if (!concepts.has(step)) return step
  }
  return 'Otro'
}

/** Saldo pendiente cuando la deuda es conocida; null si debe es desconocido. */
export function debeRestante(
  lead: Pick<CobranzaLead, 'debe' | 'debe_desconocido' | 'total_pagado_historial'>,
): number | null {
  if (lead.debe_desconocido || lead.debe == null) return null
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
