'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { backendAuthHeaders } from '@/lib/api'
import { formatK, formatCash, formatIntegerEsAr } from '@/shared/lib/format-utils'

type PerfSnapshot = { date: string; views: number; likes: number; comments: number }
type VideoMetrics = {
  thumbnail?: string; views?: number; likes?: number; comments?: number
  ctr?: number; retention?: number; impressions?: number; avgViewDuration?: number
  performanceHistory?: PerfSnapshot[]
}
type VideoClassification = {
  dolor?: string; angulos?: string[]; cta?: string; transcript?: string
  summary?: string; ctaTranscript?: string; description?: string
  keyPoints?: string[]; targetAudience?: string; mainHook?: string
}
type Video = {
  id: string
  title: string | null
  metrics: VideoMetrics
  classification: VideoClassification
  /** Total = cash_manual + cash_leads (alias legacy: `cash`). */
  cash: number
  cash_manual?: number
  cash_leads?: number
  cash_total?: number
  cpc?: number
  chats: number
  agendas?: number
  published_at: string | null
  url: string | null
  notes: string | null
  external_id: string | null
}
type Lead = { client_name: string | null; status: string | null; payment: number | null; program_offered: string | null; agenda_point: string | null }

type YoutubeListAggregates = {
  video_count: number
  total_views: number
  total_likes: number
  total_comments: number
  total_cash: number
  total_chats: number
  avg_views: number
  avg_ctr: number
}

const emptyYoutubeAggregates: YoutubeListAggregates = {
  video_count: 0,
  total_views: 0,
  total_likes: 0,
  total_comments: 0,
  total_cash: 0,
  total_chats: 0,
  avg_views: 0,
  avg_ctr: 0,
}

const PAGE_SIZE = 12

function videoCashTotal(v: Pick<Video, 'cash_total' | 'cash'>): number {
  return Number(v.cash_total ?? v.cash) || 0
}

