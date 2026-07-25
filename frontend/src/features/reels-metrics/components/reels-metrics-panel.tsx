'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bar, Pie } from '@/shared/components/charts'
import { apiFetch } from '@/lib/api'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'

type ReelRow = {
  id: string
  title: string | null
  url: string | null
  published_at?: string | null
  keyword?: string | null
  chats?: number
  cash?: number
  cpc?: number
  metrics?: Record<string, unknown>
  classification?: { dolor?: unknown; angulos?: unknown; cta?: unknown } | null
}

type ReelsResponse = {
  reels: ReelRow[]
  total_pages: number
}

type ReelMetricItem = {
  id: string
  title: string
  url: string | null
  publishedAt: string | null
  keyword: string | null
  year: number | null
  /** 1–12 en calendario Argentina (publicación) */
  month: number | null
  day: number | null
  /** Semana dentro del mes (1 = días 1–7, …) según fecha AR */
  weekOfMonth: number | null
  chats: number
  cash: number
  cpc: number
  views: number
  comments: number
  likes: number
  shares: number
  dolor: string | null
  angulos: string | null
  cta: string | null
}

const AR_TZ = 'America/Argentina/Buenos_Aires'

const MONTH_OPTIONS = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
] as const

const PIE_COLORS = [
  'rgba(34,197,94,0.9)',
  'rgba(59,130,246,0.9)',
  'rgba(239,68,68,0.9)',
  'rgba(168,85,247,0.9)',
  'rgba(245,158,11,0.9)',
  'rgba(236,72,153,0.9)',
  'rgba(20,184,166,0.9)',
  'rgba(251,191,36,0.9)',
]

function classificationString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const s = v.trim()
    return s || null
  }
  if (Array.isArray(v)) {
    const s = v.map((x) => String(x).trim()).filter(Boolean).join(', ')
    return s || null
  }
  const s = String(v).trim()
  return s || null
}

/** Misma regla que `reels_services._cta_counts_as_reel_con_cta` (reels con/sin CTA en métricas). */
const CTA_NEGATIVE_FOR_METRICS = new Set([
  'no',
  'ninguno',
  'ninguna',
  'sin cta',
  'sin_cta',
  'sin-cta',
  'n/a',
  'na',
  'none',
  'false',
  '0',
  '-',
])

function ctaCountsAsReelConCta(cta: string | null): boolean {
  let s = (cta ?? '').trim().toLowerCase().replace(/[.!¡?]+$/g, '')
  if (!s) return false
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return !CTA_NEGATIVE_FOR_METRICS.has(s)
}

function topCashByLabel(
  rows: ReelMetricItem[],
  pick: (r: ReelMetricItem) => string | null,
  limit: number,
): { label: string; cash: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const label = pick(r)
    if (!label) continue
    m.set(label, (m.get(label) || 0) + r.cash)
  }
  return [...m.entries()]
    .map(([label, cash]) => ({ label, cash }))
    .sort((a, b) => b.cash - a.cash)
    .slice(0, limit)
}

function pieOptions(
  onSliceClick: (index: number) => void,
  tooltipLabel: (raw: number) => string,
  opts?: { hideBuiltInLegend?: boolean },
) {
  const hideLegend = opts?.hideBuiltInLegend ?? false
  return {
    maintainAspectRatio: false,
    onClick: (_: unknown, elements: { index: number }[]) => {
      if (!elements.length) return
      onSliceClick(elements[0].index)
    },
    plugins: {
      legend: {
        display: !hideLegend,
        position: 'bottom' as const,
        labels: {
          color: '#a1a1aa',
          boxWidth: 10,
          font: { size: 9 },
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx: { raw?: unknown }) => {
            const raw = Number(ctx.raw ?? 0)
            return tooltipLabel(raw)
          },
        },
      },
    },
  }
}

