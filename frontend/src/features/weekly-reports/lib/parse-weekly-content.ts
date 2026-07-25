export type WeeklyBlock =
  | { type: 'main-section'; title: string }
  | { type: 'subsection'; title: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; index: string; text: string }
  | { type: 'metrics-group'; items: { label: string; value: string }[] }
  | { type: 'paragraph'; text: string }
  | { type: 'spacer' }

const MAIN_SECTIONS = new Set([
  'RESUMEN EJECUTIVO',
  'METRICAS CONSOLIDADAS',
  'ANALISIS POR LLAMADA',
  'PATRONES DETECTADOS',
  'REPORTE CLOSER — CONSISTENCIA',
  'REPORTE CLOSER - CONSISTENCIA',
  'RECOMENDACIONES',
  'ALERTAS',
  'CONCLUSION',
  'FEEDBACK MARKETING',
])

const METRICS_SECTION = 'METRICAS CONSOLIDADAS'

const TABLE_HEADER_LABELS = new Set(['metrica', 'metric', 'valor', 'value', 'indicador'])

const SKIP_LINE_PREFIXES = ['reporte semanal de ventas', 'semana ']

function normalizeKey(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function stripMarkdown(line: string): string {
  let t = line.trim()
  t = t.replace(/^#{1,6}\s+/, '')
  t = t.replace(/\*\*(.+?)\*\*/g, '$1')
  t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
  t = t.replace(/`(.+?)`/g, '$1')
  t = t.replace(/^>\s+/, '')
  return t.replace(/\s{2,}/g, ' ').trim()
}

function shouldSkipLine(line: string): boolean {
  const key = normalizeKey(line)
  return SKIP_LINE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function parseTableRow(line: string): string | null {
  const trimmed = line.trim()
  if (!/^\|.+\|$/.test(trimmed)) return null

  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => stripMarkdown(c))
    .filter(Boolean)

  if (cells.length < 2) return null
  if (cells.every((c) => /^:?-+:?$/.test(c))) return null

  const head = cells[0].toLowerCase()
  if (TABLE_HEADER_LABELS.has(head) || TABLE_HEADER_LABELS.has(cells[1].toLowerCase())) {
    return null
  }

  return `${cells[0]}: ${cells.slice(1).join(' ')}`
}

function parseMetricLine(line: string): { label: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed.includes(':') || trimmed.startsWith('http')) return null

  const idx = trimmed.indexOf(':')
  const label = trimmed.slice(0, idx).trim()
  const value = trimmed.slice(idx + 1).trim()
  if (!label || !value || label.length >= 40) return null
  return { label, value }
}

function isMainSection(title: string): boolean {
  return MAIN_SECTIONS.has(normalizeKey(title))
}

function isSubsection(title: string, sectionKey: string | null): boolean {
  const t = title.trim()
  if (!t || t.startsWith('- ')) return false
  if (isMainSection(t)) return false
  if (sectionKey === METRICS_SECTION && parseMetricLine(t)) return false
  if (t.endsWith(':') && t.length < 80) return true
  if (t === t.toUpperCase() && t.length > 4 && t.includes(' ')) return true
  return false
}

export function sanitizeWeeklyContent(raw: string): string {
  if (!raw) return ''
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) {
      lines.push('')
      continue
    }
    if (/^-{3,}$/.test(t)) continue

    const tableMetric = parseTableRow(t)
    if (tableMetric) {
      lines.push(tableMetric)
      continue
    }
    if (t.startsWith('|') || t.endsWith('|')) continue

    const cleaned = stripMarkdown(t)
    if (cleaned && !shouldSkipLine(cleaned)) lines.push(cleaned)
  }
  return lines.join('\n').trim()
}

export function parseWeeklyContent(raw: string): WeeklyBlock[] {
  const text = sanitizeWeeklyContent(raw)
  if (!text) return [{ type: 'paragraph', text: 'Sin contenido.' }]

  const blocks: WeeklyBlock[] = []
  let sectionKey: string | null = null
  let metricsBuffer: { label: string; value: string }[] = []

  const flushMetrics = () => {
    if (metricsBuffer.length === 0) return
    blocks.push({ type: 'metrics-group', items: metricsBuffer })
    metricsBuffer = []
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      blocks.push({ type: 'spacer' })
      continue
    }

    if (isMainSection(trimmed)) {
      flushMetrics()
      sectionKey = normalizeKey(trimmed)
      blocks.push({ type: 'main-section', title: trimmed })
      continue
    }

    if (sectionKey === METRICS_SECTION) {
      const metric = parseMetricLine(trimmed)
      if (metric) {
        metricsBuffer.push(metric)
        continue
      }
      if (trimmed.startsWith('- ')) {
        flushMetrics()
        blocks.push({ type: 'bullet', text: trimmed.slice(2) })
        continue
      }
      flushMetrics()
      blocks.push({ type: 'paragraph', text: trimmed })
      continue
    }

    if (trimmed.startsWith('- ')) {
      blocks.push({ type: 'bullet', text: trimmed.slice(2) })
      continue
    }

    const numbered = /^(\d+)\.\s+(.+)$/.exec(trimmed)
    if (numbered) {
      blocks.push({ type: 'numbered', index: numbered[1], text: numbered[2] })
      continue
    }

    if (isSubsection(trimmed, sectionKey)) {
      blocks.push({ type: 'subsection', title: trimmed.replace(/:$/, '') })
      continue
    }

    blocks.push({ type: 'paragraph', text: trimmed })
  }

  flushMetrics()
  return blocks
}
