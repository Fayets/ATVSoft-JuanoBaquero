export function getMonthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = new Date(year, m - 1, 1).toISOString()
  const end = new Date(year, m, 0, 23, 59, 59).toISOString()
  return { start, end }
}

/** Convierte `YYYY-MM-DD` o prefijo ISO con hora a `dd-mm-aaaa` para mostrar en UI. */
export function formatIsoDateDdMmYyyy(iso: string): string {
  const s = String(iso).trim()
  if (!s) return iso
  const head = s.includes('T') ? s.split('T')[0]! : s.split(' ')[0]!
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head)
  if (!m) return iso
  return `${m[3]}-${m[2]}-${m[1]}`
}

export function formatCash(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR')
}

/** Eje compacto de gráficos ($1k, $500, …). */
export function formatCashAxisShort(v: string | number): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return formatCash(0)
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`
  return formatCash(n)
}

export function formatK(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return n.toLocaleString()
}

/** Entero con separadores de miles (es-AR), sin abreviar en K/M — útil para visitas/comentarios exactos. */
export function formatIntegerEsAr(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString('es-AR')
}