function ScrollablePieLegend({
  items,
  onItemClick,
}: {
  items: { label: string; color: string; sublabel?: string }[]
  onItemClick?: (index: number) => void
}) {
  if (items.length === 0) return null
  return (
    <ul
      className="mt-3 max-h-40 overflow-y-auto overscroll-y-contain rounded-md border border-[var(--border)] bg-[var(--bg4)]/50 px-2 py-1.5 text-[10px] leading-snug [scrollbar-gutter:stable]"
    >
      {items.map((item, i) => (
        <li key={i} className="border-b border-[var(--border)] py-1.5 last:border-0">
          <button
            type="button"
            className="flex w-full gap-2 text-left text-[var(--text2)] transition-colors hover:text-[var(--text)]"
            onClick={() => onItemClick?.(i)}
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block break-words">{item.label}</span>
              {item.sublabel ? (
                <span className="mt-0.5 block font-mono-num text-[var(--text3)]">{item.sublabel}</span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function calendarInArgentina(d: Date): { y: number; m: number; d: number } | null {
  if (Number.isNaN(d.getTime())) return null
  const y = Number(new Intl.DateTimeFormat('en', { timeZone: AR_TZ, year: 'numeric' }).format(d))
  const m = Number(new Intl.DateTimeFormat('en', { timeZone: AR_TZ, month: 'numeric' }).format(d))
  const day = Number(new Intl.DateTimeFormat('en', { timeZone: AR_TZ, day: 'numeric' }).format(d))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null
  return { y, m, d: day }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function weekDayRangeLabel(y: number, m: number, week: number): string {
  const dim = daysInMonth(y, m)
  const start = (week - 1) * 7 + 1
  const end = Math.min(week * 7, dim)
  if (start > dim) return ''
  return `${start}–${end}`
}

export function ReelsMetricsPanel() {
  const { ready, userId } = useAuthUser()
  const [rows, setRows] = useState<ReelMetricItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState<string>('all')
  const [selectedMonth, setSelectedMonth] = useState<string>('all')
  const [selectedWeek, setSelectedWeek] = useState<string>('all')
  /** Filtra reels como en la grilla de Reels: con CTA afirmativa vs sin CTA / negativa. */
  const [selectedCtaScope, setSelectedCtaScope] = useState<'all' | 'con_cta' | 'sin_cta'>('all')
  const [selectedReel, setSelectedReel] = useState<ReelMetricItem | null>(null)

  useEffect(() => {
    if (!ready || !userId) return
    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const collected: ReelRow[] = []
        let page = 1
        let totalPages = 1
        while (page <= totalPages && page <= 10) {
          const res = await apiFetch(`/reels?page=${page}&page_size=50`)
          const data = (await res.json()) as ReelsResponse
          const pageRows = Array.isArray(data.reels) ? data.reels : []
          collected.push(...pageRows)
          totalPages = Math.max(1, Number(data.total_pages || 1))
          page += 1
        }

        const mapped: ReelMetricItem[] = collected.map((r) => {
          const views = Number(r.metrics?.plays || 0)
          const comments = Number(r.metrics?.comments_count ?? r.metrics?.comments ?? 0)
          const likes = Number(r.metrics?.likes || 0)
          const shares = Number(r.metrics?.shares || 0)
          const cl = r.classification
          const parts = r.published_at ? calendarInArgentina(new Date(r.published_at)) : null
          const weekOfMonth =
            parts && parts.d > 0 ? Math.floor((parts.d - 1) / 7) + 1 : null
          return {
            id: r.id,
            title: (r.title || 'Reel sin titulo').slice(0, 48),
            url: r.url || null,
            publishedAt: r.published_at || null,
            keyword: r.keyword || null,
            year: parts?.y ?? (r.published_at ? yearInArgentina(new Date(r.published_at)) : null),
            month: parts?.m ?? null,
            day: parts?.d ?? null,
            weekOfMonth,
            chats: Number(r.chats || 0),
            cash: Number(r.cash ?? 0),
            cpc: Number(r.cpc ?? 0),
            views,
            comments,
            likes,
            shares,
            dolor: classificationString(cl?.dolor),
            angulos: classificationString(cl?.angulos),
            cta: classificationString(cl?.cta),
          }
        })
        if (!cancelled) setRows(mapped)
      } catch {
        if (!cancelled) setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [ready, userId])

  const dateFiltersEnabled = selectedCtaScope === 'con_cta' || selectedCtaScope === 'sin_cta'
  const weekFilterEnabled = dateFiltersEnabled && selectedYear !== 'all' && selectedMonth !== 'all'

  useEffect(() => {
    if (selectedCtaScope !== 'all') return
    setSelectedYear('all')
    setSelectedMonth('all')
    setSelectedWeek('all')
  }, [selectedCtaScope])

  const maxWeekInSelection = useMemo(() => {
    if (!weekFilterEnabled) return 0
    const y = Number(selectedYear)
    const m = Number(selectedMonth)
    if (!Number.isFinite(y) || !Number.isFinite(m)) return 0
    return Math.ceil(daysInMonth(y, m) / 7)
  }, [weekFilterEnabled, selectedYear, selectedMonth])

  useEffect(() => {
    if (!weekFilterEnabled && selectedWeek !== 'all') setSelectedWeek('all')
  }, [weekFilterEnabled, selectedWeek])

  useEffect(() => {
    if (selectedWeek === 'all' || !weekFilterEnabled) return
    const w = Number(selectedWeek)
    if (Number.isFinite(w) && maxWeekInSelection > 0 && w > maxWeekInSelection) setSelectedWeek('all')
  }, [maxWeekInSelection, selectedWeek, weekFilterEnabled])

  const years = useMemo(() => {
    return [...new Set(rows.map((r) => r.year).filter((y): y is number => y !== null))].sort((a, b) => b - a)
  }, [rows])

  const filteredRows = useMemo(() => {
    let out = rows
    if (dateFiltersEnabled) {
      if (selectedYear !== 'all') {
        const y = Number(selectedYear)
        out = out.filter((r) => r.year === y)
      }
      if (selectedMonth !== 'all') {
        const m = Number(selectedMonth)
        out = out.filter((r) => r.month === m)
      }
      if (weekFilterEnabled && selectedWeek !== 'all') {
        const w = Number(selectedWeek)
        out = out.filter((r) => r.weekOfMonth === w)
      }
    }
    if (selectedCtaScope === 'con_cta') {
      out = out.filter((r) => ctaCountsAsReelConCta(r.cta))
    } else if (selectedCtaScope === 'sin_cta') {
      out = out.filter((r) => !ctaCountsAsReelConCta(r.cta))
    }
    return out
  }, [
    rows,
    dateFiltersEnabled,
    selectedYear,
    selectedMonth,
    selectedWeek,
    weekFilterEnabled,
    selectedCtaScope,
  ])
  const topViews = useMemo(
    () => [...filteredRows].sort((a, b) => b.views - a.views).slice(0, 8),
    [filteredRows]
  )
  const topComments = useMemo(
    () => [...filteredRows].sort((a, b) => b.comments - a.comments).slice(0, 8),
    [filteredRows]
  )
  const topLikes = useMemo(
    () => [...filteredRows].sort((a, b) => b.likes - a.likes).slice(0, 8),
    [filteredRows]
  )
  const topChats = useMemo(
    () => [...filteredRows].sort((a, b) => b.chats - a.chats).slice(0, 8),
    [filteredRows]
  )
  const topShares = useMemo(
    () => [...filteredRows].sort((a, b) => b.shares - a.shares).slice(0, 8),
    [filteredRows]
  )
  const topCash = useMemo(
    () => [...filteredRows].sort((a, b) => b.cash - a.cash).slice(0, 8),
    [filteredRows]
  )
  const topCpc = useMemo(
    () =>
      [...filteredRows]
        .filter((r) => r.cpc > 0)
        .sort((a, b) => b.cpc - a.cpc)
        .slice(0, 8),
    [filteredRows]
  )

  const pieCashSource = useMemo(() => topCash.filter((r) => r.cash > 0), [topCash])
  const pieChatsSource = useMemo(() => topChats.filter((r) => r.chats > 0), [topChats])
  const pieCpcSource = useMemo(() => topCpc, [topCpc])

  const topDoloresCash = useMemo(
    () => topCashByLabel(filteredRows, (r) => r.dolor, 5),
    [filteredRows]
  )
  const topAngulosCash = useMemo(
    () => topCashByLabel(filteredRows, (r) => r.angulos, 5),
    [filteredRows]
  )

  /** Reels sin CTA: solo métricas de Instagram (sin cash, chats, cash por chat ni tortas de negocio). */
  const showBusinessMetrics = selectedCtaScope !== 'sin_cta'

  const filterSelectClass =
    'h-9 min-h-9 shrink-0 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 text-[12px] leading-normal text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-45'

  const filterLabelClass = 'whitespace-nowrap text-[11px] leading-none text-[var(--text3)] uppercase tracking-wider'
  const dateFilterHint = 'Elegí Con CTA o Sin CTA para habilitar fecha'

  const pageHeader = (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h1 className="shrink-0 text-lg font-semibold leading-none tracking-tight">Métricas reels</h1>
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2">
          <span className={filterLabelClass}>CTA</span>
          <select
            value={selectedCtaScope}
            onChange={(e) => setSelectedCtaScope(e.target.value as 'all' | 'con_cta' | 'sin_cta')}
            title="Primero definí si querés métricas de reels con o sin llamado a la acción"
            className={filterSelectClass}
          >
            <option value="all">Todos</option>
            <option value="con_cta">Con CTA</option>
            <option value="sin_cta">Sin CTA</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          <span className={`${filterLabelClass} ${!dateFiltersEnabled ? 'opacity-45' : ''}`}>Año</span>
          <select
            value={selectedYear}
            onChange={(e) => {
              setSelectedYear(e.target.value)
              setSelectedWeek('all')
            }}
            disabled={!dateFiltersEnabled}
            title={dateFiltersEnabled ? 'Año de publicación (Argentina)' : dateFilterHint}
            className={filterSelectClass}
          >
            <option value="all">Todos</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          <span className={`${filterLabelClass} ${!dateFiltersEnabled ? 'opacity-45' : ''}`}>Mes</span>
          <select
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value)
              setSelectedWeek('all')
            }}
            disabled={!dateFiltersEnabled}
            title={dateFiltersEnabled ? 'Mes de publicación' : dateFilterHint}
            className={filterSelectClass}
          >
            <option value="all">Todos</option>
            {MONTH_OPTIONS.map((mo) => (
              <option key={mo.value} value={String(mo.value)}>{mo.label}</option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          <span className={`${filterLabelClass} ${!dateFiltersEnabled || !weekFilterEnabled ? 'opacity-45' : ''}`}>
            Semana
          </span>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            disabled={!dateFiltersEnabled || !weekFilterEnabled}
            title={
              !dateFiltersEnabled
                ? dateFilterHint
                : weekFilterEnabled
                  ? 'Semana dentro del mes (días 1–7, 8–14, …)'
                  : 'Elegí año y mes para filtrar por semana del mes'
            }
            className={filterSelectClass}
          >
            <option value="all">Todas</option>
            {weekFilterEnabled &&
              Array.from({ length: maxWeekInSelection }, (_, i) => i + 1).map((w) => (
                <option key={w} value={String(w)}>
                  {w}ª ({weekDayRangeLabel(Number(selectedYear), Number(selectedMonth), w)})
                </option>
              ))}
          </select>
        </label>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div>
        {pageHeader}
        <div className="glass-card p-6 text-[12px] text-[var(--text3)]">Cargando métricas de reels...</div>
      </div>
    )
  }

  return (
    <div>
      {pageHeader}

      {showBusinessMetrics && (
        <>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            Cash por clasificación
          </div>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="glass-card flex flex-col p-5">
              <div className="mb-3 text-[12px] font-semibold">Cash por contenido</div>
              <div className="flex w-full flex-col">
                {pieCashSource.length === 0 ? (
                  <div className="flex h-[220px] items-center justify-center text-[12px] text-[var(--text3)]">
                    Sin cash en reels del filtro
                  </div>
                ) : (
                  <>
                    <div className="mx-auto h-[200px] w-full max-w-sm">
                      <Pie
                        data={{
                          labels: pieCashSource.map((r) => r.title),
                          datasets: [
                            {
                              data: pieCashSource.map((r) => r.cash),
                              backgroundColor: pieCashSource.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
                              borderWidth: 0,
                            },
                          ],
                        }}
                        options={pieOptions(
                          (idx) => {
                            const reel = pieCashSource[idx]
                            if (reel) setSelectedReel(reel)
                          },
                          (raw) => ` ${formatCash(raw)}`,
                          { hideBuiltInLegend: true },
                        )}
                      />
                    </div>
                    <ScrollablePieLegend
                      items={pieCashSource.map((r, i) => ({
                        label: r.title,
                        color: PIE_COLORS[i % PIE_COLORS.length],
                        sublabel: formatCash(r.cash),
                      }))}
                      onItemClick={(idx) => {
                        const reel = pieCashSource[idx]
                        if (reel) setSelectedReel(reel)
                      }}
                    />
                  </>
                )}
              </div>
            </div>
            <CashRankCard title="Top dolores" items={topDoloresCash} emptyHint="Sin dolores clasificados" />
            <CashRankCard title="Top ángulos" items={topAngulosCash} emptyHint="Sin ángulos clasificados" />
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="glass-card p-5">
        <div className="mb-3 text-[12px] font-semibold">MAS VISTOS</div>
        <div className="h-80">
          <Bar
            data={{
              labels: topViews.map((r) => r.title),
              datasets: [{ data: topViews.map((r) => r.views), backgroundColor: 'rgba(34,197,94,0.65)' }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              onClick: (_, elements) => {
                if (!elements.length) return
                const idx = elements[0].index
                const reel = topViews[idx]
                if (reel) setSelectedReel(reel)
              },
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: { ticks: { color: '#a1a1aa', font: { size: 10 } }, grid: { display: false } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="mb-3 text-[12px] font-semibold">MAS COMENTADOS</div>
        <div className="h-80">
          <Bar
            data={{
              labels: topComments.map((r) => r.title),
              datasets: [{ label: 'Comentarios', data: topComments.map((r) => r.comments), backgroundColor: 'rgba(59,130,246,0.65)' }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              onClick: (_, elements) => {
                if (!elements.length) return
                const idx = elements[0].index
                const reel = topComments[idx]
                if (reel) setSelectedReel(reel)
              },
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: { ticks: { color: '#a1a1aa', font: { size: 10 } }, grid: { display: false } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="mb-3 text-[12px] font-semibold">MAS LIKES</div>
        <div className="h-80">
          <Bar
            data={{
              labels: topLikes.map((r) => r.title),
              datasets: [{ label: 'Likes', data: topLikes.map((r) => r.likes), backgroundColor: 'rgba(239,68,68,0.65)' }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              onClick: (_, elements) => {
                if (!elements.length) return
                const idx = elements[0].index
                const reel = topLikes[idx]
                if (reel) setSelectedReel(reel)
              },
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
      </div>

      {showBusinessMetrics ? (
        <div className="glass-card p-5">
          <div className="mb-3 text-[12px] font-semibold">MAS CHATS</div>
          <div className="h-80">
            <Bar
              data={{
                labels: topChats.map((r) => r.title),
                datasets: [{ label: 'Chats', data: topChats.map((r) => r.chats), backgroundColor: 'rgba(168,85,247,0.65)' }],
              }}
              options={{
                indexAxis: 'y',
                maintainAspectRatio: false,
                onClick: (_, elements) => {
                  if (!elements.length) return
                  const idx = elements[0].index
                  const reel = topChats[idx]
                  if (reel) setSelectedReel(reel)
                },
                scales: {
                  x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                  y: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                },
                plugins: { legend: { display: false } },
              }}
            />
          </div>
        </div>
      ) : (
        <div className="glass-card p-5">
          <div className="mb-3 text-[12px] font-semibold">MAS COMPARTIDOS</div>
          <div className="h-80">
            <Bar
              data={{
                labels: topShares.map((r) => r.title),
                datasets: [{ label: 'Compartidos', data: topShares.map((r) => r.shares), backgroundColor: 'rgba(245,158,11,0.65)' }],
              }}
              options={{
                indexAxis: 'y',
                maintainAspectRatio: false,
                onClick: (_, elements) => {
                  if (!elements.length) return
                  const idx = elements[0].index
                  const reel = topShares[idx]
                  if (reel) setSelectedReel(reel)
                },
                scales: {
                  x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                  y: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                },
                plugins: { legend: { display: false } },
              }}
            />
          </div>
        </div>
      )}
      </div>

      {showBusinessMetrics && (
        <>
          <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            Distribución (top reels)
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="glass-card p-5">
              <div className="mb-3 text-[12px] font-semibold">Top por conversaciones</div>
              <div className="flex w-full max-w-sm flex-col mx-auto">
                {pieChatsSource.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-[12px] text-[var(--text3)]">
                    Sin chats registrados
                  </div>
                ) : (
                  <>
                    <div className="h-[200px] w-full">
                      <Pie
                        data={{
                          labels: pieChatsSource.map((r) => r.title),
                          datasets: [
                            {
                              data: pieChatsSource.map((r) => r.chats),
                              backgroundColor: pieChatsSource.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
                              borderWidth: 0,
                            },
                          ],
                        }}
                        options={pieOptions(
                          (idx) => {
                            const reel = pieChatsSource[idx]
                            if (reel) setSelectedReel(reel)
                          },
                          (raw) => ` ${Number(raw).toLocaleString('es-AR')} chats`,
                          { hideBuiltInLegend: true },
                        )}
                      />
                    </div>
                    <ScrollablePieLegend
                      items={pieChatsSource.map((r, i) => ({
                        label: r.title,
                        color: PIE_COLORS[i % PIE_COLORS.length],
                        sublabel: `${Number(r.chats).toLocaleString('es-AR')} chats`,
                      }))}
                      onItemClick={(idx) => {
                        const reel = pieChatsSource[idx]
                        if (reel) setSelectedReel(reel)
                      }}
                    />
                  </>
                )}
              </div>
            </div>
            <div className="glass-card p-5">
              <div className="mb-3 text-[12px] font-semibold">Top cash por chat</div>
              <div className="flex w-full max-w-sm flex-col mx-auto">
                {pieCpcSource.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-[12px] text-[var(--text3)]">
                    Sin cash por chat (necesitá chats y cash)
                  </div>
                ) : (
                  <>
                    <div className="h-[200px] w-full">
                      <Pie
                        data={{
                          labels: pieCpcSource.map((r) => r.title),
                          datasets: [
                            {
                              data: pieCpcSource.map((r) => r.cpc),
                              backgroundColor: pieCpcSource.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
                              borderWidth: 0,
                            },
                          ],
                        }}
                        options={pieOptions(
                          (idx) => {
                            const reel = pieCpcSource[idx]
                            if (reel) setSelectedReel(reel)
                          },
                          (raw) => ` ${formatCash(raw)}`,
                          { hideBuiltInLegend: true },
                        )}
                      />
                    </div>
                    <ScrollablePieLegend
                      items={pieCpcSource.map((r, i) => ({
                        label: r.title,
                        color: PIE_COLORS[i % PIE_COLORS.length],
                        sublabel: formatCash(r.cpc),
                      }))}
                      onItemClick={(idx) => {
                        const reel = pieCpcSource[idx]
                        if (reel) setSelectedReel(reel)
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {selectedReel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-[15px] font-semibold">{selectedReel.title}</div>
                <div className="mt-1 text-[11px] text-[var(--text3)]">
                  {formatDateDMY(selectedReel.publishedAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReel(null)}
                className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
              >
                Cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Vistas" value={selectedReel.views} />
              {ctaCountsAsReelConCta(selectedReel.cta) && (
                <MetricCard label="Chats" value={selectedReel.chats} />
              )}
              <MetricCard label="Comentarios" value={selectedReel.comments} />
              <MetricCard label="Likes" value={selectedReel.likes} />
              <MetricCard label="Compartidos" value={selectedReel.shares} />
              <KeywordCard value={selectedReel.keyword} />
              {(selectedReel.dolor || selectedReel.angulos || selectedReel.cta) && (
                <div className="col-span-2 rounded-lg border border-[var(--border2)] bg-[var(--bg4)] p-3">
                  <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Clasificación</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    {selectedReel.dolor && (
                      <span className="rounded-md bg-red-500/15 px-2 py-1 text-red-300">Dolor: {selectedReel.dolor}</span>
                    )}
                    {selectedReel.angulos && (
                      <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-200">Ángulo: {selectedReel.angulos}</span>
                    )}
                    {selectedReel.cta && (
                      <span className="rounded-md bg-violet-500/15 px-2 py-1 text-violet-200">CTA: {selectedReel.cta}</span>
                    )}
                  </div>
                </div>
              )}
              {ctaCountsAsReelConCta(selectedReel.cta) && (
                <div className="col-span-2 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
                    <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash</div>
                    <div className="font-mono-num mt-1 text-[18px] font-bold text-[var(--green)]">
                      {formatCash(selectedReel.cash)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
                    <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash por chat</div>
                    <div className="font-mono-num mt-1 text-[18px] font-bold text-[var(--text)]">
                      {formatCash(selectedReel.cpc)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {selectedReel.url && (
              <div className="mt-4">
                <a
                  href={selectedReel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex rounded-md bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white"
                >
                  Ver reel en Instagram
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CashRankCard({
  title,
  items,
  emptyHint,
}: {
  title: string
  items: { label: string; cash: number }[]
  emptyHint: string
}) {
  return (
    <div className="glass-card flex flex-col p-5">
      <div className="mb-3 text-[12px] font-semibold">{title}</div>
      <ul className="flex flex-col gap-2.5 text-[12px]">
        {items.length === 0 ? (
          <li className="text-[var(--text3)]">{emptyHint}</li>
        ) : (
          items.map((row, i) => (
            <li
              key={`${row.label}-${i}`}
              className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--text2)]" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 font-mono-num font-semibold tabular-nums text-[var(--green)]">
                {formatCash(row.cash)}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">{label}</div>
      <div className="font-mono-num mt-1 text-[18px] font-bold">{Number(value || 0).toLocaleString('es-AR')}</div>
    </div>
  )
}

function KeywordCard({ value }: { value: string | null }) {
  return (
    <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Keyword</div>
      <div className="mt-1 truncate font-mono text-[16px] font-bold">
        {value && value.trim() ? value : 'Sin keyword'}
      </div>
    </div>
  )
}

function yearInArgentina(d: Date): number | null {
  if (Number.isNaN(d.getTime())) return null
  const y = new Intl.DateTimeFormat('en', {
    timeZone: AR_TZ,
    year: 'numeric',
  }).format(d)
  const n = Number(y)
  return Number.isFinite(n) ? n : null
}

function formatDateDMY(value: string | null | undefined): string {
  if (!value) return 'Sin fecha'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: AR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}
