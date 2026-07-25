'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash, formatCashAxisShort, formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { resolveMediaUrl } from '@/shared/lib/backend-public-url'
import { Bar, Line } from '@/shared/components/charts'
import {
  getLeadsAnalytics,
  monthRangeIso,
  type FunnelLeadStep,
} from '@/features/leads/services/leads-analytics'
import type { VDData } from '@/features/sales-dashboard/sales-dashboard-vd'
import { Modal } from '@/shared/components/modal'
import { apiFetch } from '@/lib/api'

function fP(v: number) { return v.toFixed(1) + '%' }
function fPOrDash(v: number) {
  if (!Number.isFinite(v) || Number.isNaN(v)) return '—'
  return fP(v)
}
function fN(v: number) { return Math.round(v).toLocaleString('es-AR') }
function pct(o: number, n: number) { if (o === 0) return n > 0 ? 100 : 0; return ((n - o) / Math.abs(o)) * 100 }

export function SalesDashboardPage() {
  const { month, options, setMonth } = useMonthContext()
  const { ready, userId } = useAuthUser()
  const [tab, setTab] = useState<'mensual' | 'semanal' | 'diario'>('mensual')
  const [semana, setSemana] = useState(0)
  const [curr, setCurr] = useState<VDData | null>(null)
  const [prev, setPrev] = useState<VDData | null>(null)
  const [loading, setLoading] = useState(true)

  const buildVD = useCallback(async (m: string): Promise<VDData> => {
    const { analytics } = await getLeadsAnalytics(m)
    return {
      ...analytics,
      chats: analytics.chats,
      chatsStories: analytics.chatsStories,
      chatsReels: analytics.chatsReels,
      agendasByWeek: analytics.byWeek.agendas,
      conversacionesByWeek: analytics.byWeek.conversaciones,
      showsByWeek: analytics.byWeek.shows,
      cierresByWeek: analytics.byWeek.cierres,
      ingresosByWeek: analytics.byWeek.ingresos,
      noShowsByWeek: analytics.byWeek.noShows,
    }
  }, [])

  const fetchData = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setCurr(null)
      setPrev(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const prevMonth = `${new Date(y, m - 2, 1).getFullYear()}-${String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0')}`
    try {
      const [c, p] = await Promise.all([buildVD(month), buildVD(prevMonth)])
      setCurr(c)
      setPrev(p)
    } finally {
      setLoading(false)
    }
  }, [month, ready, userId, buildVD])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    const refresh = () => {
      void fetchData()
    }
    window.addEventListener('atvmkt-team-reports-changed', refresh)
    window.addEventListener('offered-programs-updated', refresh)
    return () => {
      window.removeEventListener('atvmkt-team-reports-changed', refresh)
      window.removeEventListener('offered-programs-updated', refresh)
    }
  }, [fetchData])

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  if (!userId) {
    return <div className="py-12 text-center text-[var(--text3)]">Iniciá sesión para ver el panel de ventas.</div>
  }

  if (!curr || !prev) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  const delta = (key: keyof VDData) => pct(prev[key] as number, curr[key] as number)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Dashboard <span className="text-[var(--text2)]">de Ventas</span></h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      {/* Tabs */}
      <div className="segment-group mb-6 w-fit">
        {(['mensual', 'semanal', 'diario'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`segment-tab capitalize ${tab === t ? 'segment-tab-active font-semibold' : ''}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'mensual' && <MensualView curr={curr} prev={prev} delta={delta} month={month} />}
      {tab === 'semanal' && <SemanalView curr={curr} />}
      {tab === 'diario' && <DiarioView curr={curr} semana={semana} setSemana={setSemana} />}
    </div>
  )
}

// ── KPI Component ──
type MonthlyMetricId =
  | 'cash'
  | 'conversaciones'
  | 'agendas'
  | 'noShows'
  | 'showUpRate'
  | 'closeRate'
  | 'tasaAgendamiento'
  | 'aov'
  | 'cashPorAgenda'
  | 'cashPorShow'

type MetricExplanation = {
  title: string
  result: string
  formula: string
  data: { label: string; value: string }[]
  source: string
}

function getMetricExplanation(id: MonthlyMetricId, d: VDData): MetricExplanation {
  switch (id) {
    case 'cash':
      return {
        title: 'Cash del mes',
        result: formatCash(d.ingresos),
        formula: 'Cash collected = Pagó en leads + seguimiento del mes.',
        data: [
          { label: 'Pago (columna Pagó en leads)', value: formatCash(d.cashCollectedComposition.pago) },
          { label: 'Seguimiento (formularios)', value: formatCash(d.cashCollectedComposition.seguimiento) },
          { label: 'Total cash del mes', value: formatCash(d.ingresos) },
        ],
        source: 'Fuente: leads del mes (/leads) + reportes de seguimiento (/team/seguimiento-reports/month).',
      }
    case 'conversaciones':
      return {
        title: 'Conversaciones',
        result: fN(d.conversaciones),
        formula: 'Suma de conversaciones en reportes diarios del setter del mes.',
        data: [
          { label: 'Historias', value: fN(d.conversacionesStories) },
          { label: 'Reels', value: fN(d.conversacionesReels) },
          { label: 'Total conversaciones', value: fN(d.conversaciones) },
        ],
        source: 'Fuente: reportes setter (/team/reports) — campo conversaciones (Historias + Reels).',
      }
    case 'agendas':
      return {
        title: 'Agendas',
        result: fN(d.agendas),
        formula: 'Suma de agendas en reportes diarios del setter del mes.',
        data: [
          { label: 'Historias', value: fN(d.agendasStories) },
          { label: 'Reels', value: fN(d.agendasReels) },
          { label: 'Ads', value: fN(d.agendasAds) },
          { label: 'Total agendas', value: fN(d.agendas) },
        ],
        source: 'Fuente: reportes setter (/team/reports) — llamadas agendadas por canal.',
      }
    case 'noShows':
      return {
        title: 'No Shows',
        result: fN(d.noShows),
        formula: 'max(0, Agendas − Shows). Agendas del setter menos shows del closer.',
        data: [
          { label: 'Agendas (setter)', value: fN(d.agendas) },
          { label: 'Shows (closer ventas)', value: fN(d.shows) },
          { label: 'No shows', value: fN(d.noShows) },
        ],
        source: 'Fuente: agendas en reportes setter y shows en reportes closer ventas del mes.',
      }
    case 'showUpRate':
      return {
        title: 'Show Up Rate',
        result: fP(d.showUpRate),
        formula: '(Shows ÷ Agendas) × 100',
        data: [
          { label: 'Shows', value: fN(d.shows) },
          { label: 'Agendas', value: fN(d.agendas) },
          { label: 'Show up rate', value: fP(d.showUpRate) },
        ],
        source: 'Fuente: shows (closer ventas) y agendas (setter) del mes.',
      }
    case 'closeRate':
      return {
        title: 'Close Rate',
        result: fP(d.closeRate),
        formula: '(Cierres ÷ Shows) × 100',
        data: [
          { label: 'Cierres', value: fN(d.cierres) },
          { label: 'Shows', value: fN(d.shows) },
          { label: 'Close rate', value: fP(d.closeRate) },
        ],
        source: 'Fuente: cierres y shows en reportes closer ventas del mes.',
      }
    case 'tasaAgendamiento':
      return {
        title: 'T. Agendamiento',
        result: fP(d.tasaAgendamiento),
        formula: '(Agendas ÷ Conversaciones) × 100',
        data: [
          { label: 'Agendas', value: fN(d.agendas) },
          { label: 'Conversaciones', value: fN(d.conversaciones) },
          { label: 'Tasa de agendamiento', value: fP(d.tasaAgendamiento) },
        ],
        source: 'Fuente: reportes setter del mes (agendas y conversaciones).',
      }
    case 'aov':
      return {
        title: 'AOV',
        result: formatCash(d.aov),
        formula:
          d.cierres > 0
            ? 'Facturación del mes ÷ Cierres del mes.'
            : 'Sin cierres en el mes: AOV = 0.',
        data: [
          { label: 'Facturación', value: formatCash(d.facturacion) },
          { label: 'Cierres', value: fN(d.cierres) },
          { label: 'AOV', value: formatCash(d.aov) },
        ],
        source:
          'Fuente: facturación desde leads (Prog. comprado) o ingreso en reportes closer; cierres en reportes closer ventas.',
      }
    case 'cashPorAgenda':
      return {
        title: 'Cash / Agenda',
        result: formatCash(d.cashPorAgenda),
        formula: d.agendas > 0 ? 'Cash collected del mes ÷ Agendas del mes.' : 'Sin agendas: Cash/Agenda = 0.',
        data: [
          { label: 'Cash collected', value: formatCash(d.ingresos) },
          { label: 'Agendas', value: fN(d.agendas) },
          { label: 'Cash / agenda', value: formatCash(d.cashPorAgenda) },
        ],
        source: 'Fuente: cash (Pagó + seguimiento) y agendas (reportes setter).',
      }
    case 'cashPorShow':
      return {
        title: 'Cash / Show',
        result: formatCash(d.cashPorShow),
        formula: d.shows > 0 ? 'Cash collected del mes ÷ Shows del mes.' : 'Sin shows: Cash/Show = 0.',
        data: [
          { label: 'Cash collected', value: formatCash(d.ingresos) },
          { label: 'Shows', value: fN(d.shows) },
          { label: 'Cash / show', value: formatCash(d.cashPorShow) },
        ],
        source: 'Fuente: cash (Pagó + seguimiento) y shows (reportes closer ventas).',
      }
    default:
      return {
        title: 'Métrica',
        result: '—',
        formula: '',
        data: [],
        source: '',
      }
  }
}

function MetricExplainModal({
  metric,
  d,
  open,
  onClose,
}: {
  metric: MonthlyMetricId | null
  d: VDData
  open: boolean
  onClose: () => void
}) {
  if (!metric) return null
  const info = getMetricExplanation(metric, d)
  return (
    <Modal open={open} onClose={onClose} title={info.title} maxWidth="520px" compact>
      <div className="space-y-4 text-[13px] text-[var(--text)]">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            Resultado del mes
          </div>
          <div className="font-mono-num text-2xl font-bold">{info.result}</div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            Cómo se calcula
          </div>
          <p className="leading-snug text-[var(--text2)]">{info.formula}</p>
        </div>
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            Datos usados
          </div>
          <dl className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg3)]/50 p-3">
            {info.data.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-[12px] text-[var(--text2)]">{row.label}</dt>
                <dd className="font-mono-num shrink-0 text-[13px] font-semibold">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-[11px] leading-snug text-[var(--text3)]">{info.source}</p>
      </div>
    </Modal>
  )
}

function VDKpi({
  label,
  value,
  change,
  hib = true,
  onClick,
}: {
  label: string
  value: string
  change?: number
  hib?: boolean
  onClick?: () => void
}) {
  const clr = change === undefined || change === 0 ? 'var(--text3)' : (hib ? change > 0 : change < 0) ? 'var(--green)' : 'var(--text2)'
  const arrow = change !== undefined ? (change > 0 ? '▲' : change < 0 ? '▼' : '─') : ''
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-card w-full p-5 text-left transition-all hover:border-[var(--accent)] hover:brightness-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text2)] mb-2">{label}</div>
      <div className="font-mono-num text-[28px] font-bold tracking-tight">{value}</div>
      {change !== undefined && (
        <div className="mt-2 text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: clr }}>
          {arrow} {Math.abs(change).toFixed(1)}%<span className="text-[var(--text3)] font-normal ml-1">vs mes ant.</span>
        </div>
      )}
    </button>
  )
}

const FUNNEL_LAYER_BG = [
  'var(--funnel-layer-0)',
  'var(--funnel-layer-1)',
  'var(--funnel-layer-2)',
  'var(--funnel-layer-3)',
  'var(--funnel-layer-4)',
] as const

/** Capas del embudo — tokens ATVMkt (--funnel-layer-* en globals.css). */
function funnelSegmentStyle(index: number): {
  background: string
  labelColor: string
  valueColor: string
} {
  return {
    background: FUNNEL_LAYER_BG[index] ?? FUNNEL_LAYER_BG[FUNNEL_LAYER_BG.length - 1],
    labelColor: 'rgba(255,255,255,0.7)',
    valueColor: '#ffffff',
  }
}

const FUNNEL_STEP_LABELS: Record<FunnelLeadStep, string> = {
  CHATS: 'Chats',
  CONVERSACIONES: 'Conversaciones',
  AGENDAS: 'Agendas',
  SHOWS: 'Shows',
  CIERRES: 'Cierres',
}

function funnelStepBreakdown(
  step: FunnelLeadStep,
  d: VDData,
): { label: string; value: number }[] {
  if (step !== 'CHATS') return []
  return [
    { label: 'Historias', value: d.chatsStories },
    { label: 'Reels', value: d.chatsReels },
  ]
}

function FunnelMiniBreakdown({
  items,
  labelColor,
  valueColor,
}: {
  items: { label: string; value: number }[]
  labelColor: string
  valueColor: string
}) {
  if (items.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[9px]" style={{ color: labelColor }}>
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>
            {item.label}{' '}
            <span className="font-mono-num" style={{ color: valueColor }}>
              {fN(item.value)}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  )
}

type FunnelReelItem = {
  id: string
  title: string
  thumbnail: string
  chats: number
  keyword: string
  publishedAt: string
  cta: boolean
  dolor: string
}

type FunnelStorySlide = {
  order_index: number
  image_url: string | null
  replies: number | null
}

type FunnelStoryItem = {
  id: number
  title: string
  thumbnail: string
  chats: number
  sequenceDate: string
  cta: boolean
  dolor: string
  slidesCount: number
}

function proxyImageHostAllowed(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return (
      h.endsWith('cdninstagram.com') ||
      h.endsWith('instagram.com') ||
      h.endsWith('fbcdn.net') ||
      h.endsWith('fbsbx.com') ||
      h.endsWith('ytimg.com') ||
      h.endsWith('googleusercontent.com') ||
      h.endsWith('ggpht.com')
    )
  } catch {
    return false
  }
}

function reelThumbnailUrl(metrics: Record<string, unknown> | undefined): string {
  const raw = String(metrics?.thumbnail ?? '').trim()
  if (!raw) return ''
  if (raw.startsWith('/') && !raw.startsWith('//')) return resolveMediaUrl(raw)
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    // Instagram/YouTube → proxy (misma regla que /api/proxy-image). Resto → URL directa.
    return proxyImageHostAllowed(raw)
      ? `/api/proxy-image?url=${encodeURIComponent(raw)}`
      : raw
  }
  return resolveMediaUrl(raw)
}

function storySequenceThumbnail(slides: FunnelStorySlide[]): string {
  const sorted = [...slides].sort((a, b) => a.order_index - b.order_index)
  const first = sorted.find(s => String(s.image_url ?? '').trim())
  return first ? resolveMediaUrl(first.image_url) : ''
}

function storySequenceChats(slides: FunnelStorySlide[], fallback: number): number {
  if (!slides.length) return fallback
  const sum = slides.reduce((s, sl) => s + (Number(sl.replies) || 0), 0)
  return sum > 0 ? sum : fallback
}

function formatShortDate(iso: string | null | undefined): string {
  const s = String(iso ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  const [, mo, da] = s.split('-')
  return `${da}/${mo}`
}

function ContentThumb({ src, alt, compact }: { src: string; alt: string; compact?: boolean }) {
  const [err, setErr] = useState(false)
  if (!src || err) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      title={alt}
      className={
        compact
          ? 'h-[72px] w-[48px] shrink-0 rounded-md border border-[var(--border2)] object-cover'
          : 'mx-auto aspect-[9/16] w-full max-w-[120px] rounded-lg border border-[var(--border2)] object-cover'
      }
      onError={() => setErr(true)}
    />
  )
}

function ContentChatRow({
  thumb,
  title,
  chats,
  subtitle,
}: {
  thumb: string
  title: string
  chats: number
  subtitle: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--border2)] bg-[var(--bg3)] p-3">
      {thumb ? (
        <ContentThumb src={thumb} alt={title} compact />
      ) : (
        <div
          className="flex h-[72px] w-[48px] shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border2)] bg-[var(--bg4)] text-[8px] leading-tight text-center text-[var(--text3)] px-0.5"
          aria-hidden
        >
          —
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[var(--text)]" title={title}>
          {title}
        </div>
        <div className="mt-0.5 font-mono-num text-[18px] font-bold leading-none text-[var(--accent)]">
          {fN(chats)} <span className="text-[10px] font-semibold text-[var(--text2)]">chats</span>
        </div>
        {subtitle ? (
          <p className="mt-1 truncate text-[10px] text-[var(--text3)]" title={subtitle}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function FunnelChatsBreakdown({
  month,
  chatsStories,
  chatsReels,
}: {
  month: string
  chatsStories: number
  chatsReels: number
}) {
  const [reels, setReels] = useState<FunnelReelItem[]>([])
  const [stories, setStories] = useState<FunnelStoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [reelsRes, storiesRes] = await Promise.all([
          apiFetch(`/reels?page=1&page_size=50&month=${encodeURIComponent(month)}&skip_agg=1`),
          apiFetch(`/stories/sequences?month=${encodeURIComponent(month)}`),
        ])
        const reelsBody = reelsRes.ok
          ? ((await reelsRes.json().catch(() => ({}))) as { reels?: Record<string, unknown>[] })
          : { reels: [] }
        const storiesBody = storiesRes.ok ? await storiesRes.json().catch(() => []) : []

        const reelItems: FunnelReelItem[] = (Array.isArray(reelsBody.reels) ? reelsBody.reels : [])
          .map(r => {
            const metrics = (r.metrics as Record<string, unknown>) || {}
            const classification = (r.classification as Record<string, unknown>) || {}
            return {
              id: String(r.id ?? ''),
              title: String(r.title ?? 'Reel sin título'),
              thumbnail: reelThumbnailUrl(metrics),
              chats: Number(r.chats) || 0,
              keyword: String(r.keyword ?? '—'),
              publishedAt: String(r.published_at ?? ''),
              cta: Boolean(classification.cta),
              dolor: String(classification.dolor ?? '—'),
            }
          })
          .sort((a, b) => b.chats - a.chats)

        const storyItems: FunnelStoryItem[] = (Array.isArray(storiesBody) ? storiesBody : [])
          .map(raw => {
            const seq = raw as Record<string, unknown>
            const slides = (Array.isArray(seq.slides) ? seq.slides : []) as FunnelStorySlide[]
            const chats = storySequenceChats(slides, Number(seq.chats) || 0)
            return {
              id: Number(seq.id) || 0,
              title: String(seq.title ?? 'Secuencia sin título'),
              thumbnail: storySequenceThumbnail(slides),
              chats,
              sequenceDate: String(seq.sequence_date ?? ''),
              cta: Boolean(seq.cta),
              dolor: String(seq.dolor ?? '—'),
              slidesCount: slides.length,
            }
          })
          .sort((a, b) => b.chats - a.chats)

        if (!cancelled) {
          setReels(reelItems)
          setStories(storyItems)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [month])

  if (loading) {
    return <p className="py-8 text-center text-[13px] text-[var(--text3)]">Cargando historias y reels...</p>
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text2)]">Historias</h4>
          <span className="font-mono-num text-[13px] font-bold text-[var(--accent)]">{fN(chatsStories)} chats</span>
        </div>
        {stories.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-[var(--text3)]">Sin secuencias este mes</p>
        ) : (
          <div className="max-h-[min(62vh,520px)] space-y-2 overflow-y-auto pr-1">
            {stories.map(s => (
              <ContentChatRow
                key={s.id}
                thumb={s.thumbnail}
                title={s.title}
                chats={s.chats}
                subtitle={[formatShortDate(s.sequenceDate), s.cta ? 'CTA' : null, s.dolor !== '—' ? s.dolor : null]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text2)]">Reels</h4>
          <span className="font-mono-num text-[13px] font-bold text-[var(--accent)]">{fN(chatsReels)} chats</span>
        </div>
        {reels.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-[var(--text3)]">Sin reels este mes</p>
        ) : (
          <div className="max-h-[min(62vh,520px)] space-y-2 overflow-y-auto pr-1">
            {reels.map(r => (
              <ContentChatRow
                key={r.id}
                thumb={r.thumbnail}
                title={r.title}
                chats={r.chats}
                subtitle={[formatShortDate(r.publishedAt), r.keyword !== '—' ? r.keyword : null, r.cta ? 'CTA' : null]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type FunnelSetterReportRow = {
  id: number
  fecha: string
  member_nombre: string
  conversaciones: number
  agendas: number
  links_enviados: number
  notas: string
}

function FunnelSetterReportsBreakdown({
  month,
  metric,
}: {
  month: string
  metric: 'conversaciones' | 'agendas'
}) {
  const [rows, setRows] = useState<FunnelSetterReportRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const range = monthRangeIso(month)
        if (!range) {
          if (!cancelled) setRows([])
          return
        }
        const res = await apiFetch(
          `/team/reports?desde=${encodeURIComponent(range.desde)}&hasta=${encodeURIComponent(range.hasta)}`,
        )
        if (!res.ok) {
          if (!cancelled) setRows([])
          return
        }
        const body = (await res.json().catch(() => ({}))) as { reports?: Record<string, unknown>[] }
        const setterRows = (Array.isArray(body.reports) ? body.reports : [])
          .filter(r => r.kind === 'setter')
          .map(r => ({
            id: Number(r.id) || 0,
            fecha: String(r.fecha ?? '').slice(0, 10),
            member_nombre: String(r.member_nombre ?? '—'),
            conversaciones: Number(r.conversaciones) || 0,
            agendas: Number(r.agendas) || 0,
            links_enviados: Number(r.links_enviados) || 0,
            notas: String(r.notas ?? '').trim(),
          }))
          .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.fecha))
          .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
        if (!cancelled) setRows(setterRows)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [month])

  const total = rows.reduce((sum, r) => sum + r[metric], 0)
  const metricLabel = metric === 'conversaciones' ? 'Conversaciones' : 'Agendas'

  if (loading) {
    return <p className="py-8 text-center text-[13px] text-[var(--text3)]">Cargando reportes setter...</p>
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[var(--text3)]">
        No hay reportes setter en este mes.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Setter</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Conversaciones</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Agendas</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Links</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Notas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-[var(--border)]">
              <td className="px-3 py-2.5 font-mono-num text-[12px] text-[var(--text2)]">
                {formatIsoDateDdMmYyyy(r.fecha)}
              </td>
              <td className="px-3 py-2.5 text-[13px] font-medium text-[var(--text)]">{r.member_nombre}</td>
              <td className={`px-3 py-2.5 text-right font-mono-num text-[13px]${metric === 'conversaciones' ? ' font-semibold text-[var(--accent)]' : ' text-[12px] text-[var(--text2)]'}`}>
                {fN(r.conversaciones)}
              </td>
              <td className={`px-3 py-2.5 text-right font-mono-num text-[13px]${metric === 'agendas' ? ' font-semibold text-[var(--accent)]' : ' text-[12px] text-[var(--text2)]'}`}>
                {fN(r.agendas)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono-num text-[12px] text-[var(--text2)]">
                {fN(r.links_enviados)}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2.5 text-[12px] text-[var(--text3)]" title={r.notas || undefined}>
                {r.notas || '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--border2)] bg-[var(--bg3)]">
            <td colSpan={2} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">
              Total del mes
            </td>
            {metric === 'conversaciones' ? (
              <>
                <td className="px-3 py-2.5 text-right font-mono-num text-[14px] font-bold text-[var(--accent)]">
                  {fN(total)}
                </td>
                <td colSpan={3} />
              </>
            ) : (
              <>
                <td />
                <td className="px-3 py-2.5 text-right font-mono-num text-[14px] font-bold text-[var(--accent)]">
                  {fN(total)}
                </td>
                <td colSpan={2} />
              </>
            )}
          </tr>
        </tfoot>
      </table>
      <p className="mt-4 text-[11px] text-[var(--text3)]">
        {rows.length} {rows.length === 1 ? 'reporte' : 'reportes'} setter · total {metricLabel.toLowerCase()} = suma diaria del equipo
      </p>
    </div>
  )
}

type FunnelCloserVentasReportRow = {
  id: number
  fecha: string
  member_nombre: string
  shows: number
  cierres: number
  llamadas_agendadas: number
  ingreso: number
  nombre_lead: string
  notas: string
}

function FunnelCloserVentasBreakdown({
  month,
  metric,
}: {
  month: string
  metric: 'shows' | 'cierres'
}) {
  const [rows, setRows] = useState<FunnelCloserVentasReportRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const range = monthRangeIso(month)
        if (!range) {
          if (!cancelled) setRows([])
          return
        }
        const res = await apiFetch(
          `/team/reports?desde=${encodeURIComponent(range.desde)}&hasta=${encodeURIComponent(range.hasta)}`,
        )
        if (!res.ok) {
          if (!cancelled) setRows([])
          return
        }
        const body = (await res.json().catch(() => ({}))) as { reports?: Record<string, unknown>[] }
        const closerRows = (Array.isArray(body.reports) ? body.reports : [])
          .filter((r) => r.kind === 'closer')
          .map(r => ({
            id: Number(r.id) || 0,
            fecha: String(r.fecha ?? '').slice(0, 10),
            member_nombre: String(r.member_nombre ?? '—'),
            shows: Number(r.shows) || 0,
            cierres: Number(r.cierres) || 0,
            llamadas_agendadas: Number(r.llamadas_agendadas) || 0,
            ingreso: Number(r.ingreso) || 0,
            nombre_lead: String(r.nombre_lead ?? '').trim(),
            notas: String(r.notas ?? '').trim(),
          }))
          .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.fecha))
          .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
        if (!cancelled) setRows(closerRows)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [month])

  const total = rows.reduce((sum, r) => sum + r[metric], 0)
  const metricLabel = metric === 'shows' ? 'Shows' : 'Cierres'

  if (loading) {
    return <p className="py-8 text-center text-[13px] text-[var(--text3)]">Cargando reportes closer...</p>
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[var(--text3)]">
        No hay reportes closer (ventas) en este mes.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Closer</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Shows</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Cierres</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Agendadas</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Ingreso</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Lead</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Notas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-[var(--border)]">
              <td className="px-3 py-2.5 font-mono-num text-[12px] text-[var(--text2)]">
                {formatIsoDateDdMmYyyy(r.fecha)}
              </td>
              <td className="px-3 py-2.5 text-[13px] font-medium text-[var(--text)]">{r.member_nombre}</td>
              <td className={`px-3 py-2.5 text-right font-mono-num text-[13px]${metric === 'shows' ? ' font-semibold text-[var(--accent)]' : ' text-[12px] text-[var(--text2)]'}`}>
                {fN(r.shows)}
              </td>
              <td className={`px-3 py-2.5 text-right font-mono-num text-[13px]${metric === 'cierres' ? ' font-semibold text-[var(--accent)]' : ' text-[12px] text-[var(--text2)]'}`}>
                {fN(r.cierres)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono-num text-[12px] text-[var(--text2)]">
                {fN(r.llamadas_agendadas)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono-num text-[12px] text-[var(--text2)]">
                {formatCash(r.ingreso)}
              </td>
              <td className="max-w-[140px] truncate px-3 py-2.5 text-[12px] text-[var(--text2)]" title={r.nombre_lead || undefined}>
                {r.nombre_lead || '—'}
              </td>
              <td className="max-w-[180px] truncate px-3 py-2.5 text-[12px] text-[var(--text3)]" title={r.notas || undefined}>
                {r.notas || '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--border2)] bg-[var(--bg3)]">
            <td colSpan={2} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">
              Total del mes
            </td>
            {metric === 'shows' ? (
              <>
                <td className="px-3 py-2.5 text-right font-mono-num text-[14px] font-bold text-[var(--accent)]">
                  {fN(total)}
                </td>
                <td colSpan={5} />
              </>
            ) : (
              <>
                <td />
                <td className="px-3 py-2.5 text-right font-mono-num text-[14px] font-bold text-[var(--accent)]">
                  {fN(total)}
                </td>
                <td colSpan={4} />
              </>
            )}
          </tr>
        </tfoot>
      </table>
      <p className="mt-4 text-[11px] text-[var(--text3)]">
        {rows.length} {rows.length === 1 ? 'reporte' : 'reportes'} closer (ventas) · total {metricLabel.toLowerCase()} = suma diaria del equipo
      </p>
    </div>
  )
}

function FunnelBreakdownModal({
  step,
  open,
  onClose,
  month,
  chatsStories,
  chatsReels,
}: {
  step: FunnelLeadStep | null
  open: boolean
  onClose: () => void
  month: string
  chatsStories: number
  chatsReels: number
}) {
  if (!step) return null

  const title = `${FUNNEL_STEP_LABELS[step]} — ${month}`

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth={step === 'CHATS' ? '1040px' : '920px'}>
      {step === 'CHATS' ? (
        <>
          <FunnelChatsBreakdown month={month} chatsStories={chatsStories} chatsReels={chatsReels} />
          <p className="mt-4 text-[11px] text-[var(--text3)]">
            Chats del mes = replies en historias + chats en reels (métricas de contenido).
          </p>
        </>
      ) : step === 'CONVERSACIONES' ? (
        <>
          <FunnelSetterReportsBreakdown month={month} metric="conversaciones" />
          <p className="mt-4 text-[11px] text-[var(--text3)]">
            Conversaciones del mes = suma de reportes diarios del setter (misma fuente que el embudo).
          </p>
        </>
      ) : step === 'AGENDAS' ? (
        <>
          <FunnelSetterReportsBreakdown month={month} metric="agendas" />
          <p className="mt-4 text-[11px] text-[var(--text3)]">
            Agendas del mes = suma de reportes diarios del setter (misma fuente que el embudo).
          </p>
        </>
      ) : step === 'SHOWS' ? (
        <>
          <FunnelCloserVentasBreakdown month={month} metric="shows" />
          <p className="mt-4 text-[11px] text-[var(--text3)]">
            Shows del mes = suma de reportes diarios del closer (ventas), misma fuente que el embudo.
          </p>
        </>
      ) : step === 'CIERRES' ? (
        <>
          <FunnelCloserVentasBreakdown month={month} metric="cierres" />
          <p className="mt-4 text-[11px] text-[var(--text3)]">
            Cierres del mes = suma de reportes diarios del closer (ventas), misma fuente que el embudo.
          </p>
        </>
      ) : null}
    </Modal>
  )
}

// ── Funnel Component ──
function VDFunnel({ d, month }: { d: VDData; month: string }) {
  const [openStep, setOpenStep] = useState<FunnelLeadStep | null>(null)

  const steps: { label: FunnelLeadStep; value: number }[] = [
    { label: 'CHATS', value: d.chats },
    { label: 'CONVERSACIONES', value: d.conversaciones },
    { label: 'AGENDAS', value: d.agendas },
    { label: 'SHOWS', value: d.shows },
    { label: 'CIERRES', value: d.cierres },
  ]
  const tasaConversacion = d.chats > 0 ? (d.conversaciones / d.chats) * 100 : 0
  const rates = [
    { label: 'Tasa de conversión', rate: tasaConversacion },
    { label: 'Tasa de agendamiento', rate: d.tasaAgendamiento },
    { label: 'Tasa de show', rate: d.showUpRate },
    { label: 'Tasa de cierre', rate: d.closeRate },
  ]
  const widths = [100, 72, 58, 44, 28]
  const lastStep = steps.length - 1

  return (
    <>
    <div className="glass-card p-6">
      <div className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Embudo de Ventas</div>
      <div className="flex gap-8">
        {/* Funnel trapezoids */}
        <div className="flex-1 flex flex-col items-center gap-2">
          {steps.map((s, i) => {
            const segment = funnelSegmentStyle(i)
            return (
            <button
              key={s.label}
              type="button"
              onClick={() => setOpenStep(s.label)}
              className="relative mx-auto flex cursor-pointer items-center justify-center border-0 py-3 transition-all appearance-none hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{
              width: `${widths[i]}%`,
              background: segment.background,
              borderRadius: i === 0 ? '8px 8px 0 0' : i === lastStep ? '0 0 8px 8px' : '0',
              clipPath: i < lastStep ? `polygon(0 0, 100% 0, ${100 - (widths[i] - widths[i + 1]) / 2}% 100%, ${(widths[i] - widths[i + 1]) / 2}% 100%)` : undefined,
              minHeight: '70px',
            }}>
              <div className="text-center z-10">
                <div
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: segment.labelColor }}
                >
                  {s.label}
                </div>
                <div className="font-mono-num text-[22px] font-bold" style={{ color: segment.valueColor }}>
                  {s.value}
                </div>
                <FunnelMiniBreakdown
                  items={funnelStepBreakdown(s.label, d)}
                  labelColor={segment.labelColor}
                  valueColor={segment.valueColor}
                />
              </div>
            </button>
            )
          })}
        </div>
        {/* Rates */}
        <div className="flex flex-col justify-center gap-6 w-48">
          {rates.map(r => {
            const clr = r.rate >= 50 ? 'var(--green)' : r.rate >= 20 ? 'var(--amber)' : 'var(--text3)'
            const drop = 100 - r.rate
            return (
              <div key={r.label}>
                <div className="text-[11px] text-[var(--text3)] mb-1">{r.label}</div>
                <div className="flex items-baseline gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: clr }} />
                  <span className="font-mono-num text-xl font-bold" style={{ color: clr }}>{fP(r.rate)}</span>
                </div>
                <div className="text-[10px] text-[var(--text3)] mt-0.5">-{drop.toFixed(0)}% drop</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
    <FunnelBreakdownModal
      step={openStep}
      open={openStep !== null}
      onClose={() => setOpenStep(null)}
      month={month}
      chatsStories={d.chatsStories}
      chatsReels={d.chatsReels}
    />
    </>
  )
}

// ── MENSUAL ──
function MensualView({ curr, prev, delta, month }: { curr: VDData; prev: VDData; delta: (k: keyof VDData) => number; month: string }) {
  const [openMetric, setOpenMetric] = useState<MonthlyMetricId | null>(null)
  const chgIngresos = delta('ingresos')
  const progTotal = curr.programas.reduce((s, p) => s + p.ingresos, 0) || 1
  const progColors = ['#F59E0B', '#3B82F6', '#FB923C', '#22C55E', '#A855F7']

  return (
    <div className="space-y-6">
      {/* Hero revenue */}
      <div className="glass-card p-6 flex flex-wrap items-center justify-between gap-6 relative accent-top">
        <div className="flex flex-wrap items-start gap-8 lg:gap-12">
          <div>
            <div className="text-[11px] text-[var(--text3)]">Facturacion</div>
            <div className="font-mono-num mt-1 text-3xl font-bold leading-none">{formatCash(curr.facturacion)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text3)]">Cash Collected</div>
            <div className="mt-1 flex items-stretch gap-2 sm:gap-3">
              <div className="font-mono-num shrink-0 text-3xl font-bold leading-none text-[var(--green)] tabular-nums">
                {formatCash(curr.ingresos)}
              </div>
              <div className="flex min-h-0 min-w-[11rem] flex-1 flex-col justify-between border-l border-[var(--border)] pl-2.5 sm:min-w-[12rem] sm:pl-3">
                <div className="flex items-center justify-between gap-6 sm:gap-8">
                  <span className="text-[11px] text-[var(--text3)]">Pago</span>
                  <span className="font-mono-num text-[11px] font-semibold tabular-nums leading-none text-[var(--text2)]">
                    {formatCash(curr.cashCollectedComposition.pago)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-6 sm:gap-8">
                  <span className="text-[11px] text-[var(--text3)]">Seguimiento</span>
                  <span className="font-mono-num text-[11px] font-semibold tabular-nums leading-none text-[var(--text2)]">
                    {formatCash(curr.cashCollectedComposition.seguimiento)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-[13px] font-semibold ${chgIngresos >= 0 ? 'text-[var(--green)]' : 'text-[var(--text2)]'}`}>
            {chgIngresos >= 0 ? '▲' : '▼'} {Math.abs(chgIngresos).toFixed(1)}% vs mes ant.
          </div>
        </div>
      </div>

      {/* Funnel */}
      <VDFunnel d={curr} month={month} />

      {/* KPIs del mes */}
      <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Metricas del Mes</div>
      <div className="grid grid-cols-4 gap-3">
        <VDKpi label="Cash del mes" value={formatCash(curr.ingresos)} change={delta('ingresos')} onClick={() => setOpenMetric('cash')} />
        <VDKpi label="Conversaciones" value={fN(curr.conversaciones)} change={delta('conversaciones')} onClick={() => setOpenMetric('conversaciones')} />
        <VDKpi label="Agendas" value={fN(curr.agendas)} change={delta('agendas')} onClick={() => setOpenMetric('agendas')} />
        <VDKpi label="No Shows" value={fN(curr.noShows)} change={delta('noShows')} hib={false} onClick={() => setOpenMetric('noShows')} />
        <VDKpi label="Show Up Rate" value={fP(curr.showUpRate)} change={delta('showUpRate')} onClick={() => setOpenMetric('showUpRate')} />
        <VDKpi label="Close Rate" value={fP(curr.closeRate)} change={delta('closeRate')} onClick={() => setOpenMetric('closeRate')} />
        <VDKpi label="T. Agendamiento" value={fP(curr.tasaAgendamiento)} change={delta('tasaAgendamiento')} onClick={() => setOpenMetric('tasaAgendamiento')} />
        <VDKpi label="AOV" value={formatCash(curr.aov)} change={delta('aov')} onClick={() => setOpenMetric('aov')} />
      </div>
      <MetricExplainModal
        metric={openMetric}
        d={curr}
        open={openMetric !== null}
        onClose={() => setOpenMetric(null)}
      />

      {/* Programas */}
      {curr.programas.length > 0 && (
        <>
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Programas</div>
          <div className="grid grid-cols-[280px_1fr] gap-4">
            {/* Top program */}
            <div className="glass-card p-5">
              <div className="text-xl font-bold text-[var(--amber)]">{curr.programas[0].nombre}</div>
              <div className="text-[12px] text-[var(--text2)] mt-1">{curr.programas[0].ventas} ventas · {formatCash(curr.programas[0].ingresos)}</div>
              <div className="text-[11px] text-[var(--text3)] mt-0.5">{((curr.programas[0].ingresos / progTotal) * 100).toFixed(0)}% del total</div>
              <div className="mt-4 text-[10px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">Prog. Comprados</div>
              {curr.programas.map((p, i) => (
                <div key={p.nombre} className="flex items-center gap-2 py-1">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: progColors[i % progColors.length] }} />
                  <span className="text-[12px] text-[var(--text2)]">{p.nombre}</span>
                  <span className="ml-auto font-mono-num text-[12px]">{p.ventas}</span>
                </div>
              ))}
            </div>
            {/* Breakdown bars */}
            <div className="glass-card p-5 space-y-2">
              {curr.programas.map((p, i) => (
                <div key={p.nombre}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-semibold">{p.nombre}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">{formatCash(p.ingresos)} · {((p.ingresos / progTotal) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-[var(--bg4)]">
                    <div className="h-full rounded-full transition-all" style={{ width: `${(p.ingresos / progTotal) * 100}%`, backgroundColor: progColors[i % progColors.length] }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Comparaciones table */}
      <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Comparaciones</div>
      <p className="mb-2 text-[11px] text-[var(--text3)]">Tocá una fila para ver cómo se calcula la métrica.</p>
      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Metrica</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Mes anterior</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Mes actual</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Var.</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                { label: 'Cash del mes', metricId: 'cash' as const, pv: formatCash(prev.ingresos), cv: formatCash(curr.ingresos), chg: delta('ingresos') },
                { label: 'Conversaciones', metricId: 'conversaciones' as const, pv: fN(prev.conversaciones), cv: fN(curr.conversaciones), chg: delta('conversaciones') },
                { label: 'Agendas', metricId: 'agendas' as const, pv: fN(prev.agendas), cv: fN(curr.agendas), chg: delta('agendas') },
                { label: 'No Shows', metricId: 'noShows' as const, pv: fN(prev.noShows), cv: fN(curr.noShows), chg: delta('noShows') },
                { label: 'Show Up Rate', metricId: 'showUpRate' as const, pv: fP(prev.showUpRate), cv: fP(curr.showUpRate), chg: delta('showUpRate') },
                { label: 'Close Rate', metricId: 'closeRate' as const, pv: fP(prev.closeRate), cv: fP(curr.closeRate), chg: delta('closeRate') },
                { label: 'T. Agendamiento', metricId: 'tasaAgendamiento' as const, pv: fP(prev.tasaAgendamiento), cv: fP(curr.tasaAgendamiento), chg: delta('tasaAgendamiento') },
                { label: 'AOV', metricId: 'aov' as const, pv: formatCash(prev.aov), cv: formatCash(curr.aov), chg: delta('aov') },
                { label: 'Cash/Agenda', metricId: 'cashPorAgenda' as const, pv: formatCash(prev.cashPorAgenda), cv: formatCash(curr.cashPorAgenda), chg: delta('cashPorAgenda') },
                { label: 'Cash/Show', metricId: 'cashPorShow' as const, pv: formatCash(prev.cashPorShow), cv: formatCash(curr.cashPorShow), chg: delta('cashPorShow') },
              ] satisfies { label: string; metricId: MonthlyMetricId; pv: string; cv: string; chg: number }[]
            ).map((row) => (
              <tr
                key={row.label}
                onClick={() => setOpenMetric(row.metricId)}
                className="cursor-pointer border-b border-[var(--border)] transition-colors hover:bg-[var(--nav-hover)]"
              >
                <td className="px-5 py-2.5 text-[13px] font-medium">{row.label}</td>
                <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--text2)]">{row.pv}</td>
                <td className="px-5 py-2.5 font-mono-num text-[13px]">{row.cv}</td>
                <td className="px-5 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.chg >= 0 ? 'bg-[rgba(34,197,94,0.15)] text-[var(--green)]' : 'bg-[var(--accent-faint)] text-[var(--text2)]'}`}>
                    {row.chg >= 0 ? '+' : ''}{row.chg.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── SEMANAL ──
function SemanalView({ curr }: { curr: VDData }) {
  const weeks = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4']
  const showUpRates = curr.agendasByWeek.map((a, i) => {
    const sh = curr.showsByWeek[i] ?? 0
    if (a > 0) return (sh / a) * 100
    return sh > 0 ? Number.NaN : 0
  })
  const closeRates = curr.showsByWeek.map((s, i) => {
    const ci = curr.cierresByWeek[i] ?? 0
    if (s > 0) return (ci / s) * 100
    return ci > 0 ? Number.NaN : 0
  })
  const tasaAgend = curr.conversacionesByWeek.map((c, i) => c > 0 ? (curr.agendasByWeek[i] / c) * 100 : 0)
  const aovW = curr.cierresByWeek.map((c, i) =>
    c > 0 ? (curr.byWeek.facturacion[i] ?? 0) / c : 0,
  )

  const rows = [
    { label: 'Conversaciones', data: curr.conversacionesByWeek },
    { label: 'Agendas', data: curr.agendasByWeek },
    { label: 'Shows', data: curr.showsByWeek },
    { label: 'No Shows', data: curr.noShowsByWeek },
    { label: 'Cierres', data: curr.cierresByWeek },
    { label: 'T. Agendamiento %', data: tasaAgend, fmt: fP },
    { label: 'Show Up Rate %', data: showUpRates, fmt: fPOrDash },
    { label: 'Close Rate %', data: closeRates, fmt: fPOrDash },
    { label: 'AOV', data: aovW, fmt: formatCash },
  ]

  return (
    <div className="space-y-6">
      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Metrica</th>
              {weeks.map(w => <th key={w} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-b border-[var(--border)]">
                <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                {r.data.map((v, i) => (
                  <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">{r.fmt ? r.fmt(v) : fN(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Agendas por semana" value={String(curr.agendasByWeek.reduce((s, v) => s + v, 0))} subtitle="total">
          <Bar data={{ labels: weeks, datasets: [{ data: curr.agendasByWeek, backgroundColor: 'rgba(245,158,11,0.25)', hoverBackgroundColor: '#F59E0B', borderRadius: 8, borderSkipped: false, barPercentage: 0.5, categoryPercentage: 0.7 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4 } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false } } }} />
        </ChartCard>
        <ChartCard title="Ingresos por semana" value={formatCash(curr.ingresosByWeek.reduce((s, v) => s + v, 0))} subtitle="closer ventas + seguimiento">
          <Bar data={{ labels: weeks, datasets: [{ data: curr.ingresosByWeek, backgroundColor: 'rgba(34,197,94,0.25)', hoverBackgroundColor: '#22C55E', borderRadius: 8, borderSkipped: false, barPercentage: 0.5, categoryPercentage: 0.7 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => formatCashAxisShort(v) } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => formatCash(ctx.parsed.y ?? 0) } } } }} />
        </ChartCard>
        <ChartCard title="Show Up Rate" value={fP(showUpRates.filter(v => v > 0).reduce((s, v, _, a) => s + v / a.length, 0))} subtitle="promedio">
          <Line data={{ labels: weeks, datasets: [{ data: showUpRates, borderColor: '#60A5FA', backgroundColor: 'rgba(96,165,250,0.06)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#60A5FA', pointBorderColor: 'rgba(0,0,0,0.3)', pointBorderWidth: 2, pointHoverRadius: 7, pointHoverBackgroundColor: '#60A5FA', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => v + '%' }, min: 0, max: 100 } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => (ctx.parsed.y ?? 0).toFixed(1) + '%' } } } }} />
        </ChartCard>
        <ChartCard title="Close Rate" value={fP(closeRates.filter(v => v > 0).reduce((s, v, _, a) => s + v / a.length, 0))} subtitle="promedio">
          <Line data={{ labels: weeks, datasets: [{ data: closeRates, borderColor: '#A855F7', backgroundColor: 'rgba(168,85,247,0.06)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#A855F7', pointBorderColor: 'rgba(0,0,0,0.3)', pointBorderWidth: 2, pointHoverRadius: 7, pointHoverBackgroundColor: '#A855F7', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => v + '%' }, min: 0, max: 100 } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => (ctx.parsed.y ?? 0).toFixed(1) + '%' } } } }} />
        </ChartCard>
      </div>
    </div>
  )
}

// ── DIARIO ──
function DiarioView({ curr, semana, setSemana }: { curr: VDData; semana: number; setSemana: (s: number) => void }) {
  const days = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
  const wd = curr.byWeekDay
  const w = semana
  const conv = wd.conversaciones[w]
  const agendas = wd.agendas[w]
  const shows = wd.shows[w]
  const noShowsD = wd.noShows[w]
  const cierres = wd.cierres[w]
  const ingresos = wd.ingresos[w]
  const facturacionD = wd.facturacion[w]
  const showUpD = agendas.map((a, i) => {
    const s = shows[i] ?? 0
    if (a > 0) return (s / a) * 100
    return s > 0 ? Number.NaN : 0
  })
  const closeD = shows.map((s, i) => {
    const c = cierres[i] ?? 0
    if (s > 0) return (c / s) * 100
    return c > 0 ? Number.NaN : 0
  })
  const tasaAgD = conv.map((c, i) => c > 0 ? (agendas[i] / c) * 100 : 0)
  const aovD = cierres.map((c, i) => (c > 0 ? facturacionD[i] / c : 0))

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0)
  const sumAg = sum(agendas)
  const sumSh = sum(shows)
  const sumCi = sum(cierres)
  const sumFact = sum(facturacionD)
  const sumIng = sum(ingresos)
  const sumConv = sum(conv)

  const rows = [
    { label: 'Conversaciones', data: conv, total: sumConv },
    { label: 'Agendas', data: agendas, total: sumAg },
    { label: 'Shows', data: shows, total: sumSh },
    { label: 'No Shows', data: noShowsD, total: sum(noShowsD) },
    { label: 'Cierres', data: cierres, total: sumCi },
    { label: 'Ingresos (reportes)', data: ingresos, total: sumIng, fmt: formatCash },
    { label: 'T. Agendamiento', data: tasaAgD, total: sumConv > 0 ? (sumAg / sumConv) * 100 : 0, fmt: fP },
    {
      label: 'Show Up Rate',
      data: showUpD,
      total: sumAg > 0 ? (sumSh / sumAg) * 100 : sumSh > 0 ? Number.NaN : 0,
      fmt: fPOrDash,
    },
    {
      label: 'Close Rate',
      data: closeD,
      total: sumSh > 0 ? (sumCi / sumSh) * 100 : sumCi > 0 ? Number.NaN : 0,
      fmt: fPOrDash,
    },
    { label: 'AOV', data: aovD, total: sumCi > 0 ? sumFact / sumCi : 0, fmt: formatCash },
  ]

  return (
    <div className="space-y-6">
      {/* Week selector */}
      <div className="segment-group w-fit">
        {[0, 1, 2, 3].map(i => (
          <button key={i} onClick={() => setSemana(i)}
            className={`segment-tab ${semana === i ? 'segment-tab-active font-semibold' : ''}`}>
            Semana {i + 1}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Metrica</th>
              {days.map(d => <th key={d} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{d}</th>)}
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-b border-[var(--border)]">
                <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                {r.data.map((v, i) => (
                  <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">{r.fmt ? r.fmt(v) : fN(v)}</td>
                ))}
                <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--accent)] font-semibold">{r.fmt ? r.fmt(r.total) : fN(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title={`Agendas diarias — Semana ${semana + 1}`} value={String(agendas.reduce((s, v) => s + v, 0))} subtitle="total">
          <Bar data={{ labels: days, datasets: [{ data: agendas, backgroundColor: 'rgba(245,158,11,0.25)', hoverBackgroundColor: '#F59E0B', borderRadius: 6, borderSkipped: false, barPercentage: 0.6, categoryPercentage: 0.8 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4 } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false } } }} />
        </ChartCard>
        <ChartCard title="Ingresos diarios" value={formatCash(ingresos.reduce((s, v) => s + v, 0))} subtitle="closer ventas + seguimiento">
          <Bar data={{ labels: days, datasets: [{ data: ingresos, backgroundColor: 'rgba(34,197,94,0.25)', hoverBackgroundColor: '#22C55E', borderRadius: 6, borderSkipped: false, barPercentage: 0.6, categoryPercentage: 0.8 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => formatCashAxisShort(v) } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => formatCash(ctx.parsed.y ?? 0) } } } }} />
        </ChartCard>
      </div>
    </div>
  )
}

// ── Chart wrapper ──
function ChartCard({ title, value, subtitle, children }: { title: string; value?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">{title}</div>
        {value && (
          <div className="text-right">
            <div className="font-mono-num text-[18px] font-bold leading-tight">{value}</div>
            {subtitle && <div className="text-[9px] text-[var(--text3)]">{subtitle}</div>}
          </div>
        )}
      </div>
      <div className="h-44">{children}</div>
    </div>
  )
}
