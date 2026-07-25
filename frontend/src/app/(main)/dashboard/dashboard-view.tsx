'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'
import { Line, Doughnut, Bar } from '@/shared/components/charts'
import { calcFunnel, type LeadRow } from '@/features/leads/services/leads-analytics'
import type { DashContentRow, DashData } from './dashboard-data-types'

// ── Custom Bar Chart ──
function CashBarChart({ labels, values, prevValues, activeIndex, onBarClick, compact }: {
  labels: string[]; values: number[]; prevValues: number[]; activeIndex: number
  onBarClick: (i: number) => void; compact?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const maxVal = Math.max(...values, ...prevValues, 1)
  const maxH = compact ? 100 : 130 // max bar height in px

  return (
    <div className="w-full">
      {/* Bar groups */}
      <div className="flex items-end" style={{ height: maxH + 24, gap: compact ? 2 : 8, padding: '0 4px' }}>
        {labels.map((label, i) => {
          const isActive = i === activeIndex
          const isHovered = i === hover
          const barH = values[i] > 0 ? Math.max(Math.round((values[i] / maxVal) * maxH), 8) : 0
          const prevH = prevValues[i] > 0 ? Math.max(Math.round((prevValues[i] / maxVal) * maxH), 6) : 0

          return (
            <div key={i} className="flex-1 cursor-pointer"
              onClick={() => onBarClick(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>

              {/* Value on top — shown on hover/active for all modes */}
              {(isActive || isHovered) && values[i] > 0 && (
                <div className="text-center text-[10px] font-mono-num font-bold mb-1 text-[var(--green)]">
                  {formatCash(values[i])}
                </div>
              )}
              {!((isActive || isHovered) && values[i] > 0) && <div style={{ height: 18 }} />}

              {/* Two bars side by side */}
              <div className="flex items-end gap-[3px]">
                <div className="flex-[3] rounded-t-[6px] transition-all duration-300"
                  style={{
                    height: barH,
                    background: isActive
                      ? 'linear-gradient(to top, #16A34A, #4ADE80)'
                      : isHovered
                        ? 'linear-gradient(to top, rgba(22,163,74,0.45), rgba(74,222,128,0.65))'
                        : 'linear-gradient(to top, rgba(22,163,74,0.15), rgba(74,222,128,0.3))',
                    boxShadow: isActive ? '0 2px 12px rgba(34,197,94,0.2)' : 'none',
                  }} />
                <div className="flex-1 rounded-t-[5px] transition-all duration-300"
                  style={{
                    height: prevH,
                    background: isActive || isHovered ? 'rgba(161,161,170,0.25)' : 'rgba(161,161,170,0.1)',
                  }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Labels */}
      {!compact ? (
        <div className="flex mt-2" style={{ gap: 8, padding: '0 4px' }}>
          {labels.map((label, i) => {
            const hasData = values[i] > 0
            const lit = (i === activeIndex || i === hover) && hasData
            return (
              <div key={i} className={`flex-1 text-center text-[10px] truncate cursor-pointer transition-all duration-200 ${lit && i === activeIndex ? 'text-[var(--green)] font-semibold' : lit ? 'text-[var(--green)]' : 'text-[var(--text3)]'}`}
                onClick={() => onBarClick(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {label}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex mt-1 px-1" style={{ gap: 2 }}>
          {labels.map((label, i) => {
            const hasData = values[i] > 0
            const lit = (i === activeIndex || i === hover) && hasData
            const show = i % Math.ceil(labels.length / 10) === 0 || i === labels.length - 1 || lit
            return (
              <div key={i} className="flex-1 text-center cursor-pointer"
                onClick={() => onBarClick(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {show && (
                  <span className={`text-[9px] transition-all duration-200 ${lit && i === activeIndex ? 'text-[var(--green)] font-semibold' : lit ? 'text-[var(--green)]' : 'text-[var(--text3)]'}`}>
                    {label}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type TypeformData = {
  total: number
  totalAll: number
  avgConviction: number
  programs: string[]
  data: Record<string, { label: string; count: number }[]>
}

type BioMetrics = {
  total_leads: number
  agendaron: number
  cash_total: number
  cash_por_chat: number
  tasa_respuesta_auto: number | null
}

function asFiniteNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Cash cobrado del lead (columna Pagó / `pago` en BD). No usar `revenue` / ingresos_lead (facturación). */
function leadCashCollected(l: LeadRow): number {
  return asFiniteNumber((l as Record<string, unknown>).payment)
}

/** CTA / texto típico de bio IG (botón Info, información, enlace en perfil). */
function textLooksLikeBioTraffic(s: string): boolean {
  const t = String(s || '').trim().toLowerCase()
  if (!t) return false
  /** Valor literal en CRM (ej. punto de agenda = bio). */
  if (t === 'bio') return true
  if (t.includes('información') || t.includes('informacion')) return true
  if (/\binfo\b/.test(t)) return true
  if ((t.includes('link') || t.includes('enlace')) && (t.includes('bio') || t.includes('biografía') || t.includes('perfil'))) return true
  if (t.includes('link en bio') || t.includes('link del perfil') || t.includes('desde perfil')) return true
  return false
}

/** Suma `amount` al bucket del día de publicación si cae en `year`–`month` (según fecha ISO YYYY-MM-DD). */
function addToMonthDayBucket(
  buckets: number[],
  year: number,
  month: number,
  publishedAt: string | undefined,
  amount: number,
) {
  if (!publishedAt || !amount) return
  const dayPart = String(publishedAt).slice(0, 10)
  const parts = dayPart.split('-')
  if (parts.length !== 3) return
  const py = Number(parts[0])
  const pm = Number(parts[1])
  const pd = Number(parts[2])
  if (py !== year || pm !== month || pd < 1 || pd > buckets.length) return
  buckets[pd - 1] += amount
}

function dashUserHeaders(userId: string): RequestInit {
  return { headers: { 'X-User-Id': userId } }
}

async function fetchReelsAsContent(monthKey: string, userId: string): Promise<DashContentRow[]> {
  const out: DashContentRow[] = []
  let page = 1
  const pageSize = 50
  for (;;) {
    const res = await apiFetch(
      `/reels?page=${page}&page_size=${pageSize}&month=${encodeURIComponent(monthKey)}`,
      dashUserHeaders(userId),
    )
    if (!res.ok) break
    const body = (await res.json().catch(() => ({}))) as {
      reels?: Array<{ cash?: number; chats?: number; published_at?: string | null }>
      total_pages?: number
    }
    const reels = body.reels ?? []
    for (const r of reels) {
      out.push({
        content_type: 'reel',
        cash: Number(r.cash) || 0,
        chats: Number(r.chats) || 0,
        published_at: r.published_at ? String(r.published_at) : '',
      })
    }
    const tp = Math.max(0, Number(body.total_pages) || 0)
    if (reels.length === 0) break
    if (tp > 0 && page >= tp) break
    if (reels.length < pageSize) break
    page += 1
  }
  return out
}

async function fetchStoriesAsContent(monthKey: string, userId: string): Promise<DashContentRow[]> {
  try {
    const res = await apiFetch(
      `/stories/sequences?month=${encodeURIComponent(monthKey)}`,
      dashUserHeaders(userId),
    )
    if (!res.ok) return []
    const body = await res.json().catch(() => null)
    if (!Array.isArray(body)) return []
    return body.map((s: { sequence_date?: string; cash_leads?: number; chats?: number }) => ({
      content_type: 'historia',
      /** Solo pagos en leads (pago); no cash_manual ni total generado. */
      cash: Number(s.cash_leads) || 0,
      chats: Number(s.chats) || 0,
      published_at: String(s.sequence_date || '').trim(),
    }))
  } catch {
    return []
  }
}

async function fetchYoutubeAsContent(monthKey: string, userId: string): Promise<DashContentRow[]> {
  const out: DashContentRow[] = []
  let page = 1
  const pageSize = 50
  for (;;) {
    const res = await apiFetch(
      `/youtube/videos?month=${encodeURIComponent(monthKey)}&page=${page}&page_size=${pageSize}`,
      dashUserHeaders(userId),
    )
    if (!res.ok) break
    const body = (await res.json().catch(() => ({}))) as {
      videos?: Array<{ cash?: number; chats?: number; published_at?: string | null }>
      total_pages?: number
    }
    const videos = body.videos ?? []
    for (const v of videos) {
      out.push({
        content_type: 'youtube',
        cash: Number(v.cash) || 0,
        chats: Number(v.chats) || 0,
        published_at: v.published_at ? String(v.published_at).trim() : '',
      })
    }
    const tp = Math.max(0, Number(body.total_pages) || 0)
    if (videos.length === 0) break
    if (tp > 0 && page >= tp) break
    if (videos.length < pageSize) break
    page += 1
  }
  return out
}

async function fetchLeadsForMonth(monthKey: string, userId: string): Promise<LeadRow[]> {
  try {
    const res = await apiFetch(`/leads?month=${encodeURIComponent(monthKey)}`, dashUserHeaders(userId))
    if (!res.ok) return []
    const body = (await res.json().catch(() => ({}))) as { leads?: unknown[] }
    return Array.isArray(body.leads) ? (body.leads as LeadRow[]) : []
  } catch {
    return []
  }
}

/** Todos los leads del mes (con y sin agendo) — conteos por origen / canal en dashboard marketing. */
async function fetchLeadsAllForMonth(monthKey: string, userId: string): Promise<LeadRow[]> {
  try {
    const res = await apiFetch(
      `/leads?month=${encodeURIComponent(monthKey)}&include_all=true`,
      dashUserHeaders(userId),
    )
    if (!res.ok) return []
    const body = (await res.json().catch(() => ({}))) as { leads?: unknown[] }
    return Array.isArray(body.leads) ? (body.leads as LeadRow[]) : []
  } catch {
    return []
  }
}

async function fetchTeamDashboardDaily(
  monthKey: string,
  userId: string,
): Promise<{ fecha: string; conversaciones: number }[]> {
  try {
    const res = await apiFetch(
      `/team/dashboard/daily?month=${encodeURIComponent(monthKey)}`,
      dashUserHeaders(userId),
    )
    if (!res.ok) return []
    const body = await res.json().catch(() => null)
    if (!Array.isArray(body)) return []
    return body
      .map((row: unknown) => {
        if (!row || typeof row !== 'object') return null
        const o = row as Record<string, unknown>
        const fecha = String(o.fecha ?? '').trim().slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
        return { fecha, conversaciones: asFiniteNumber(o.conversaciones) }
      })
      .filter((r): r is { fecha: string; conversaciones: number } => r !== null)
  } catch {
    return []
  }
}

/** Día usado para ubicar cash en vista diaria/semanal; debe coincidir con rawDailyCash/weeklyCash. */
function leadCashDayForFilter(l: LeadRow): string {
  for (const key of ['call_at'] as const) {
    const v = l[key]
    if (v == null || v === '') continue
    const s = String(v).trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  }
  return ''
}

/** Día de conversación del lead para atribuir chats en vista diaria/semanal. */
function leadChatDayForFilter(l: LeadRow): string {
  for (const key of ['fecha_bot', 'agendo', 'date'] as const) {
    const v = l[key]
    if (v == null || v === '') continue
    const s = String(v).trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  }
  return ''
}

function classifyLeadChatSource(l: LeadRow): 'Historias' | 'Reels' | 'Perfil' | 'YouTube' | 'Otros' {
  const url = String(l.content_url || '').toLowerCase()
  if (url.includes('/reel/') || url.includes('instagram.com/reel')) return 'Reels'
  const candidates = [
    l.agenda_point,
    l.entry_funnel,
    l.keyword,
    l.origin,
  ].map(v => String(v || '').trim().toLowerCase())
  for (const s of candidates) {
    if (!s) continue
    if (s.startsWith('story:') || s.includes('historia') || /\bstor(y|ies)\b/.test(s)) return 'Historias'
    if (s.includes('reel') || /^\d+$/.test(s)) return 'Reels'
    if (textLooksLikeBioTraffic(s) || s === 'perfil') return 'Perfil'
    if (s === 'youtube' || s.startsWith('youtube:')) return 'YouTube'
  }
  const origin = String(l.origin || '').trim().toLowerCase()
  if (origin === 'youtube') return 'YouTube'
  return 'Otros'
}

/** Calendario (año, mes, día) en una zona horaria IANA (uso: “hoy” = Argentina, alineado al backend). */
function calendarPartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
  const parts = dtf.formatToParts(date)
  const n = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  return { year: n('year'), month: n('month'), day: n('day') }
}

const AR_TZ = 'America/Argentina/Buenos_Aires'

function todayArgentinaParts(): { year: number; month: number; day: number } {
  return calendarPartsInTimeZone(new Date(), AR_TZ)
}

/** YYYY-MM-DD en calendario Argentina (ISO con hora → convierte; evita cortar UTC y desfasar un día). */
function publishedDateKey(publishedAt: string): string {
  const s = String(publishedAt || '').trim()
  if (!s) return ''
  const ms = Date.parse(s)
  if (!Number.isNaN(ms)) {
    const p = calendarPartsInTimeZone(new Date(ms), AR_TZ)
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

function contentInPublishedRange(c: { published_at: string }, start: string, end: string): boolean {
  const d = publishedDateKey(c.published_at)
  if (!d) return false
  return d >= start && d <= end
}

/** Suma `dailyChats` (setter por día) en el rango YYYY-MM-DD inclusive; `range` null = mes completo. */
function sumSetterConversacionesInRange(
  dailyChats: number[],
  range: { start: string; end: string } | null,
  year: number,
  month: number,
  daysInMonth: number,
): number {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (!range) {
    return dailyChats.reduce((a, b) => a + b, 0)
  }
  const { start, end } = range
  let sum = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${pad(month)}-${pad(d)}`
    if (ds >= start && ds <= end) sum += dailyChats[d - 1] || 0
  }
  return sum
}

type ChannelChats = {
  historias: number
  reels: number
  bio: number
  youtube: number
  otros: number
  total: number
}

function sumContentChats(content: DashContentRow[], type: string): number {
  return content
    .filter(c => c.content_type === type || (type === 'historia' && c.content_type === 'story'))
    .reduce((s, c) => s + c.chats, 0)
}

function countYoutubeOriginLeads(leads: LeadRow[]): number {
  return leads.filter(l => String(l.origin || '').trim().toLowerCase() === 'youtube').length
}

function countOtrosChatsFromLeads(leads: LeadRow[]): number {
  return leads.filter(l => classifyLeadChatSource(l) === 'Otros').length
}

function computeChannelChats(params: {
  viewRange: { start: string; end: string } | null
  viewContent: DashContentRow[]
  viewChatLeads: LeadRow[]
  monthMetrics: { reels: number; historias: number; bio: number; youtube: number; otros: number }
}): ChannelChats {
  const { viewRange, viewContent, viewChatLeads, monthMetrics } = params

  if (!viewRange) {
    const { reels, historias, bio, youtube, otros } = monthMetrics
    return {
      reels,
      historias,
      bio,
      youtube,
      otros,
      total: reels + historias + bio + youtube + otros,
    }
  }

  const reels = sumContentChats(viewContent, 'reel')
  const historias = sumContentChats(viewContent, 'historia')
  const bio = viewChatLeads.filter(l => classifyLeadChatSource(l) === 'Perfil').length
  const youtube = countYoutubeOriginLeads(viewChatLeads)
  const otros = countOtrosChatsFromLeads(viewChatLeads)

  return {
    reels,
    historias,
    bio,
    youtube,
    otros,
    total: reels + historias + bio + youtube + otros,
  }
}

async function fetchReelsMetricsChats(monthKey: string, userId: string): Promise<number> {
  try {
    const res = await apiFetch(
      `/reels/metrics?month=${encodeURIComponent(monthKey)}`,
      dashUserHeaders(userId),
    )
    if (!res.ok) return 0
    const body = (await res.json().catch(() => ({}))) as { chats_del_mes?: number }
    return Math.max(0, Number(body.chats_del_mes) || 0)
  } catch {
    return 0
  }
}

async function fetchStoriesMetricsChats(monthKey: string, userId: string): Promise<number> {
  try {
    const res = await apiFetch(
      `/stories/metrics?month=${encodeURIComponent(monthKey)}`,
      dashUserHeaders(userId),
    )
    if (!res.ok) return 0
    const body = (await res.json().catch(() => ({}))) as { chats_del_mes?: number }
    return Math.max(0, Number(body.chats_del_mes) || 0)
  } catch {
    return 0
  }
}

async function fetchBioMetricsLeads(
  monthKey: string,
  userId: string,
  apiBase: string,
): Promise<number> {
  try {
    const res = await fetch(`${apiBase}/api/bio/metrics?month=${encodeURIComponent(monthKey)}`, {
      headers: { 'X-User-Id': userId },
    })
    if (!res.ok) return 0
    const payload = (await res.json().catch(() => ({}))) as { total_leads?: number }
    return Math.max(0, Number(payload.total_leads) || 0)
  } catch {
    return 0
  }
}

function emptyDashForMonth(month: string): DashData {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const z = () => Array(daysInMonth).fill(0)
  return {
    cash: 0,
    prevCash: 0,
    prevCashAtDay: 0,
    chats: 0,
    prevChats: 0,
    reelsChats: 0,
    historiasChats: 0,
    bioChats: 0,
    youtubeChats: 0,
    otrosChats: 0,
    reelsChatsMetrics: 0,
    storiesChatsMetrics: 0,
    prevReelsChatsMetrics: 0,
    prevStoriesChatsMetrics: 0,
    prevBioChats: 0,
    prevYoutubeChats: 0,
    prevOtrosChats: 0,
    igCash: 0,
    ytCash: 0,
    refCash: 0,
    defCash: 0,
    bioCash: 0,
    historiasCash: 0,
    reelsCash: 0,
    dailyCash: z(),
    prevDailyCash: z(),
    rawDailyCash: z(),
    rawPrevDailyCash: z(),
    dailyChats: z(),
    dailyAgendas: z(),
    dailyCierres: z(),
    rawLeads: [],
    rawAllLeads: [],
    rawContent: [],
    rawBio: [],
    calls: [],
    programCounts: [],
    ventas: {
      cierres: 0,
      cashCollected: 0,
      ticketPromedio: 0,
      closeRate: 0,
      agendas: 0,
      leads: 0,
    },
  }
}

export default function DashboardPage() {
  const { month, options, setMonth } = useMonthContext()
  const { ready, userId } = useAuthUser()
  const [data, setData] = useState<DashData | null>(null)
  const [bioMetrics, setBioMetrics] = useState<BioMetrics | null>(null)
  const [view, setView] = useState<'mensual' | 'semanal' | 'diaria'>('mensual')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)   // 1-based day of month
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null) // 0-based week index
  const [typeform, setTypeform] = useState<TypeformData | null>(null)
  const [tfMonth, setTfMonth] = useState(month)
  const [tfProgram, setTfProgram] = useState<string>('')
  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

  const fetchData = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setData(emptyDashForMonth(month))
      return
    }

    const prev = getPrevMonth(month)

    let items: Record<string, unknown>[] = []
    let pItems: Record<string, unknown>[] = []
    let currLeads: LeadRow[] = []
    let currAllLeads: LeadRow[] = []
    let prevLeadsData: LeadRow[] = []
    let prevAllLeadsData: LeadRow[] = []
    const settled = await Promise.allSettled([
      fetchReelsAsContent(month, userId),
      fetchReelsAsContent(prev, userId),
      fetchLeadsForMonth(month, userId),
      fetchLeadsForMonth(prev, userId),
      fetchLeadsAllForMonth(month, userId),
      fetchLeadsAllForMonth(prev, userId),
      fetchTeamDashboardDaily(month, userId),
      fetchStoriesAsContent(month, userId),
      fetchYoutubeAsContent(month, userId),
      fetchStoriesAsContent(prev, userId),
      fetchYoutubeAsContent(prev, userId),
      fetchReelsMetricsChats(month, userId),
      fetchReelsMetricsChats(prev, userId),
      fetchStoriesMetricsChats(month, userId),
      fetchStoriesMetricsChats(prev, userId),
      fetchBioMetricsLeads(month, userId, apiBase),
      fetchBioMetricsLeads(prev, userId, apiBase),
    ])
    const currReelRows = settled[0].status === 'fulfilled' ? settled[0].value : []
    const prevReelRows = settled[1].status === 'fulfilled' ? settled[1].value : []
    currLeads = settled[2].status === 'fulfilled' ? settled[2].value : []
    prevLeadsData = settled[3].status === 'fulfilled' ? settled[3].value : []
    currAllLeads = settled[4].status === 'fulfilled' ? settled[4].value : []
    prevAllLeadsData = settled[5].status === 'fulfilled' ? settled[5].value : []
    const setterDailyRows = settled[6].status === 'fulfilled' ? settled[6].value : []
    const currStoryRows = settled[7].status === 'fulfilled' ? settled[7].value : []
    const currYtRows = settled[8].status === 'fulfilled' ? settled[8].value : []
    const prevStoryRows = settled[9].status === 'fulfilled' ? settled[9].value : []
    const prevYtRows = settled[10].status === 'fulfilled' ? settled[10].value : []
    const reelsChatsMetrics = settled[11].status === 'fulfilled' ? settled[11].value : 0
    const prevReelsChatsMetrics = settled[12].status === 'fulfilled' ? settled[12].value : 0
    const storiesChatsMetrics = settled[13].status === 'fulfilled' ? settled[13].value : 0
    const prevStoriesChatsMetrics = settled[14].status === 'fulfilled' ? settled[14].value : 0
    const bioChatsCount = settled[15].status === 'fulfilled' ? settled[15].value : 0
    const prevBioChatsCount = settled[16].status === 'fulfilled' ? settled[16].value : 0
    const currRows = [...currReelRows, ...currStoryRows, ...currYtRows]
    const prevRows = [...prevReelRows, ...prevStoryRows, ...prevYtRows]
    items = currRows as unknown as Record<string, unknown>[]
    pItems = prevRows as unknown as Record<string, unknown>[]

    const bio: Record<string, unknown>[] = []
    const def_: Record<string, unknown>[] = []
    const sum = (arr: Record<string, unknown>[], key: string) => arr.reduce((s, i) => s + (Number(i[key]) || 0), 0)
    const byType = (type: string) => items.filter((i: Record<string, unknown>) => i.content_type === type || (type === 'historia' && i.content_type === 'story'))

    const reelsChats = reelsChatsMetrics
    const historiasChats = storiesChatsMetrics
    const bioChats = bioChatsCount
    const youtubeChats = countYoutubeOriginLeads(currAllLeads)
    const otrosChats = countOtrosChatsFromLeads(currAllLeads)
    const chats = reelsChats + historiasChats + bioChats + youtubeChats + otrosChats

    // Leads (currLeads / prevLeadsData cargados arriba)
    const currFunnel = calcFunnel(currLeads)
    const prevFunnel = calcFunnel(prevLeadsData)

    const cashByOrigin = (leads: LeadRow[], channel: string) =>
      leads.filter(l => String(l.origin || '') === channel && leadCashCollected(l) > 0).reduce((s, l) => s + leadCashCollected(l), 0)
    const igCash = cashByOrigin(currLeads, 'Setter')
    const ytCash = cashByOrigin(currLeads, 'Youtube')
    const refCash = cashByOrigin(currLeads, 'Referido')
    const defCash = sum(def_, 'cash')
    const reelsCash = sum(byType('reel'), 'cash')
    const historiasCash = sum(byType('historia'), 'cash')
    const bioCash = sum(bio, 'cash')
    const paymentsCashTotal = currFunnel.ingresos + defCash

    const leadCashTotal = paymentsCashTotal
    const contentCashTotal = reelsCash + historiasCash + bioCash
    const cash = leadCashTotal > 0 ? leadCashTotal : contentCashTotal

    const byTypePrev = (type: string) =>
      pItems.filter((i: Record<string, unknown>) => i.content_type === type || (type === 'historia' && i.content_type === 'story'))
    const prevReelsCash = sum(byTypePrev('reel'), 'cash')
    const prevHistoriasCash = sum(byTypePrev('historia'), 'cash')
    const prevBioCash = 0
    const prevLeadCash = prevFunnel.ingresos
    const prevContentCash = prevReelsCash + prevHistoriasCash + prevBioCash
    const prevCash = prevLeadCash > 0 ? prevLeadCash : prevContentCash
    const prevYoutubeChats = countYoutubeOriginLeads(prevAllLeadsData)
    const prevOtrosChats = countOtrosChatsFromLeads(prevAllLeadsData)
    const prevChats =
      prevReelsChatsMetrics + prevStoriesChatsMetrics + prevBioChatsCount + prevYoutubeChats + prevOtrosChats

    // Daily cash from leads (by payment date or call_at)
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const [py, pm] = prev.split('-').map(Number)
    const dailyCash = Array(daysInMonth).fill(0)
    const prevDailyCash = Array(daysInMonth).fill(0)

    currLeads.filter(l => leadCashCollected(l) > 0).forEach(l => {
      const d = leadCashDayForFilter(l)
      if (d) { const day = new Date(String(d)).getDate(); if (day >= 1 && day <= daysInMonth) dailyCash[day - 1] += leadCashCollected(l) }
    })
    if (paymentsCashTotal <= 0) {
      items.forEach((row: Record<string, unknown>) => {
        addToMonthDayBucket(dailyCash, y, m, String(row.published_at || ''), Number(row.cash) || 0)
      })
    }
    const rawDailyCash = [...dailyCash]
    for (let i = 1; i < dailyCash.length; i++) dailyCash[i] += dailyCash[i - 1]

    prevLeadsData.filter(l => leadCashCollected(l) > 0).forEach(l => {
      const d = leadCashDayForFilter(l)
      if (d) { const day = new Date(String(d)).getDate(); if (day >= 1 && day <= daysInMonth) prevDailyCash[day - 1] += leadCashCollected(l) }
    })
    if (prevLeadCash <= 0) {
      pItems.forEach((row: Record<string, unknown>) => {
        addToMonthDayBucket(prevDailyCash, py, pm, String(row.published_at || ''), Number(row.cash) || 0)
      })
    }
    const rawPrevDailyCash = [...prevDailyCash]
    for (let i = 1; i < prevDailyCash.length; i++) prevDailyCash[i] += prevDailyCash[i - 1]

    const arNow = todayArgentinaParts()
    const prevCashAtDay = prevDailyCash[Math.min(arNow.day - 1, prevDailyCash.length - 1)] || 0

    // Calls report — fecha de llamada agendada (call_at legacy o scheduled_at / columna call en BD)
    const calls = currLeads
      .filter(l => l.call_at || l.scheduled_at)
      .map(l => ({
        id: String(l.id || ''),
        date: String(l.call_at || l.scheduled_at || ''),
        name: String(l.client_name || ''),
        revenue: Number(l.revenue) || 0, payment: Number(l.payment) || 0,
        program: String(l.program_offered || ''),
        closer: String(l.closer || ''), setter: String(l.setter || ''),
        status: String(l.status || ''), callLink: String(l.call_link || ''),
        closerReport: String(l.closer_report || ''), igHandle: String(l.ig_handle || ''),
        phone: String(l.phone || ''), entryChannel: String(l.origin || l.agendo_en || ''),
        notes: String(l.notes || ''),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    // Program counts
    const progMap: Record<string, number> = {}
    currLeads.filter(l => l.status === 'Cerrado' && l.program_offered).forEach(l => {
      const p = String(l.program_offered)
      progMap[p] = (progMap[p] || 0) + 1
    })
    const programCounts = Object.entries(progMap).map(([program, count]) => ({ program, count })).sort((a, b) => b.count - a.count)

    // Conversaciones por día (setter) — GET /api/team/dashboard/daily
    const dailyChats = Array(daysInMonth).fill(0)
    for (const row of setterDailyRows) {
      const parts = row.fecha.split('-')
      if (parts.length !== 3) continue
      const py = Number(parts[0])
      const pm = Number(parts[1])
      const pd = Number(parts[2])
      if (py !== y || pm !== m || pd < 1 || pd > daysInMonth) continue
      dailyChats[pd - 1] += row.conversaciones
    }
    const dailyAgendas = Array(daysInMonth).fill(0)
    const dailyCierres = Array(daysInMonth).fill(0)

    setData({
      cash, prevCash, prevCashAtDay, chats, prevChats,
      reelsChats, historiasChats, bioChats, youtubeChats, otrosChats,
      reelsChatsMetrics, storiesChatsMetrics,
      prevReelsChatsMetrics, prevStoriesChatsMetrics,
      prevBioChats: prevBioChatsCount, prevYoutubeChats, prevOtrosChats,
      igCash, ytCash, refCash, defCash, bioCash, historiasCash, reelsCash,
      dailyCash, prevDailyCash, rawDailyCash, rawPrevDailyCash,
      dailyChats, dailyAgendas, dailyCierres,
      rawLeads: currLeads,
      rawAllLeads: currAllLeads,
      rawContent: items.map((i: Record<string, unknown>) => ({ content_type: String(i.content_type), cash: Number(i.cash) || 0, chats: Number(i.chats) || 0, published_at: String(i.published_at || '') })),
      rawBio: bio.map((b: Record<string, unknown>) => ({ cash: Number(b.cash) || 0, chats: Number(b.chats) || 0 })),
      calls, programCounts,
      ventas: {
        cierres: currFunnel.cierres,
        cashCollected: cash,
        ticketPromedio: currFunnel.ticketPromedio,
        closeRate: currFunnel.closeRate,
        agendas: currFunnel.agendas,
        leads: currLeads.length,
      },
    })
  }, [month, ready, userId, apiBase])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (!ready || !userId) return
    const loadBioMetrics = async () => {
      try {
        const res = await fetch(`${apiBase}/api/bio/metrics?month=${encodeURIComponent(month)}`, {
          headers: { 'X-User-Id': userId },
        })
        const txt = await res.text()
        const payload = (() => {
          try { return txt ? JSON.parse(txt) : {} } catch { return {} }
        })() as Partial<BioMetrics>
        if (!res.ok) {
          setBioMetrics(null)
          return
        }
        setBioMetrics({
          total_leads: asFiniteNumber(payload.total_leads),
          agendaron: asFiniteNumber(payload.agendaron),
          cash_total: asFiniteNumber(payload.cash_total),
          cash_por_chat: asFiniteNumber(payload.cash_por_chat),
          tasa_respuesta_auto:
            payload.tasa_respuesta_auto === null || payload.tasa_respuesta_auto === undefined
              ? null
              : asFiniteNumber(payload.tasa_respuesta_auto),
        })
      } catch {
        setBioMetrics(null)
      }
    }
    loadBioMetrics()
  }, [apiBase, month, ready, userId])
  useEffect(() => { setTfMonth(month); setTfProgram(''); setSelectedDay(null); setSelectedWeek(null) }, [month])
  useEffect(() => {
    setTypeform(null)
    const params = new URLSearchParams({ month: tfMonth })
    if (tfProgram) params.set('programa', tfProgram)
    fetch(`/api/typeform?${params}`).then(r => r.json()).then(d => { if (d.data) setTypeform(d) }).catch(() => {})
  }, [tfMonth, tfProgram])

  // Custom tooltip for line chart — refs MUST be before early return
  const chartTooltipRef = useRef<HTMLDivElement>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const tooltipDataRef = useRef<{ dayIndex: number } | null>(null)

  if (!data) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  const dashData = data
  const bioDisplay = bioMetrics

  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()

  const arToday = todayArgentinaParts()
  const isMonthCurrent = arToday.year === y && arToday.month === m
  const dayNow = isMonthCurrent ? arToday.day : daysInMonth

  // Chart data
  const sparkDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const sparkCurrent = sparkDays.map((d, i) => d <= dayNow ? dashData.dailyCash[i] || 0 : null)
  const sparkPrev = dashData.prevDailyCash

  const cashTrend = dashData.prevCashAtDay > 0 ? ((dashData.cash - dashData.prevCashAtDay) / dashData.prevCashAtDay * 100) : 0

  // Weekly aggregation
  const weeksCount = Math.ceil(daysInMonth / 7)
  const weeklyLabels: string[] = []
  const weeklyCash: number[] = []
  const weeklyPrevCash: number[] = []
  for (let w = 0; w < weeksCount; w++) {
    const s = w * 7; const e = Math.min(s + 7, daysInMonth)
    weeklyLabels.push(`S${w + 1} (${s + 1}-${e})`)
    let wc = 0, wp = 0
    for (let d = s; d < e; d++) { wc += dashData.rawDailyCash[d] || 0; wp += dashData.rawPrevDailyCash[d] || 0 }
    weeklyCash.push(wc); weeklyPrevCash.push(wp)
  }

  const weeklyConversaciones: number[] = []
  for (let w = 0; w < weeksCount; w++) {
    const s = w * 7
    const e = Math.min(s + 7, daysInMonth)
    let conv = 0
    for (let d = s; d < e; d++) conv += dashData.dailyChats[d] || 0
    weeklyConversaciones.push(conv)
  }

  // Current week index (franjas 1–7, 8–14, … del mes seleccionado)
  const currentWeekIdx = Math.min(Math.floor((dayNow - 1) / 7), weeksCount - 1)

  const weekGroups = (() => {
    const groups: { startDay: number; endDay: number }[] = []
    for (let i = 1; i <= daysInMonth; i += 7) {
      groups.push({ startDay: i, endDay: Math.min(i + 6, daysInMonth) })
    }
    return groups
  })()

  const padYm = (n: number) => String(n).padStart(2, '0')

  const countPiecesInWeekIdx = (wi: number) => {
    const wg = weekGroups[wi]
    if (!wg) return 0
    const startStr = `${y}-${padYm(m)}-${padYm(wg.startDay)}`
    const endStr = `${y}-${padYm(m)}-${padYm(wg.endDay)}`
    return dashData.rawContent.filter(c => contentInPublishedRange(c, startStr, endStr)).length
  }

  const setterSumInWeekIdx = (wi: number) => {
    const wg = weekGroups[wi]
    if (!wg) return 0
    const startStr = `${y}-${padYm(m)}-${padYm(wg.startDay)}`
    const endStr = `${y}-${padYm(m)}-${padYm(wg.endDay)}`
    return sumSetterConversacionesInRange(
      dashData.dailyChats,
      { start: startStr, end: endStr },
      y,
      m,
      daysInMonth,
    )
  }

  const weekHasActivity = (wi: number) =>
    setterSumInWeekIdx(wi) > 0 || countPiecesInWeekIdx(wi) > 0 || (weeklyCash[wi] || 0) > 0

  /**
   * Sin semana elegida en el gráfico: la franja que contiene “hoy” en AR.
   * Si esa franja no tiene ni conversaciones setter ni piezas en el mes, pasamos a la última franja con datos (típico: semana 1–7 con reels/reportes y semana 8–14 aún vacía).
   */
  const semanalWeekIdxDefault =
    view === 'semanal'
      ? (() => {
          let w = Math.min(Math.max(0, currentWeekIdx), Math.max(0, weekGroups.length - 1))
          if (weekHasActivity(w)) return w
          for (let i = w - 1; i >= 0; i--) {
            if (weekHasActivity(i)) return i
          }
          for (let i = w + 1; i < weekGroups.length; i++) {
            if (weekHasActivity(i)) return i
          }
          return w
        })()
      : currentWeekIdx

  const effectiveSemanalWeekIdx =
    view === 'semanal'
      ? selectedWeek !== null
        ? Math.min(Math.max(0, selectedWeek), Math.max(0, weekGroups.length - 1))
        : semanalWeekIdxDefault
      : currentWeekIdx

  const effectiveDiariaDay =
    view === 'diaria' ? (selectedDay !== null ? selectedDay : dayNow) : dayNow

  const viewRange: { start: string; end: string; day?: number; weekIdx?: number } | null = (() => {
    if (view === 'diaria') {
      const day = effectiveDiariaDay
      const dayStr = `${y}-${padYm(m)}-${padYm(day)}`
      return { start: dayStr, end: dayStr, day }
    }
    if (view === 'semanal') {
      const wIdx = effectiveSemanalWeekIdx
      const wg = weekGroups[wIdx]
      if (!wg) return null
      return {
        start: `${y}-${padYm(m)}-${padYm(wg.startDay)}`,
        end: `${y}-${padYm(m)}-${padYm(wg.endDay)}`,
        weekIdx: wIdx,
      }
    }
    return null
  })()
  const viewSetterConversacionesSum = sumSetterConversacionesInRange(
    dashData.dailyChats,
    viewRange,
    y,
    m,
    daysInMonth,
  )
  const viewCashLeads = viewRange
    ? dashData.rawLeads.filter(l => {
        const d = leadCashDayForFilter(l)
        return d.length >= 10 && d >= viewRange.start && d <= viewRange.end
      })
    : dashData.rawLeads
  const viewChatLeads = viewRange
    ? dashData.rawAllLeads.filter(l => {
        const d = leadChatDayForFilter(l)
        return d.length >= 10 && d >= viewRange.start && d <= viewRange.end
      })
    : dashData.rawAllLeads

  // Origen del cash: la tabla leads es la fuente de verdad y el campo punto_agenda define la atribución.
  const classifyLeadCashSource = (l: LeadRow): string => {
    const ap = String(l.agenda_point || '').trim().toLowerCase()
    if (!ap) return 'Otros'
    if (ap.startsWith('youtube:')) return 'YouTube'
    if (ap.startsWith('story:') || ap.includes('historia') || /\bstor(y|ies)\b/.test(ap)) return 'Historias'
    if (ap.includes('reel') || /^\d+$/.test(ap)) return 'Reels'
    if (textLooksLikeBioTraffic(ap) || ap === 'perfil') return 'Perfil'
    if (ap === 'referido' || ap.startsWith('referido')) return 'Referidos'
    return 'Otros'
  }

  const viewCashBySource = (source: string) =>
    viewCashLeads
      .filter(l => classifyLeadCashSource(l) === source && leadCashCollected(l) > 0)
      .reduce((s, l) => s + leadCashCollected(l), 0)

  const viewHistoriasCashFromLeads = viewCashBySource('Historias')
  const viewReelsCashFromLeads = viewCashBySource('Reels')
  const viewPerfilCash = viewCashBySource('Perfil')
  const viewYtCash = viewCashBySource('YouTube')
  const viewRefCash = viewCashBySource('Referidos')
  const viewOtrosCash = viewCashBySource('Otros')

  const viewCalls = viewRange
    ? dashData.calls.filter(c => { const d = c.date.split('T')[0]; return d >= viewRange.start && d <= viewRange.end })
    : dashData.calls

  // Filter content by published_at date
  const viewContent = viewRange
    ? dashData.rawContent.filter(c => contentInPublishedRange(c, viewRange.start, viewRange.end))
    : dashData.rawContent
  const viewBio = viewRange ? [] : dashData.rawBio // bio has no daily dates

  const channelChats = computeChannelChats({
    viewRange,
    viewContent,
    viewChatLeads,
    monthMetrics: {
      reels: dashData.reelsChatsMetrics,
      historias: dashData.storiesChatsMetrics,
      bio: bioDisplay?.total_leads ?? dashData.bioChats,
      youtube: dashData.youtubeChats,
      otros: dashData.otrosChats,
    },
  })

  const viewReelsChats = channelChats.reels
  const viewHistoriasChats = channelChats.historias
  const viewBioChats = channelChats.bio
  const viewYoutubeChats = channelChats.youtube
  const viewOtrosChats = channelChats.otros
  const viewTotalChats = channelChats.total

  const viewReelsCash = viewContent.filter(c => c.content_type === 'reel').reduce((s, c) => s + c.cash, 0)
  const viewHistoriasCash = viewContent.filter(c => c.content_type === 'historia' || c.content_type === 'story').reduce((s, c) => s + c.cash, 0)
  const viewBioCashFromSupabase = viewBio.reduce((s, b) => s + b.cash, 0)
  const viewBioCash = (!viewRange && viewBioCashFromSupabase <= 0 && bioDisplay)
    ? asFiniteNumber(bioDisplay.cash_total)
    : asFiniteNumber(viewBioCashFromSupabase)

  const leadPayInView = viewCashLeads.filter(l => leadCashCollected(l) > 0).reduce((s, l) => s + leadCashCollected(l), 0)
  const defPart = viewRange ? 0 : dashData.defCash
  const fromLeadsCash = leadPayInView + defPart
  /** Este bloque muestra cash de leads; seguimiento se carga aparte y no se suma aca. */
  const viewCash = !viewRange ? dashData.cash : fromLeadsCash

  // View period label
  const viewLabel = (() => {
    if (view === 'diaria') {
      return `Dia ${effectiveDiariaDay}`
    }
    if (view === 'semanal') {
      const wIdx = effectiveSemanalWeekIdx
      const wg = weekGroups[wIdx]
      if (wg) return `Semana ${wIdx + 1} (${wg.startDay}-${wg.endDay})`
      return ''
    }
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    return `${monthNames[m - 1]} ${y}`
  })()

  // Donut: atribución por lead + fallback piezas. Evita duplicar BIO (CRM) vs el mismo pago en Otros; encaja el total al cash cobrado del período.
  const vfBio = asFiniteNumber(viewBioCash)
  const vfPerfilLeads = asFiniteNumber(viewPerfilCash)

  let donutHistoriasVal = viewHistoriasCashFromLeads || (!viewRange ? viewHistoriasCash : 0)
  let donutReelsVal = viewReelsCashFromLeads || (!viewRange ? viewReelsCash : 0)
  let donutPerfilVal = vfPerfilLeads > 0 ? vfPerfilLeads : vfBio
  let donutOtrosVal = asFiniteNumber(viewOtrosCash)
  /** Mismo cobro contado como BIO (métricas) y como Otros (clasificación de lead). */
  if (vfPerfilLeads <= 0 && vfBio > 0) {
    donutOtrosVal = Math.max(0, donutOtrosVal - vfBio)
  }
  let donutYtVal = asFiniteNumber(viewYtCash)
  let donutRefVal = asFiniteNumber(viewRefCash)

  let rawDonutSum =
    donutHistoriasVal + donutReelsVal + donutPerfilVal + donutYtVal + donutRefVal + donutOtrosVal
  const cashCap = viewCash > 0 ? viewCash : rawDonutSum
  if (rawDonutSum > cashCap + 0.01 && rawDonutSum > 0) {
    const sc = cashCap / rawDonutSum
    donutHistoriasVal *= sc
    donutReelsVal *= sc
    donutPerfilVal *= sc
    donutYtVal *= sc
    donutRefVal *= sc
    donutOtrosVal *= sc
    rawDonutSum = cashCap
  }

  const viewDonutTotal = rawDonutSum
  const donutSources = [
    { label: 'Historias', value: donutHistoriasVal, color: '#F59E0B' },
    { label: 'Reels', value: donutReelsVal, color: '#3B82F6' },
    { label: 'BIO', value: donutPerfilVal, color: '#8B5CF6' },
    { label: 'YouTube', value: donutYtVal, color: '#FF0000' },
    { label: 'Referidos', value: donutRefVal, color: '#22C55E' },
    { label: 'Otros', value: donutOtrosVal, color: '#6B7280' },
  ].filter(s => s.value > 0)

  const chatsSources = [
    { label: 'Historias', value: viewHistoriasChats, color: '#F59E0B', prevLabel: 'HISTORIAS' },
    { label: 'Reels', value: viewReelsChats, color: '#EF4444', prevLabel: 'REELS' },
    { label: 'BIO', value: viewBioChats, color: '#A855F7', prevLabel: 'BIO' },
    { label: 'YouTube', value: viewYoutubeChats, color: '#FF0000', prevLabel: 'YOUTUBE' },
    { label: 'Otros', value: viewOtrosChats, color: '#6B7280', prevLabel: 'OTROS' },
  ]

  // Cash por chat — cash del donut de origen; YouTube separado de Otros
  const viewBioCashReal = donutPerfilVal
  const reelCashForCpc = donutReelsVal
  const histCashForCpc = asFiniteNumber(donutHistoriasVal)
  const ytCashForCpc = asFiniteNumber(viewYtCash)
  const otrosCashForCpc = asFiniteNumber(donutRefVal + donutOtrosVal)
  const cpcReel = viewReelsChats > 0 ? reelCashForCpc / viewReelsChats : 0
  const cpcHistoria = viewHistoriasChats > 0 ? histCashForCpc / viewHistoriasChats : 0
  const cpcBio = viewBioChats > 0 ? asFiniteNumber(viewBioCashReal / viewBioChats) : 0
  const cpcYoutube = viewYoutubeChats > 0 ? asFiniteNumber(ytCashForCpc / viewYoutubeChats) : 0
  const cpcOtros = viewOtrosChats > 0 ? asFiniteNumber(otrosCashForCpc / viewOtrosChats) : 0

  const kpiConversaciones = viewSetterConversacionesSum
  const kpiReelsPublicados = viewContent.filter(c => c.content_type === 'reel').length
  const kpiHistoriasPublicadas = viewContent.filter(c => c.content_type === 'historia' || c.content_type === 'story').length
  const kpiYoutubePublicados = viewContent.filter(c => c.content_type === 'youtube').length
  const kpiTotalChats = viewTotalChats
  const kpiLeadPagoTotal = viewCashLeads.reduce((s, l) => s + leadCashCollected(l), 0)
  /** Σ Lead.pago del período ÷ total chats por canal (historias + reels + bio + youtube + otros). */
  const kpiCashPorChat =
    kpiTotalChats > 0 ? asFiniteNumber(kpiLeadPagoTotal / kpiTotalChats) : 0

  return (
    <div>
      {/* Header with tabs + month selector */}
      <div className="mb-6 flex items-center justify-between">
        <div className="segment-group">
          {(['mensual', 'semanal', 'diaria'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`segment-tab ${view === v ? 'segment-tab-active' : ''}`}
            >
              {v === 'mensual' ? 'MENSUAL' : v === 'semanal' ? 'SEMANAL' : 'DIARIO'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector month={month} options={options} onChange={setMonth} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Chats del mes</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{kpiTotalChats.toLocaleString('es-AR')}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Conversaciones</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{kpiConversaciones}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Reels publicados</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{kpiReelsPublicados}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Secuencia de historias publicadas</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{kpiHistoriasPublicadas}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Videos YouTube publicados</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{kpiYoutubePublicados}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Cash por chat</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatCash(kpiCashPorChat)}</div>
        </div>
      </div>

      {/* Row 1: Cash Collected + Origen del Cash */}
      <div className="grid grid-cols-5 gap-4 mb-4">
        {/* Cash Collected — 3 cols */}
        <div className="col-span-3 glass-card p-6 pb-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="font-mono-num text-[42px] font-bold text-[var(--green)] leading-none">{formatCash(viewCash)}</div>
              <div className="text-[11px] text-[var(--text3)] mt-1.5">{viewLabel}</div>
            </div>
            <div className="text-right flex flex-col items-end gap-1">
              {view === 'mensual' && (
                <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${cashTrend >= 0 ? 'bg-[rgba(34,197,94,0.1)] text-[var(--green)]' : 'bg-[var(--accent-faint)] text-[var(--text2)]'}`}>
                  {cashTrend >= 0 ? '▲' : '▼'} {Math.abs(cashTrend).toFixed(0)}%
                </div>
              )}
              {view !== 'mensual' && (
                <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">{view === 'diaria' ? 'Cash por dia' : 'Cash por semana'}</div>
              )}
            </div>
          </div>

          {/* Chart */}
          {view === 'mensual' && (
            <div className="mb-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div
                className="relative h-36 rounded-xl border border-[var(--border)] bg-[var(--bg4)]/25 p-1"
                ref={chartContainerRef}
                onMouseLeave={() => { if (chartTooltipRef.current) chartTooltipRef.current.style.opacity = '0' }}
              >
                <Line data={{
                  labels: sparkDays.map(d => String(d)),
                  datasets: [
                    { data: sparkCurrent as (number | null)[], borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.08)', fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#22C55E', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 },
                    { data: sparkPrev, borderColor: 'rgba(161,161,170,0.4)', borderDash: [5, 5], fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1.5 },
                  ],
                }} options={{
                  responsive: true, maintainAspectRatio: false,
                  scales: { x: { display: false }, y: { display: false } },
                  plugins: {
                    tooltip: {
                      enabled: false,
                      external: (context: { tooltip: { opacity: number; dataPoints?: { dataIndex: number }[]; caretX: number; caretY: number } }) => {
                        const el = chartTooltipRef.current
                        if (!el) return
                        const { tooltip } = context
                        if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
                          el.style.opacity = '0'; return
                        }
                        const i = tooltip.dataPoints[0].dataIndex
                        const left = tooltip.caretX > 400 ? tooltip.caretX - 200 : tooltip.caretX + 16
                        el.style.opacity = '1'
                        el.style.left = `${left}px`
                        el.style.top = `${Math.max(0, tooltip.caretY - 60)}px`
                        if (tooltipDataRef.current?.dayIndex !== i) {
                          tooltipDataRef.current = { dayIndex: i }
                          const cc = dashData.rawDailyCash[i] || 0
                          const chats = dashData.dailyChats[i] || 0
                          const agendas = dashData.dailyAgendas[i] || 0
                          const cierres = dashData.dailyCierres[i] || 0
                          el.innerHTML = `
                          <div class="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(8,8,12,0.96)] px-5 py-4 shadow-2xl backdrop-blur-sm" style="box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.05)">
                            <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:12px">Día ${i + 1}</div>
                            <div style="display:flex;flex-direction:column;gap:10px">
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#4ADE80">Cash collected</span><span style="font-size:13px;font-weight:700;color:#4ADE80;font-variant-numeric:tabular-nums">${formatCash(cc)}</span></div>
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#60A5FA">Chats</span><span style="font-size:13px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums">${chats}</span></div>
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#FBBF24">Agendas</span><span style="font-size:13px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums">${agendas}</span></div>
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#a1a1aa">Cierres</span><span style="font-size:13px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums">${cierres}</span></div>
                            </div>
                          </div>`
                        }
                      },
                    },
                    legend: { display: false },
                  },
                  interaction: { intersect: false, mode: 'index' as const },
                }} />
                <div ref={chartTooltipRef} className="absolute z-50 pointer-events-none transition-opacity duration-150" style={{ opacity: 0 }} />
              </div>
              <div className="flex h-36 flex-col rounded-xl border border-[var(--border)] bg-[var(--bg4)]/30 p-2">
                <div className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
                  Conversaciones por día
                </div>
                <div className="relative min-h-0 flex-1 w-full">
                  <Bar
                    data={{
                      labels: sparkDays.map(d => String(d)),
                      datasets: [
                        {
                          label: 'Conversaciones',
                          data: dashData.dailyChats,
                          backgroundColor: 'rgba(34,197,94,0.32)',
                          borderColor: 'rgba(34,197,94,0.75)',
                          borderWidth: 1,
                          borderRadius: 6,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: 'rgba(255,255,255,0.96)',
                          titleColor: '#0f172a',
                          bodyColor: '#334155',
                          borderColor: 'rgba(148,163,184,0.35)',
                          borderWidth: 1,
                          padding: 10,
                          cornerRadius: 8,
                        },
                      },
                      scales: {
                        x: {
                          ticks: { color: '#64748b', maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 9 } },
                          grid: { color: 'rgba(148,163,184,0.22)' },
                        },
                        y: {
                          beginAtZero: true,
                          ticks: { color: '#64748b', font: { size: 9 } },
                          grid: { color: 'rgba(148,163,184,0.18)' },
                        },
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {(view === 'semanal' || view === 'diaria') && (
            <div className="mb-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg4)]/30 p-2">
                {view === 'diaria' ? (
                  <CashBarChart
                    labels={sparkDays.map(d => String(d))}
                    values={sparkDays.map((d, i) => d <= dayNow ? dashData.rawDailyCash[i] || 0 : 0)}
                    prevValues={dashData.rawPrevDailyCash}
                    activeIndex={effectiveDiariaDay - 1}
                    onBarClick={(i) => { if (i + 1 <= dayNow) setSelectedDay(i + 1) }}
                    compact
                  />
                ) : (
                  <CashBarChart
                    labels={weeklyLabels}
                    values={weeklyCash}
                    prevValues={weeklyPrevCash}
                    activeIndex={effectiveSemanalWeekIdx}
                    onBarClick={(i) => setSelectedWeek(i)}
                  />
                )}
              </div>
              <div className="flex h-36 flex-col rounded-xl border border-[var(--border)] bg-[var(--bg4)]/30 p-2">
                <div className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
                  {view === 'diaria' ? 'Conversaciones por día' : 'Conversaciones por semana'}
                </div>
                <div className="relative min-h-0 flex-1 w-full">
                  <Bar
                    data={{
                      labels: view === 'diaria' ? sparkDays.map(String) : weeklyLabels,
                      datasets: [
                        {
                          label: 'Conversaciones',
                          data: view === 'diaria' ? dashData.dailyChats : weeklyConversaciones,
                          backgroundColor: 'rgba(34,197,94,0.32)',
                          borderColor: 'rgba(34,197,94,0.75)',
                          borderWidth: 1,
                          borderRadius: 6,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: 'rgba(255,255,255,0.96)',
                          titleColor: '#0f172a',
                          bodyColor: '#334155',
                          borderColor: 'rgba(148,163,184,0.35)',
                          borderWidth: 1,
                          padding: 10,
                          cornerRadius: 8,
                        },
                      },
                      scales: {
                        x: {
                          ticks: {
                            color: '#64748b',
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: view === 'diaria' ? 8 : 12,
                            font: { size: 9 },
                          },
                          grid: { color: 'rgba(148,163,184,0.22)' },
                        },
                        y: {
                          beginAtZero: true,
                          ticks: { color: '#64748b', font: { size: 9 } },
                          grid: { color: 'rgba(148,163,184,0.18)' },
                        },
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-5 text-[11px] mt-3 pt-3 border-t border-[var(--border)]">
            {view === 'mensual' ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-[2px] w-5 rounded-full bg-[#22C55E]" />
                  <span className="text-[var(--text3)]">Actual</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-[2px] w-5 rounded-full" style={{ background: 'repeating-linear-gradient(90deg, #71717A 0 4px, transparent 4px 8px)' }} />
                  <span className="text-[var(--text3)]">Anterior</span>
                  <span className={`font-mono-num font-medium ${cashTrend >= 0 ? 'text-[var(--green)]' : 'text-[var(--text2)]'}`}>{formatCash(dashData.prevCashAtDay)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-2 rounded-sm bg-[var(--green)]" />
                  <span className="text-[var(--text3)]">Actual</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-2 rounded-sm bg-[rgba(82,82,91,0.4)]" />
                  <span className="text-[var(--text3)]">Anterior</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Origen del Cash — 2 cols */}
        <div className="col-span-2 glass-card p-6">
          <div className="text-[10px] text-[var(--text3)]">Distribucion del ingreso</div>
          <div className="text-[12px] font-semibold text-[var(--text)] mb-4">ORIGEN DEL CASH</div>
          <div className="flex items-center justify-center mb-4">
            <div className="relative w-44 h-44 -m-2" style={{ isolation: 'isolate', zIndex: 1, padding: 12 }}>
              <Doughnut data={{
                labels: donutSources.map(s => s.label),
                datasets: [{ data: donutSources.length > 0 ? donutSources.map(s => s.value) : [1], backgroundColor: donutSources.length > 0 ? donutSources.map(s => s.color) : ['#1E1E22'], borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: 'rgba(255,255,255,0.3)', hoverOffset: 6 }],
              }} options={{ responsive: true, maintainAspectRatio: true, cutout: '65%', layout: { padding: 14 }, animation: { duration: 600, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8 } } }} />
            </div>
          </div>
          <div className="space-y-1.5">
            {donutSources.map(s => {
              const pct = viewDonutTotal > 0 ? ((s.value / viewDonutTotal) * 100).toFixed(0) : '0'
              return (
                <div key={s.label} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-[var(--text2)]">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-num font-medium">{formatCash(s.value)}</span>
                    <span className="text-[var(--text3)] text-[10px]">{pct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Unified Chats + cash por chat panel */}
      <div className="glass-card p-6 mb-4">
        {/* Top: Hero metrics */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Conversaciones {viewLabel}</div>
            <div className="text-[12px] font-semibold text-[var(--text)] mb-1">CHATS Y CASH POR CHAT</div>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-right">
              <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Total chats</div>
              <div className="font-mono-num text-4xl font-bold">{viewTotalChats}</div>
              {view === 'mensual' && dashData.prevChats > 0 && (
                <div className={`text-[11px] ${dashData.chats >= dashData.prevChats ? 'text-[var(--green)]' : 'text-[var(--text2)]'}`}>
                  {dashData.chats >= dashData.prevChats ? '▲' : '▼'} {Math.abs(((dashData.chats - dashData.prevChats) / dashData.prevChats) * 100).toFixed(0)}% vs anterior
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cash por chat promedio</div>
              <div className="font-mono-num text-4xl font-bold text-[var(--green)]">{formatCash(kpiCashPorChat)}</div>
            </div>
          </div>
        </div>

        {/* Middle: Donut + Table side by side */}
        <div className="flex items-center gap-6">
          {/* Donut */}
          <div className="relative w-36 h-36 flex-shrink-0" style={{ isolation: 'isolate', zIndex: 1 }}>
            <Doughnut data={{
              labels: chatsSources.map(s => s.label),
              datasets: [{ data: chatsSources.map(s => s.value || 0), backgroundColor: chatsSources.map(s => s.color), borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: 'rgba(255,255,255,0.3)', hoverOffset: 4 }],
            }} options={{ responsive: true, maintainAspectRatio: true, cutout: '62%', layout: { padding: 8 }, animation: { duration: 600, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8 } } }} />
          </div>

          {/* Table */}
          <div className="flex-1">
            <div className="grid grid-cols-5 gap-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2 pb-1.5 border-b border-[var(--border)]">
              <div>Canal</div>
              <div className="text-right">Chats</div>
              <div className="text-right">%</div>
              <div className="text-right">Cash</div>
              <div className="text-right">Cash por chat</div>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Historias', chats: viewHistoriasChats, cash: histCashForCpc, cpc: cpcHistoria, color: '#F59E0B' },
                { label: 'Reels', chats: viewReelsChats, cash: reelCashForCpc, cpc: cpcReel, color: '#EF4444' },
                { label: 'BIO', chats: viewBioChats, cash: viewBioCashReal, cpc: cpcBio, color: '#A855F7' },
                { label: 'YouTube', chats: viewYoutubeChats, cash: ytCashForCpc, cpc: cpcYoutube, color: '#FF0000' },
                { label: 'Otros', chats: viewOtrosChats, cash: otrosCashForCpc, cpc: cpcOtros, color: '#6B7280' },
              ].map(ch => {
                const pct = viewTotalChats > 0 ? ((ch.chats / viewTotalChats) * 100).toFixed(0) : '0'
                return (
                  <div key={ch.label} className="grid grid-cols-5 gap-2 text-[12px] items-center">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ch.color }} />
                      <span className="font-medium">{ch.label}</span>
                    </div>
                    <span className="font-mono-num text-right">{ch.chats}</span>
                    <span className="font-mono-num text-right text-[var(--text3)]">{pct}%</span>
                    <span className="font-mono-num text-right text-[var(--green)]">{formatCash(ch.cash)}</span>
                    <span className="font-mono-num font-bold text-right">{formatCash(ch.cpc)}</span>
                  </div>
                )
              })}
            </div>
            {/* Stacked bar */}
            <div className="h-2 flex rounded-full overflow-hidden bg-[var(--bg4)] mt-4">
              {[
                { pct: viewHistoriasChats / Math.max(viewTotalChats, 1) * 100, color: '#F59E0B' },
                { pct: viewReelsChats / Math.max(viewTotalChats, 1) * 100, color: '#EF4444' },
                { pct: viewBioChats / Math.max(viewTotalChats, 1) * 100, color: '#A855F7' },
                { pct: viewYoutubeChats / Math.max(viewTotalChats, 1) * 100, color: '#FF0000' },
                { pct: viewOtrosChats / Math.max(viewTotalChats, 1) * 100, color: '#6B7280' },
              ].map((b, i) => <div key={i} style={{ width: `${b.pct}%`, backgroundColor: b.color }} />)}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