function prevMonth(ym: string): string | null {
  const [ys, ms] = ym.split('-')
  const y = parseInt(ys, 10)
  const m = parseInt(ms, 10)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null
  if (m <= 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}

const UNDO_DURATION = 6000

function calendarYm(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

export default function YouTubePage() {
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'
  const [monthMode, setMonthMode] = useState<'all' | 'current' | 'comparison'>('all')
  const [comparisonMonths, setComparisonMonths] = useState<[string, string] | null>(null)
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [showComparisonModal, setShowComparisonModal] = useState(false)
  const [comparisonDraftA, setComparisonDraftA] = useState('')
  const [comparisonDraftB, setComparisonDraftB] = useState('')
  const [videos, setVideos] = useState<Video[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [aggregates, setAggregates] = useState<YoutubeListAggregates>(emptyYoutubeAggregates)
  const [prevAggregates, setPrevAggregates] = useState<YoutubeListAggregates>(emptyYoutubeAggregates)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [undoAction, setUndoAction] = useState<{ label: string; execute: () => Promise<void> } | null>(null)
  const [undoProgress, setUndoProgress] = useState(100)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const monthChoices = useMemo(() => {
    const merged = [...new Set([...availableMonths, ...recentMonthOptions(36)])]
    merged.sort((a, b) => b.localeCompare(a))
    return merged
  }, [availableMonths])

  const filterSubtitle = useMemo(() => {
    if (monthMode === 'all') return 'Todos los meses'
    if (monthMode === 'current') return formatMonthLabel(calendarYm())
    if (monthMode === 'comparison' && comparisonMonths) {
      const [a, b] = comparisonMonths
      return `${formatMonthLabel(a)} vs ${formatMonthLabel(b)}`
    }
    return 'Comparación'
  }, [monthMode, comparisonMonths])

  const showUndo = (label: string, fn: () => Promise<void>) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    setUndoAction({ label, execute: fn }); setUndoProgress(100)
    const start = Date.now()
    undoIntervalRef.current = setInterval(() => { const r = Math.max(0, 100 - ((Date.now() - start) / UNDO_DURATION) * 100); setUndoProgress(r); if (r <= 0) { clearInterval(undoIntervalRef.current!); setUndoAction(null) } }, 50)
    undoTimerRef.current = setTimeout(() => { if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); setUndoAction(null) }, UNDO_DURATION)
  }
  const handleUndo = async () => { if (!undoAction) return; if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); await undoAction.execute(); setUndoAction(null); toast('Revertido'); void fetchData() }

  const fetchData = useCallback(
    async (explicitPage?: number) => {
      if (!ready) return
      const pageForRequest = explicitPage ?? page
      setLoading(true)
      try {
        const headers = backendAuthHeaders()
        const vq = new URLSearchParams()
        vq.set('page', String(pageForRequest))
        vq.set('page_size', String(PAGE_SIZE))
        let prevVideosUrl: string | null = null
        let leadsUrl = `${apiBase}/api/leads`

        if (monthMode === 'current') {
          const ym = calendarYm()
          vq.set('month', ym)
          const pm = prevMonth(ym)
          if (pm) {
            const pq = new URLSearchParams({ month: pm, page: '1', page_size: '50' })
            prevVideosUrl = `${apiBase}/api/youtube/videos?${pq.toString()}`
          }
          leadsUrl = `${apiBase}/api/leads?month=${encodeURIComponent(ym)}`
        } else if (monthMode === 'comparison' && comparisonMonths?.length === 2) {
          const sorted = [...comparisonMonths].sort((a, b) => a.localeCompare(b))
          vq.set('months', sorted.join(','))
        }

        const videosUrl = `${apiBase}/api/youtube/videos?${vq.toString()}`

        const [vRes, pvRes, lRes] = await Promise.all([
          fetch(videosUrl, { headers }),
          prevVideosUrl ? fetch(prevVideosUrl, { headers }) : Promise.resolve(null as unknown as Response),
          fetch(leadsUrl, { headers }),
        ])
        if (vRes.ok) {
          const vd = (await vRes.json()) as {
            videos?: Video[]
            available_months?: string[]
            total_pages?: number
            page?: number
            aggregates?: Partial<YoutubeListAggregates>
          }
          setVideos(Array.isArray(vd.videos) ? vd.videos : [])
          setAvailableMonths(Array.isArray(vd.available_months) ? vd.available_months : [])
          setTotalPages(Math.max(0, Number(vd.total_pages) || 0))
          if (typeof vd.page === 'number' && vd.page !== pageForRequest) {
            setPage(vd.page)
          }
          const ag = vd.aggregates
          if (ag && typeof ag.video_count === 'number') {
            setAggregates({
              video_count: ag.video_count,
              total_views: Number(ag.total_views) || 0,
              total_likes: Number(ag.total_likes) || 0,
              total_comments: Number(ag.total_comments) || 0,
              total_cash: Number(ag.total_cash) || 0,
              total_chats: Number(ag.total_chats) || 0,
              avg_views: Number(ag.avg_views) || 0,
              avg_ctr: Number(ag.avg_ctr) || 0,
            })
          } else {
            setAggregates(emptyYoutubeAggregates)
          }
        } else {
          setVideos([])
          setAvailableMonths([])
          setTotalPages(0)
          setAggregates(emptyYoutubeAggregates)
        }
        if (pvRes?.ok) {
          const pvd = (await pvRes.json()) as { aggregates?: Partial<YoutubeListAggregates> }
          const ag = pvd.aggregates
          if (ag && typeof ag.video_count === 'number') {
            setPrevAggregates({
              video_count: ag.video_count,
              total_views: Number(ag.total_views) || 0,
              total_likes: Number(ag.total_likes) || 0,
              total_comments: Number(ag.total_comments) || 0,
              total_cash: Number(ag.total_cash) || 0,
              total_chats: Number(ag.total_chats) || 0,
              avg_views: Number(ag.avg_views) || 0,
              avg_ctr: Number(ag.avg_ctr) || 0,
            })
          } else {
            setPrevAggregates(emptyYoutubeAggregates)
          }
        } else {
          setPrevAggregates(emptyYoutubeAggregates)
        }
        if (lRes.ok) {
          const ld = (await lRes.json()) as { leads?: Lead[] }
          setLeads(Array.isArray(ld.leads) ? ld.leads : [])
        } else {
          setLeads([])
        }
      } catch {
        setVideos([])
        setLeads([])
        setAvailableMonths([])
        setTotalPages(0)
        setAggregates(emptyYoutubeAggregates)
        setPrevAggregates(emptyYoutubeAggregates)
      } finally {
        setLoading(false)
      }
    },
    [monthMode, comparisonMonths, ready, apiBase, page],
  )

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    setExpanded(null)
  }, [page])

  const handleSync = async () => {
    if (!userId) {
      toast('Iniciá sesión para sincronizar.')
      return
    }
    const cr = await fetch(`${apiBase}/conexiones`, { headers: backendAuthHeaders() })
    const rows = (await cr.json().catch(() => [])) as { platform: string; credentials: Record<string, string> }[]
    const conn = rows.find((r) => r.platform === 'youtube')
    const creds = conn?.credentials as Record<string, string> | null
    if (!creds?.api_key && !creds?.apiKey) {
      toast('Configura YouTube en Conexiones API')
      return
    }
    if (!creds?.channel_id && !creds?.channelId) {
      toast('Configura YouTube en Conexiones API')
      return
    }
    setSyncing(true)
    setSyncStatus('Sincronizando...')
    try {
      const res = await fetch(`${apiBase}/api/youtube/sync`, {
        method: 'POST',
        headers: backendAuthHeaders(),
      })
      const data = (await res.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[]
        total?: number
        new?: number
        updated?: number
        months?: string[]
      }
      if (!res.ok) {
        const d = data.detail
        const msg = typeof d === 'string' ? d : Array.isArray(d) ? JSON.stringify(d) : 'Error al sincronizar'
        setSyncStatus(`Error: ${msg}`)
        return
      }
      setSyncStatus(
        `${data.total ?? 0} videos. ${data.new ?? 0} nuevos, ${data.updated ?? 0} actualizados.`,
      )
      const months = Array.isArray(data.months) ? data.months : []
      const totalSynced = data.total ?? 0
      if (totalSynced === 0) {
        toast('YouTube no devolvió videos (canal vacío, API o credenciales).')
        setPage(1)
        await fetchData(1)
        return
      }
      let doneMsg = 'Sync completado'
      if (monthMode === 'current' && months.length > 0) {
        const ym = calendarYm()
        if (!months.includes(ym)) {
          const labels = months.slice(0, 3).map((m) => formatMonthLabel(m))
          doneMsg += ` Esas publicaciones están en: ${labels.join(', ')}. Usá «Todos» para verlos.`
        }
      }
      toast(doneMsg)
      setPage(1)
      await fetchData(1)
    } catch (e) {
      setSyncStatus(`Error: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }

  const updateField = async (id: string, field: string, value: unknown) => {
    setVideos(prev => prev.map(v => v.id !== id ? v : { ...v, [field]: value }))
  }

  const saveCashManual = async (id: string, cashManual: number) => {
    if (!userId) return
    try {
      const res = await fetch(`${apiBase}/api/youtube/videos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...backendAuthHeaders() },
        body: JSON.stringify({ cash_manual: Math.max(0, Math.round(cashManual)) }),
      })
      const data = (await res.json().catch(() => ({}))) as Video & { detail?: string }
      if (!res.ok) {
        toast(`Error al guardar cash: ${data.detail || 'No se pudo actualizar'}`)
        return
      }
      setVideos((prev) =>
        prev.map((v) =>
          v.id !== id
            ? v
            : {
                ...v,
                cash: Number(data.cash) || 0,
                cash_manual: Number(data.cash_manual) || 0,
                cash_leads: Number(data.cash_leads) || 0,
                cash_total: Number(data.cash_total) || 0,
                cpc: Number(data.cpc) || 0,
                agendas: typeof data.agendas === 'number' ? data.agendas : v.agendas,
              },
        ),
      )
      void fetchData()
    } catch (e) {
      toast(`Error al guardar cash: ${(e as Error).message}`)
    }
  }

  const deleteVideo = async (id: string) => {
    const video = videos.find(v => v.id === id)
    if (!video || !userId || !confirm('Eliminar?')) return
    setVideos((prev) => prev.filter((v) => v.id !== id))
    showUndo('Eliminado', async () => {
      setVideos((prev) => [...prev, video])
    })
    toast('Eliminado')
    if (expanded === id) setExpanded(null)
  }

  // Stats (totales del filtro vía backend; la grilla es solo la página actual)
  const totalViews = aggregates.total_views
  const prevTotalViews = prevAggregates.total_views
  const totalCash = aggregates.total_cash
  const avgCtr = aggregates.avg_ctr
  const prevYmForDelta = monthMode === 'current' ? prevMonth(calendarYm()) : null
  const compareLabel = prevYmForDelta ? formatMonthLabel(prevYmForDelta) : ''
  const showMonthDeltas = monthMode === 'current' && prevYmForDelta !== null
  const viewsDelta =
    showMonthDeltas && prevTotalViews > 0
      ? ((totalViews - prevTotalViews) / prevTotalViews * 100).toFixed(0)
      : null
  const prevAvgViews = Math.round(prevAggregates.avg_views)
  const curAvgViews = Math.round(aggregates.avg_views)
  const avgViewsDelta =
    showMonthDeltas && prevAvgViews > 0 ? (((curAvgViews - prevAvgViews) / prevAvgViews) * 100).toFixed(0) : null
  const videoCountDelta =
    showMonthDeltas ? aggregates.video_count - prevAggregates.video_count : null

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div className="max-w-[1400px]">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">
          YouTube{' '}
          <span className="text-sm font-normal text-[var(--text3)]">{filterSubtitle}</span>
        </h2>
        <div className="inline-flex flex-wrap gap-2 rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-1">
          <button
            type="button"
            onClick={() => {
              setPage(1)
              setMonthMode('all')
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'all' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => {
              setPage(1)
              setMonthMode('current')
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'current' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            Mes actual
          </button>
          <button
            type="button"
            onClick={() => {
              const opts = monthChoices
              const a = comparisonMonths?.[0] || opts[0] || ''
              const b = comparisonMonths?.[1] || opts[1] || opts[0] || ''
              setComparisonDraftA(a)
              setComparisonDraftB(b)
              setShowComparisonModal(true)
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'comparison' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            Comparar meses
          </button>
        </div>
      </div>

      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm hover:opacity-90 disabled:opacity-40"
        >
          <span className="text-sm leading-none">+</span>
          {syncing ? 'Sincronizando…' : 'Sincronizar YouTube'}
        </button>
        {syncStatus ? (
          <span
            className={`max-w-[min(100%,480px)] text-[12px] leading-snug ${
              syncStatus.includes('videos') && !syncStatus.includes('Error')
                ? 'text-[var(--green)]'
                : syncStatus.includes('Error')
                  ? 'text-[var(--red)]'
                  : 'text-[var(--text3)]'
            }`}
          >
            {syncStatus}
          </span>
        ) : null}
      </div>

      {/* KPIs fila superior */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <div className="glass-card rounded-xl p-5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Visitas</div>
          <div className="font-mono-num mt-1 text-2xl font-bold tabular-nums">{formatK(totalViews)}</div>
          {viewsDelta !== null ? (
            <div
              className={`mt-1.5 text-[11px] font-mono-num tabular-nums ${
                Number(viewsDelta) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'
              }`}
            >
              {Number(viewsDelta) >= 0 ? '+' : ''}
              {viewsDelta}% <span className="text-[var(--text3)]">vs {compareLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="glass-card rounded-xl p-5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Videos</div>
          <div className="font-mono-num mt-1 text-2xl font-bold tabular-nums">{aggregates.video_count}</div>
          {videoCountDelta !== null ? (
            <div
              className={`mt-1.5 text-[11px] font-mono-num ${
                videoCountDelta >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'
              }`}
            >
              {videoCountDelta >= 0 ? '+' : ''}
              {videoCountDelta} <span className="text-[var(--text3)]">vs {compareLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="glass-card rounded-xl p-5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Prom. visitas</div>
          <div className="font-mono-num mt-1 text-2xl font-bold tabular-nums">
            {aggregates.video_count > 0 ? formatK(curAvgViews) : '0'}
          </div>
          {avgViewsDelta !== null ? (
            <div
              className={`mt-1.5 text-[11px] font-mono-num ${
                Number(avgViewsDelta) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'
              }`}
            >
              {Number(avgViewsDelta) >= 0 ? '+' : ''}
              {avgViewsDelta}% <span className="text-[var(--text3)]">vs {compareLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="glass-card rounded-xl p-5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">CTR prom.</div>
          <div className="font-mono-num mt-1 text-2xl font-bold tabular-nums">
            {avgCtr > 0 ? `${avgCtr.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Grilla de videos */}
      {aggregates.video_count === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border2)] py-16 text-center text-[13px] text-[var(--text3)]">
          {monthMode === 'all' ? (
            <>
              No hay videos importados. Tocá <span className="text-[var(--text2)]">Sincronizar YouTube</span> o
              revisá Conexiones API.
            </>
          ) : monthMode === 'current' ? (
            <>
              No hay videos con publicación en <span className="text-[var(--text2)]">{formatMonthLabel(calendarYm())}</span>{' '}
              (Argentina). Probá <span className="text-[var(--text2)]">Todos</span> o <span className="text-[var(--text2)]">Comparar meses</span>.
            </>
          ) : (
            <>
              No hay videos en los meses seleccionados. Elegí otros meses en «Comparar meses» o usá «Todos».
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {videos.map(v => (
            <VideoCard key={v.id} video={v} isExpanded={expanded === v.id}
              onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
              onUpdate={updateField} onSaveCashManual={saveCashManual} onDelete={deleteVideo} leads={leads} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-[12px] text-[var(--text3)]">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      ) : null}

      {showComparisonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-5">
            <div className="mb-4 text-[14px] font-semibold">Comparar meses</div>
            <p className="mb-4 text-[12px] text-[var(--text3)]">
              Elegí dos meses (fecha de publicación YouTube, Argentina). Se listan los videos de ambos.
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] text-[var(--text3)]">Primer mes</label>
                <select
                  value={comparisonDraftA}
                  onChange={(e) => setComparisonDraftA(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
                >
                  {monthChoices.map((ym) => (
                    <option key={ym} value={ym}>
                      {formatMonthLabel(ym)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[var(--text3)]">Segundo mes</label>
                <select
                  value={comparisonDraftB}
                  onChange={(e) => setComparisonDraftB(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
                >
                  {monthChoices.map((ym) => (
                    <option key={`b-${ym}`} value={ym}>
                      {formatMonthLabel(ym)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowComparisonModal(false)}
                className="rounded-md bg-[var(--bg4)] px-3 py-2 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!comparisonDraftA || !comparisonDraftB) {
                    toast('Elegí los dos meses.')
                    return
                  }
                  setPage(1)
                  setComparisonMonths([comparisonDraftA, comparisonDraftB])
                  setMonthMode('comparison')
                  setShowComparisonModal(false)
                }}
                className="rounded-md bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo bar */}
      {undoAction && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] glass-card overflow-hidden shadow-lg border border-[var(--border2)] min-w-[320px]">
          <div className="flex items-center gap-4 px-5 py-3.5">
            <span className="text-[13px] text-[var(--text2)]">{undoAction.label}</span>
            <button onClick={handleUndo} className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-[11px] font-semibold uppercase text-white">Deshacer</button>
            <button onClick={() => { setUndoAction(null); if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current) }} className="text-[var(--text3)] text-sm">\u00D7</button>
          </div>
          <div className="h-[3px] bg-[var(--bg4)]"><div className="h-full bg-[var(--accent)] transition-[width] duration-[50ms] ease-linear" style={{ width: `${undoProgress}%` }} /></div>
        </div>
      )}
    </div>
  )
}

/* ---------- Video Card ---------- */

function VideoCard({ video: v, isExpanded, onToggle, onUpdate, onSaveCashManual, onDelete, leads }: {
  video: Video; isExpanded: boolean; onToggle: () => void
  onUpdate: (id: string, field: string, value: unknown) => void
  onSaveCashManual: (id: string, cashManual: number) => Promise<void>
  onDelete: (id: string) => void; leads: Lead[]
}) {
  const cls = v.classification || {}
  const title = v.title || 'Sin titulo'
  const cashManual = typeof v.cash_manual === 'number' ? v.cash_manual : v.cash || 0
  const relatedAgenda = leads.filter(
    (l) => String(l.agenda_point || '').trim().toLowerCase() === `youtube:${v.id}`.toLowerCase(),
  )

  const visitas = Number(v.metrics?.views) || 0
  const comentarios = Number(v.metrics?.comments) || 0
  const agendasMetric = typeof v.agendas === 'number' ? v.agendas : relatedAgenda.length
  const buyers = relatedAgenda.filter(
    (l) => l.status === 'Cerrado' || (Number(l.payment) || 0) > 0,
  )

  if (isExpanded) return (
    <div className="glass-card col-span-full overflow-hidden rounded-xl border border-[var(--border2)] lg:grid lg:min-h-[380px] lg:grid-cols-[minmax(280px,420px)_1fr]">
      <div className="relative min-h-[220px] lg:min-h-full">
        {v.metrics?.thumbnail ? (
          <img src={v.metrics.thumbnail} alt="" className="h-full w-full object-cover lg:absolute lg:inset-0 lg:min-h-full" />
        ) : (
          <div className="flex h-full min-h-[220px] items-center justify-center bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)] lg:absolute lg:inset-0">
            <div className="text-4xl text-[var(--text3)]">&#9654;</div>
          </div>
        )}
      </div>

      <div className="flex max-h-[min(70vh,640px)] flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-semibold leading-snug text-[var(--text)]">{title}</div>
            <div className="mt-1 text-[11px] text-[var(--text3)]">{v.published_at?.split('T')[0]}</div>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(v.id) }} className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--red)] hover:opacity-90">Eliminar</button>
            <button type="button" onClick={onToggle} className="rounded-md border border-[var(--border2)] bg-[var(--bg4)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text3)] hover:text-[var(--text)]">Cerrar</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] font-medium uppercase tracking-wider text-[var(--text3)]">Visitas</div>
            <div className="font-mono-num text-[15px] font-bold tabular-nums leading-tight text-[var(--text)] sm:text-[17px]">
              {formatIntegerEsAr(visitas)}
            </div>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] font-medium uppercase tracking-wider text-[var(--text3)]">Agendas</div>
            <div className="font-mono-num text-[15px] font-bold tabular-nums leading-tight text-[var(--accent)] sm:text-[17px]">
              {formatIntegerEsAr(agendasMetric)}
            </div>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] font-medium uppercase tracking-wider text-[var(--text3)]">CTR</div>
            <div className="font-mono-num text-[17px] font-bold tabular-nums">{Number(v.metrics?.ctr) > 0 ? `${v.metrics.ctr}%` : '—'}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] font-medium uppercase tracking-wider text-[var(--text3)]">Comentarios</div>
            <div className="font-mono-num text-[17px] font-bold tabular-nums text-[var(--text)]">{formatIntegerEsAr(comentarios)}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] font-medium uppercase tracking-wider text-[var(--text3)]">Cash manual</div>
            <input
              type="number"
              value={cashManual}
              onChange={(e) => onUpdate(v.id, 'cash_manual', Number(e.target.value) || 0)}
              onBlur={(e) => void onSaveCashManual(v.id, Number(e.target.value) || 0)}
              className="w-full bg-transparent text-center font-mono-num text-[17px] font-bold text-[var(--green)] outline-none tabular-nums"
              onClick={(e) => e.stopPropagation()}
            />
            {(v.cash_leads ?? 0) > 0 ? (
              <div className="mt-1 text-[9px] text-[var(--text3)]">
                Total {formatCash(videoCashTotal(v))} · leads {formatCash(Number(v.cash_leads) || 0)}
              </div>
            ) : null}
          </div>
        </div>

        {v.url && (
          <a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg4)] px-4 py-2 text-[12px] font-medium text-[var(--accent)] transition-colors hover:border-[var(--accent)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Link al video de YouTube
          </a>
        )}

        {cls.description ? (
          <div>
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text3)]">Descripción</div>
            <div className="max-h-[140px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3 text-[12px] leading-relaxed text-[var(--text2)]">{cls.description}</div>
          </div>
        ) : null}

        {cls.summary ? (
          <div>
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text3)]">Resumen</div>
            <div className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3 text-[13px] leading-relaxed text-[var(--text2)]">{cls.summary}</div>
          </div>
        ) : null}

        {/* Performance chart */}
        {(v.metrics?.performanceHistory?.length || 0) > 1 && (
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">Rendimiento</div>
            <PerfChart data={v.metrics.performanceHistory || []} />
          </div>
        )}

        {buyers.length > 0 ? (
          <div>
            <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text3)]">Leads que compraron por este video</div>
            <div className="space-y-1.5">
              {buyers.slice(0, 8).map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg4)] px-3 py-2.5 text-[11px]">
                  <span className="truncate font-medium text-[var(--text2)]">{l.client_name || 'Sin nombre'}</span>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {l.program_offered ? <span className="hidden max-w-[100px] truncate text-[var(--text3)] sm:inline">{l.program_offered}</span> : null}
                    <span className="text-[var(--green)] font-semibold">{formatCash(Number(l.payment) || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : relatedAgenda.length > 0 ? (
          <div>
            <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text3)]">Leads con punto de agenda en este video</div>
            <div className="space-y-1.5">
              {relatedAgenda.slice(0, 6).map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg4)] px-3 py-2 text-[11px]">
                  <span className="truncate text-[var(--text2)]">{l.client_name || 'Sin nombre'}</span>
                  <span className={l.status === 'Cerrado' ? 'font-semibold text-[var(--green)]' : 'text-[var(--text3)]'}>{l.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

      </div>
    </div>
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir detalle: ${title}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      className="glass-card group w-full cursor-pointer overflow-hidden rounded-xl border border-[var(--border2)] text-left transition-shadow hover:border-[var(--text3)]/30 hover:shadow-md"
      onClick={onToggle}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--bg4)]">
        {v.metrics?.thumbnail ? (
          <img src={v.metrics.thumbnail} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)]">
            <span className="text-3xl text-[var(--text3)]">&#9654;</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent px-3 pb-3 pt-12">
          <p className="line-clamp-2 text-[12px] font-medium leading-snug text-white">{title}</p>
        </div>
      </div>
      <div className="grid grid-cols-4 divide-x divide-[var(--border)] border-t border-[var(--border)] bg-[var(--bg3)]">
        <div className="px-2 py-3 text-center sm:px-3">
          <div className="text-[8px] font-semibold uppercase tracking-wider text-[var(--text3)] sm:text-[9px]">Visitas</div>
          <div className="mt-0.5 font-mono-num text-sm font-bold tabular-nums text-[var(--text)] sm:text-lg">{formatIntegerEsAr(visitas)}</div>
        </div>
        <div className="px-2 py-3 text-center sm:px-3">
          <div className="text-[8px] font-semibold uppercase tracking-wider text-[var(--text3)] sm:text-[9px]">Agendas</div>
          <div className="mt-0.5 font-mono-num text-sm font-bold tabular-nums text-[var(--accent)] sm:text-lg">{formatIntegerEsAr(agendasMetric)}</div>
        </div>
        <div className="px-2 py-3 text-center sm:px-3">
          <div className="text-[8px] font-semibold uppercase tracking-wider text-[var(--text3)] sm:text-[9px]">Comentarios</div>
          <div className="mt-0.5 font-mono-num text-sm font-bold tabular-nums text-[var(--text)] sm:text-lg">{formatIntegerEsAr(comentarios)}</div>
        </div>
        <div className="px-2 py-3 text-center sm:px-3">
          <div className="text-[8px] font-semibold uppercase tracking-wider text-[var(--text3)] sm:text-[9px]">Cash</div>
          <div className="mt-0.5 font-mono-num text-sm font-bold tabular-nums text-[var(--green)] sm:text-lg">{formatCash(videoCashTotal(v))}</div>
        </div>
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2.5">
        {v.url ? (
          <a
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
          >
            Link al video de YouTube
            <span aria-hidden>→</span>
          </a>
        ) : (
          <span className="text-[11px] text-[var(--text3)]">Sin enlace</span>
        )}
        <p className="mt-1 text-[10px] text-[var(--text3)]">Tocá la tarjeta para ver detalle</p>
      </div>
    </div>
  )
}

/* ---------- Performance Chart ---------- */

function PerfChart({ data }: { data: PerfSnapshot[] }) {
  if (data.length < 2) return null
  const maxV = Math.max(...data.map(d => d.views), 1)
  const w = 500, h = 100, pL = 40, pR = 5, pT = 5, pB = 18
  const cW = w - pL - pR, cH = h - pT - pB
  const pts = data.map((d, i) => ({ x: pL + (i / (data.length - 1)) * cW, y: pT + cH - (d.views / maxV) * cH, ...d }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = line + ` L${pts[pts.length - 1].x},${pT + cH} L${pts[0].x},${pT + cH} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 120 }}>
      <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map(p => { const y = pT + cH - p * cH; return <g key={p}><line x1={pL} y1={y} x2={w - pR} y2={y} stroke="var(--border)" strokeWidth="0.5" /><text x={pL - 3} y={y + 3} fill="var(--text3)" fontSize="7" textAnchor="end">{formatIntegerEsAr(Math.round(maxV * p))}</text></g> })}
      <path d={area} fill="url(#vg)" /><path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2" fill="var(--accent)" />)}
      {[0, pts.length - 1].map(i => <text key={i} x={pts[i].x} y={pT + cH + 12} fill="var(--text3)" fontSize="7" textAnchor="middle">{pts[i].date.split('T')[0].slice(5)}</text>)}
    </svg>
  )
}

function recentMonthOptions(count: number): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = 0; i < count; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function formatMonthLabel(ym: string): string {
  const parts = ym.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  if (!y || !m) return ym
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}
