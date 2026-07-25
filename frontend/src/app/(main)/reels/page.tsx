'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

type Reel = {
  id: string
  title: string | null
  content_type: string
  metrics: Record<string, number | string>
  classification: { dolor?: string; angulos?: string[]; cta?: string; transcript?: string } | null
  cash: number
  chats: number
  published_at: string | null
  url: string | null
  notes: string | null
  external_id: string | null
  keyword: string | null
  chats_count: number
  manual_cash: number | null
  manual_chats: number | null
  cash_total: number
  cpc: number
  agendas?: number | null
}

type ReelsListResponse = {
  reels: Reel[]
  total: number
  page: number
  page_size: number
  total_pages: number
  available_months: string[]
  total_cash: number
  total_chats: number
}

type ReelsMetrics = {
  chats_del_mes: number
  piezas_publicadas: number
  reels_con_cta: number
  reels_sin_cta: number
}

type ComparisonMonthMetrics = { ym: string; metrics: ReelsMetrics }

function normalizeReelsMetrics(data: ReelsMetrics): ReelsMetrics {
  return {
    chats_del_mes: Number(data.chats_del_mes ?? 0),
    piezas_publicadas: Number(data.piezas_publicadas ?? 0),
    reels_con_cta: Number(data.reels_con_cta ?? 0),
    reels_sin_cta: Number(data.reels_sin_cta ?? 0),
  }
}

const INSTAGRAM_TOKEN_WARN_DAYS_LEFT = 5

type SyncStatus = {
  total: number
  processed: number
  status: 'idle' | 'running' | 'done' | 'error'
  phase?: 'idle' | 'collecting' | 'processing' | 'done' | 'error' | 'preview_ready'
  discovered?: number
  range_preview_count?: number
  token_expires_at?: string | null
  token_saved_at?: string | null
}

export default function ReelsPage() {
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [reels, setReels] = useState<Reel[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [showRangeSyncModal, setShowRangeSyncModal] = useState(false)
  const [showComparisonModal, setShowComparisonModal] = useState(false)
  const [comparisonDraftA, setComparisonDraftA] = useState('')
  const [comparisonDraftB, setComparisonDraftB] = useState('')
  const [comparisonMonths, setComparisonMonths] = useState<[string, string] | null>(null)
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [rangeModalStep, setRangeModalStep] = useState<1 | 2>(1)
  const [rangeDiscoverLoading, setRangeDiscoverLoading] = useState(false)
  const [rangeImportTake, setRangeImportTake] = useState('1')
  const [rangePickingNewDates, setRangePickingNewDates] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [monthMode, setMonthMode] = useState<'all' | 'current' | 'comparison'>('current')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [aggregateTotals, setAggregateTotals] = useState({ total_cash: 0, total_chats: 0 })
  const [metrics, setMetrics] = useState<ReelsMetrics>({
    chats_del_mes: 0,
    piezas_publicadas: 0,
    reels_con_cta: 0,
    reels_sin_cta: 0,
  })
  const [comparisonByMonth, setComparisonByMonth] = useState<{
    first: ComparisonMonthMetrics
    second: ComparisonMonthMetrics
  } | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ total: 0, processed: 0, status: 'idle' })
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)
  const [tokenSavedAt, setTokenSavedAt] = useState<string | null>(null)
  const previousSyncStatus = useRef<SyncStatus['status']>('idle')
  const prevRangeModalStepRef = useRef<1 | 2>(1)
  const prevDiscoverCountRef = useRef(0)
  const [discoverCountPulse, setDiscoverCountPulse] = useState(false)
  const [masterLists, setMasterLists] = useState<{ dolores: string[]; angulos: string[]; ctas: string[] }>({
    dolores: [],
    angulos: [],
    ctas: [],
  })
  const isSyncRunning = syncing || syncStatus.status === 'running'
  const syncProgressPct = useMemo(() => {
    if (!isSyncRunning || syncStatus.total <= 0) return 0
    return Math.min(100, Math.max(0, Math.round((syncStatus.processed / syncStatus.total) * 100)))
  }, [isSyncRunning, syncStatus.total, syncStatus.processed])
  const tokenDaysLeft = useMemo(() => {
    if (!tokenExpiresAt) return null
    const expires = new Date(tokenExpiresAt)
    if (Number.isNaN(expires.getTime())) return null
    return Math.max(0, Math.floor((expires.getTime() - Date.now()) / 86400000))
  }, [tokenExpiresAt])
  const showTokenRenewal =
    tokenDaysLeft !== null && tokenDaysLeft <= INSTAGRAM_TOKEN_WARN_DAYS_LEFT
  const formatTokenDateAr = (iso: string | null) => {
    if (!iso) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date)
  }
  const tokenRenewByLabel = useMemo(() => formatTokenDateAr(tokenExpiresAt), [tokenExpiresAt])
  const tokenSavedAtLabel = useMemo(() => formatTokenDateAr(tokenSavedAt), [tokenSavedAt])
  const PAGE_SIZE = 12
  const authHeaders = () => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('evoluciona_token') : null
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (userId) headers['X-User-Id'] = userId
    return headers
  }

  const monthChoices = useMemo(() => {
    const merged = [...new Set([...availableMonths, ...recentMonthOptions(36)])]
    merged.sort((a, b) => b.localeCompare(a))
    return merged
  }, [availableMonths])

  const filterSubtitle = useMemo(() => {
    if (monthMode === 'all') return 'Todos los meses'
    if (monthMode === 'current') {
      const n = new Date()
      const ym = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
      return formatMonthLabel(ym)
    }
    if (monthMode === 'comparison' && comparisonMonths) {
      const [a, b] = comparisonMonths
      return `${formatMonthLabel(a)} vs ${formatMonthLabel(b)}`
    }
    return 'Comparación'
  }, [monthMode, comparisonMonths])

  const parseJson = async <T,>(res: Response): Promise<T> => {
    const text = await res.text()
    let data: unknown = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(text || `HTTP ${res.status}`)
    }
    if (!res.ok) {
      const maybeDetail =
        typeof data === 'object' && data !== null && 'detail' in data ? String((data as { detail: unknown }).detail) : `HTTP ${res.status}`
      throw new Error(maybeDetail)
    }
    return data as T
  }

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      let monthQuery = ''
      if (monthMode === 'current') {
        const n = new Date()
        const ym = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
        monthQuery = `&month=${encodeURIComponent(ym)}`
      } else if (monthMode === 'comparison' && comparisonMonths && comparisonMonths.length === 2) {
        const sorted = [...comparisonMonths].sort((a, b) => a.localeCompare(b))
        monthQuery = `&months=${encodeURIComponent(sorted.join(','))}`
      }
      const res = await apiFetch(`/reels?page=${page}&page_size=${PAGE_SIZE}${monthQuery}`, {
        headers: authHeaders(),
      })
      const data = await parseJson<ReelsListResponse>(res)
      setReels(Array.isArray(data.reels) ? data.reels : [])
      setTotalPages(Number(data.total_pages || 0))
      setAggregateTotals({
        total_cash: Number(data.total_cash || 0),
        total_chats: Number(data.total_chats || 0),
      })
      setAvailableMonths(Array.isArray(data.available_months) ? data.available_months : [])
    } catch (e) {
      toast(`Error al cargar reels: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [page, monthMode, comparisonMonths, ready, userId, toast])

  const fetchMetrics = useCallback(async () => {
    if (!ready) return
    if (monthMode !== 'comparison') {
      setComparisonByMonth(null)
    }
    try {
      if (monthMode === 'comparison' && comparisonMonths && comparisonMonths.length === 2) {
        const [ma, mb] = comparisonMonths
        const sorted = [...comparisonMonths].sort((a, b) => a.localeCompare(b))
        const monthsParam = encodeURIComponent(sorted.join(','))
        const [resA, resB, resCombined] = await Promise.all([
          apiFetch(`/reels/metrics?month=${encodeURIComponent(ma)}`, { headers: authHeaders() }),
          apiFetch(`/reels/metrics?month=${encodeURIComponent(mb)}`, { headers: authHeaders() }),
          apiFetch(`/reels/metrics?months=${monthsParam}`, { headers: authHeaders() }),
        ])
        const [dataA, dataB, dataC] = await Promise.all([
          parseJson<ReelsMetrics>(resA),
          parseJson<ReelsMetrics>(resB),
          parseJson<ReelsMetrics>(resCombined),
        ])
        setComparisonByMonth({
          first: { ym: ma, metrics: normalizeReelsMetrics(dataA) },
          second: { ym: mb, metrics: normalizeReelsMetrics(dataB) },
        })
        setMetrics(normalizeReelsMetrics(dataC))
        return
      }

      let q = ''
      if (monthMode === 'current') {
        const n = new Date()
        const ym = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
        q = `?month=${encodeURIComponent(ym)}`
      }
      const res = await apiFetch(`/reels/metrics${q}`, {
        headers: authHeaders(),
      })
      const data = await parseJson<ReelsMetrics>(res)
      setMetrics(normalizeReelsMetrics(data))
    } catch (e) {
      toast(`Error al cargar métricas de reels: ${(e as Error).message}`)
    }
  }, [monthMode, comparisonMonths, ready, userId, toast])

  const fetchSyncStatus = useCallback(async () => {
    if (!ready) return
    try {
      const res = await apiFetch('/reels/sync-status', { headers: authHeaders() })
      const data = await parseJson<SyncStatus>(res)
      setSyncStatus({
        total: Number(data.total || 0),
        processed: Number(data.processed || 0),
        status: ['idle', 'running', 'done', 'error'].includes(String(data.status)) ? data.status : 'idle',
        phase: ['idle', 'collecting', 'processing', 'done', 'error', 'preview_ready'].includes(String(data.phase))
          ? data.phase
          : 'idle',
        discovered: Number(data.discovered || 0),
        range_preview_count:
          data.range_preview_count !== undefined ? Number(data.range_preview_count) : undefined,
      })
      setTokenExpiresAt(data.token_expires_at || null)
      setTokenSavedAt(data.token_saved_at || null)
    } catch {
      setSyncStatus({ total: 0, processed: 0, status: 'idle', phase: 'idle', discovered: 0 })
    }
  }, [ready, userId])

  const fetchMasterLists = useCallback(async () => {
    if (!ready || !userId) return
    try {
      const res = await apiFetch('/master-lists', { headers: authHeaders() })
      const data = await parseJson<{ dolores: string[]; angulos: string[]; ctas: string[] }>(res)
      setMasterLists({
        dolores: Array.isArray(data.dolores) ? data.dolores : [],
        angulos: Array.isArray(data.angulos) ? data.angulos : [],
        ctas: Array.isArray(data.ctas) ? data.ctas : [],
      })
    } catch {
      setMasterLists({ dolores: [], angulos: [], ctas: [] })
    }
  }, [ready, userId])

  useEffect(() => {
    fetchData()
    fetchMetrics()
  }, [fetchData, fetchMetrics])

  useEffect(() => {
    fetchSyncStatus()
    fetchMasterLists()
  }, [fetchSyncStatus, fetchMasterLists])

  useEffect(() => {
    const refreshLists = () => { fetchMasterLists() }
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchMasterLists()
    }
    window.addEventListener('master-lists-updated', refreshLists)
    window.addEventListener('focus', refreshLists)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('master-lists-updated', refreshLists)
      window.removeEventListener('focus', refreshLists)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchMasterLists])

  useEffect(() => {
    if (syncStatus.status !== 'running') return
    const id = window.setInterval(() => {
      fetchSyncStatus()
    }, 2000)
    return () => window.clearInterval(id)
  }, [syncStatus.status, fetchSyncStatus])

  useEffect(() => {
    if (!rangeDiscoverLoading || !ready) return
    void fetchSyncStatus()
    const id = window.setInterval(() => {
      fetchSyncStatus()
    }, 400)
    return () => window.clearInterval(id)
  }, [rangeDiscoverLoading, ready, fetchSyncStatus])

  useEffect(() => {
    if (!rangeDiscoverLoading) {
      prevDiscoverCountRef.current = 0
      return
    }
    const n = Number(syncStatus.discovered || 0)
    if (n > prevDiscoverCountRef.current) {
      prevDiscoverCountRef.current = n
      setDiscoverCountPulse(true)
      const t = window.setTimeout(() => setDiscoverCountPulse(false), 280)
      return () => window.clearTimeout(t)
    }
    prevDiscoverCountRef.current = n
  }, [rangeDiscoverLoading, syncStatus.discovered])

  useEffect(() => {
    if (!rangeDiscoverLoading) return
    if (syncStatus.phase === 'preview_ready' && syncStatus.status === 'idle') {
      setRangeDiscoverLoading(false)
      setRangePickingNewDates(false)
      return
    }
    if (syncStatus.status === 'error') {
      setRangeDiscoverLoading(false)
      toast('Error al contar reels en la cuenta.')
    }
  }, [rangeDiscoverLoading, syncStatus, toast])

  useEffect(() => {
    if (!showRangeSyncModal || !ready) return
    void fetchSyncStatus()
  }, [showRangeSyncModal, ready, fetchSyncStatus])

  useEffect(() => {
    if (!showRangeSyncModal) return
    const previewDone = syncStatus.phase === 'preview_ready' && syncStatus.status === 'idle'
    if (previewDone && !rangePickingNewDates) {
      if (prevRangeModalStepRef.current !== 2) {
        const n = syncStatus.range_preview_count ?? syncStatus.discovered ?? 0
        setRangeImportTake(n > 0 ? '1' : '0')
      }
      setRangeModalStep(2)
      prevRangeModalStepRef.current = 2
    } else if (
      !rangeDiscoverLoading &&
      syncStatus.phase !== 'collecting' &&
      !previewDone
    ) {
      setRangeModalStep(1)
      prevRangeModalStepRef.current = 1
    }
  }, [showRangeSyncModal, syncStatus.phase, syncStatus.status, rangeDiscoverLoading, rangePickingNewDates])

  useEffect(() => {
    const previous = previousSyncStatus.current
    const current = syncStatus.status
    if (previous === 'running' && current !== 'running') {
      fetchData()
      fetchMetrics()
      if (current === 'done') setSyncMessage('Sync completado')
      if (current === 'error') setSyncMessage('Error durante la sincronizacion')
      setSyncing(false)
    }
    previousSyncStatus.current = current
  }, [syncStatus.status, fetchData, fetchMetrics])

  const handleRefreshMetrics = async () => {
    if (!ready || syncStatus.status === 'running') return
    setSyncing(true)
    setSyncMessage('Actualizando métricas...')
    setSyncStatus((prev) => ({ ...prev, status: 'running', processed: 0 }))
    fetchSyncStatus()
    try {
      const res = await apiFetch('/reels/refresh-metrics', { method: 'POST', headers: authHeaders() })
      await parseJson<{ status: string }>(res)
      await fetchSyncStatus()
    } catch (e) {
      setSyncMessage(`Error: ${(e as Error).message}`)
      setSyncing(false)
    } finally {
      await fetchSyncStatus()
    }
  }

  const handleSyncNewReels = async () => {
    if (!ready || syncStatus.status === 'running') return
    setSyncing(true)
    setSyncMessage('Buscando nuevos reels...')
    setSyncStatus((prev) => ({ ...prev, status: 'running', processed: 0 }))
    fetchSyncStatus()
    try {
      const res = await apiFetch('/reels/sync', { method: 'POST', headers: authHeaders() })
      await parseJson<{ status: string }>(res)
      await fetchSyncStatus()
    } catch (e) {
      setSyncMessage(`Error: ${(e as Error).message}`)
      setSyncing(false)
    } finally {
      await fetchSyncStatus()
    }
  }

  const handleRangeDiscover = async () => {
    if (!ready || syncStatus.status === 'running' || rangeDiscoverLoading) return
    setSyncMessage('Contando reels en tu cuenta de Instagram...')
    setRangeDiscoverLoading(true)
    fetchSyncStatus()
    try {
      const res = await apiFetch('/reels/sync-range/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      })
      await parseJson<{ status: string }>(res)
      await fetchSyncStatus()
    } catch (e) {
      setRangeDiscoverLoading(false)
      setSyncMessage(`Error: ${(e as Error).message}`)
    }
  }

  const handleRangeImport = async () => {
    if (!ready || syncStatus.status === 'running') return
    const n = syncStatus.range_preview_count ?? syncStatus.discovered ?? 0
    const take = Math.trunc(Number(rangeImportTake))
    if (!Number.isFinite(take) || take < 1 || take > n) {
      toast(`Indicá un número entre 1 y ${n}`)
      return
    }
    setShowRangeSyncModal(false)
    setRangePickingNewDates(false)
    setSyncing(true)
    setSyncMessage('Importando reels...')
    setSyncStatus((prev) => ({ ...prev, status: 'running', processed: 0 }))
    fetchSyncStatus()
    try {
      const res = await apiFetch('/reels/sync-range/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ take }),
      })
      await parseJson<{ status: string }>(res)
      await fetchSyncStatus()
    } catch (e) {
      setSyncMessage(`Error: ${(e as Error).message}`)
      setSyncing(false)
    } finally {
      await fetchSyncStatus()
    }
  }

  const updateField = async (id: string, field: 'cash' | 'chats', value: number) => {
    if (!ready) return
    const prev = reels.find((r) => r.id === id)
    if (!prev) return
    const body = field === 'cash' ? { cash: Number(value) || 0 } : { chats: Math.trunc(Number(value)) || 0 }
    try {
      const res = await apiFetch(`/reels/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      await parseJson<Reel>(res)
      const newCash = field === 'cash' ? body.cash : Number(prev.cash) || 0
      const newChats = field === 'chats' ? body.chats : Number(prev.chats) || 0
      setAggregateTotals((a) => ({
        total_cash: a.total_cash - (Number(prev.cash) || 0) + newCash,
        total_chats: a.total_chats - (Number(prev.chats) || 0) + newChats,
      }))
      setReels((rows) => rows.map((r) => (r.id === id ? { ...r, ...body } : r)))
    } catch (e) {
      toast(`No se guardó el reel: ${(e as Error).message}`)
    }
  }

  const updateKeyword = async (id: string, keyword: string) => {
    if (!ready) throw new Error('Sesión no lista')
    const cleanKeyword = keyword.trim()
    try {
      const res = await apiFetch(`/reels/${encodeURIComponent(id)}/keyword`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ keyword: cleanKeyword || null }),
      })
      const updated = await parseJson<Reel>(res)
      setReels((rows) => rows.map((r) => (r.id === id ? { ...r, keyword: updated.keyword } : r)))
      toast('Keyword guardado')
    } catch (e) {
      toast(`No se pudo guardar keyword: ${(e as Error).message}`)
      throw e
    }
  }

  const updateClassification = async (id: string, partial: { dolor?: string; angulos?: string; cta?: string }) => {
    if (!ready) throw new Error('Sesión no lista')
    const res = await apiFetch(`/reels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(partial),
    })
    const updated = await parseJson<Reel>(res)
    setReels((rows) => rows.map((r) => (r.id === id ? { ...r, classification: updated.classification } : r)))
    void fetchMetrics()
  }

  const refreshReel = async (id: string) => {
    if (!ready) return
    try {
      const res = await apiFetch(`/reels/${encodeURIComponent(id)}?refresh=true`, {
        headers: authHeaders(),
      })
      const updated = await parseJson<Reel>(res)
      setReels((rows) => rows.map((r) => (r.id === id ? { ...r, ...updated } : r)))
      await fetchData()
      toast('Reel actualizado')
    } catch (e) {
      toast(`No se pudo refrescar el reel: ${(e as Error).message}`)
    }
  }

  if (!ready) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          Reels{' '}
          <span className="text-[var(--text3)] text-sm font-normal">{filterSubtitle}</span>
          {loading && (
            <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-[var(--text3)]">
              · actualizando…
            </span>
          )}
        </h2>
        <div className="inline-flex gap-2 rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-1">
          <button
            onClick={() => {
              setMonthMode('current')
              setComparisonByMonth(null)
              setPage(1)
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'current' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            MES ACTUAL
          </button>
          <button
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
            SELECCIONAR MES Y AÑO
          </button>
          <button
            onClick={() => {
              setMonthMode('all')
              setComparisonByMonth(null)
              setPage(1)
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'all' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            TODOS
          </button>
        </div>
      </div>

      {monthMode === 'comparison' && comparisonMonths ? (
        <div className="mb-6 space-y-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            Comparación entre meses
          </div>
          {comparisonByMonth ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[comparisonByMonth.first, comparisonByMonth.second].map((side) => (
                <div
                  key={side.ym}
                  className="rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-5 shadow-sm"
                >
                  <div className="mb-4 text-[13px] font-semibold capitalize text-[var(--text)]">
                    {formatMonthLabel(side.ym)}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-[var(--bg3)] p-3">
                      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
                      <div className="font-mono-num mt-1 text-2xl font-bold">{side.metrics.chats_del_mes}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--bg3)] p-3">
                      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Piezas</div>
                      <div className="font-mono-num mt-1 text-2xl font-bold">{side.metrics.piezas_publicadas}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--bg3)] p-3">
                      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Con CTA</div>
                      <div className="font-mono-num mt-1 text-2xl font-bold">{side.metrics.reels_con_cta}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--bg3)] p-3">
                      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Sin CTA</div>
                      <div className="font-mono-num mt-1 text-2xl font-bold">{side.metrics.reels_sin_cta}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border2)] bg-[var(--bg2)] py-10 text-center text-[13px] text-[var(--text3)]">
              Cargando métricas de cada mes…
            </div>
          )}
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
          <div className="glass-card p-5">
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats del mes</div>
            <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.chats_del_mes}</div>
          </div>
          <div className="glass-card p-5">
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Piezas publicadas</div>
            <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.piezas_publicadas}</div>
          </div>
          <div className="glass-card p-5">
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cash generado</div>
            <div className="font-mono-num mt-1 text-3xl font-bold text-[var(--green)]">
              {formatCash(aggregateTotals.total_cash)}
            </div>
          </div>
          <div className="glass-card p-5">
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Reels con CTA</div>
            <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.reels_con_cta}</div>
          </div>
          <div className="glass-card p-5">
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Reels sin CTA</div>
            <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.reels_sin_cta}</div>
          </div>
        </div>
      )}

      {tokenDaysLeft !== null ? (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-[12px] leading-relaxed ${
            showTokenRenewal
              ? 'border-[var(--amber)]/35 bg-[var(--amber)]/10 text-[var(--amber)]'
              : 'border-[var(--border2)] bg-[var(--bg2)] text-[var(--text3)]'
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {showTokenRenewal ? (
                tokenDaysLeft === 0 ? (
                  'El token de Instagram venció. Renovalo para seguir sincronizando reels e historias.'
                ) : (
                  `Renová el token de Instagram: quedan ${tokenDaysLeft} día${tokenDaysLeft === 1 ? '' : 's'}.`
                )
              ) : (
                <>
                  Token Instagram:{' '}
                  <span className="font-medium text-[var(--text2)]">
                    {tokenDaysLeft} día{tokenDaysLeft === 1 ? '' : 's'} restantes
                  </span>
                  {tokenRenewByLabel ? (
                    <>
                      {' '}
                      · renovar antes del {tokenRenewByLabel}
                    </>
                  ) : null}
                  {tokenSavedAtLabel ? (
                    <>
                      {' '}
                      · colocado el {tokenSavedAtLabel}
                    </>
                  ) : null}
                  {' '}
                  (avisamos desde 5 días antes).
                </>
              )}
            </span>
            {showTokenRenewal ? (
              <div className="flex shrink-0 flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-wide">
                <Link href="/conexiones" className="underline underline-offset-2 hover:opacity-80">
                  Conexiones
                </Link>
                <Link href="/configuracion/instagram-token-guide" className="underline underline-offset-2 hover:opacity-80">
                  Guía token
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={handleRefreshMetrics}
          disabled={isSyncRunning}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30"
        >
          Actualizar métricas
        </button>
        <button
          onClick={handleSyncNewReels}
          disabled={isSyncRunning}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text)] hover:opacity-90 disabled:opacity-30"
        >
          Buscar nuevos reels
        </button>
        <button
          onClick={() => setShowRangeSyncModal(true)}
          disabled={isSyncRunning}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text)] hover:opacity-90 disabled:opacity-30"
        >
          Sincronizar reels
        </button>
      </div>
      {syncStatus.status === 'running' && (
        <div className="mb-4 glass-card p-4">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-[var(--text)]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
            {syncStatus.phase === 'collecting'
              ? 'Buscando reels en Instagram...'
              : 'Sincronizando con Instagram (metricas o nuevos reels)...'}
          </div>
          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--bg4)]">
            <div
              className={`h-full rounded-full bg-[var(--accent)] transition-all duration-500 ease-out ${syncStatus.phase === 'collecting' ? 'animate-pulse' : ''}`}
              style={{ width: `${syncStatus.phase === 'collecting' ? 100 : syncProgressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[12px] text-[var(--text3)]">
            <span>
              {syncStatus.phase === 'collecting'
                ? `Descubiertos: ${syncStatus.discovered || 0} reels`
                : `Sincronizando: ${syncStatus.processed} de ${syncStatus.total || '?'} reels`}
            </span>
            <span>{syncStatus.phase === 'collecting' ? '...' : `${syncProgressPct}%`}</span>
          </div>
        </div>
      )}
      {syncMessage && <div className={`mb-4 text-[12px] ${syncMessage.startsWith('Error') ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>{syncMessage}</div>}

      {reels.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">Sin reels para este filtro. Sincroniza Instagram para empezar.</div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {reels.map((reel) => (
            <ReelCard
              key={reel.id}
              reel={reel}
              masterLists={masterLists}
              isExpanded={expanded === reel.id}
              onToggle={() => setExpanded(expanded === reel.id ? null : reel.id)}
              onUpdate={updateField}
              onKeywordUpdate={updateKeyword}
              onClassificationUpdate={updateClassification}
              onRefresh={refreshReel}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-[12px] text-[var(--text3)]">Página {page} de {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
      {showComparisonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-5">
            <div className="mb-4 text-[14px] font-semibold">Comparar meses</div>
            <p className="mb-4 text-[12px] text-[var(--text3)]">
              Elegí dos meses distintos. Vas a ver métricas lado a lado y el listado de reels de ambos.
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] text-[var(--text3)]">Primer mes y año</label>
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
                <label className="mb-1 block text-[11px] text-[var(--text3)]">Segundo mes y año</label>
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
                    toast('Elegí los dos meses a comparar.')
                    return
                  }
                  if (comparisonDraftA === comparisonDraftB) {
                    toast('Elegí dos meses distintos para comparar.')
                    return
                  }
                  setComparisonByMonth(null)
                  setComparisonMonths([comparisonDraftA, comparisonDraftB])
                  setMonthMode('comparison')
                  setPage(1)
                  setShowComparisonModal(false)
                }}
                className="rounded-md bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white"
              >
                Comparar
              </button>
            </div>
          </div>
        </div>
      )}
      {showRangeSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-5">
            <div className="mb-4 text-[14px] font-semibold">Sincronizar reels</div>
            {rangeModalStep === 1 && (
              <>
                <p className="mb-3 text-[12px] text-[var(--text3)]">
                  Primero recorremos tu cuenta de Instagram solo para contar cuántos reels hay (sin bajar métricas ni thumbnails). Instagram los lista del{' '}
                  <span className="text-[var(--text)]">más reciente al más antiguo</span>; el contador va subiendo a medida que los vamos encontrando. Después elegís cuántos importar: siempre desde el último subido hacia atrás.
                </p>
                {rangeDiscoverLoading && (
                  <div className="mb-4 mt-4 rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-4 py-6 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                      Reels encontrados hasta ahora
                    </div>
                    <div
                      className={`font-mono-num mt-2 text-5xl font-bold tabular-nums text-[var(--text)] transition-transform duration-200 ease-out ${
                        discoverCountPulse ? 'scale-105' : 'scale-100'
                      }`}
                    >
                      {Number(syncStatus.discovered || 0)}
                    </div>
                    <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--bg4)]">
                      <div className="h-full w-full origin-left animate-pulse rounded-full bg-[var(--accent)]/70" />
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-[var(--text3)]">
                      Buscando en tu cuenta… el número se actualiza en vivo. La importación posterior respeta el mismo orden:{' '}
                      <span className="text-[var(--text)]">último publicado primero</span>.
                    </p>
                  </div>
                )}
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRangeSyncModal(false)
                      setRangeDiscoverLoading(false)
                      setRangePickingNewDates(false)
                    }}
                    className="rounded-md bg-[var(--bg4)] px-3 py-2 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={rangeDiscoverLoading || syncStatus.status === 'running'}
                    onClick={handleRangeDiscover}
                    className="rounded-md bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
                  >
                    Contar reels
                  </button>
                </div>
              </>
            )}
            {rangeModalStep === 2 && (
              <>
                {(() => {
                  const n = syncStatus.range_preview_count ?? syncStatus.discovered ?? 0
                  if (n <= 0) {
                    return (
                      <p className="mb-4 text-[12px] text-[var(--text3)]">
                        No se encontraron reels en la cuenta conectada.
                      </p>
                    )
                  }
                  return (
                    <>
                      <p className="mb-3 text-[12px] text-[var(--text3)]">
                        Se encontraron <span className="font-semibold text-[var(--text)]">{n}</span> reels en tu cuenta.
                        ¿Cuántos deseas traer? (máximo {n})
                      </p>
                      <p className="mb-3 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] p-3 text-[11px] leading-relaxed text-[var(--text3)]">
                        <span className="font-semibold text-[var(--text)]">Orden de importación:</span> siempre del{' '}
                        <span className="text-[var(--text)]">último reel subido hacia atrás</span> (más nuevo → más
                        antiguo). Ejemplo: si hay {n} en total y pedís 100, se traen los{' '}
                        <span className="text-[var(--text)]">100 más recientes</span>, no los primeros del historial.
                      </p>
                      <div>
                        <label className="mb-1 block text-[11px] text-[var(--text3)]">Cantidad a importar</label>
                        <input
                          type="number"
                          min={1}
                          max={n}
                          value={rangeImportTake}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              setRangeImportTake('')
                              return
                            }
                            const v = Math.trunc(Number(raw))
                            if (!Number.isFinite(v)) {
                              setRangeImportTake(raw)
                              return
                            }
                            setRangeImportTake(String(Math.min(n, Math.max(1, v))))
                          }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
                        />
                      </div>
                    </>
                  )
                })()}
                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      prevRangeModalStepRef.current = 1
                      setRangePickingNewDates(true)
                      setRangeModalStep(1)
                      setRangeDiscoverLoading(false)
                    }}
                    className="rounded-md bg-[var(--bg4)] px-3 py-2 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
                  >
                    Buscar de nuevo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRangeSyncModal(false)
                      setRangeDiscoverLoading(false)
                      setRangePickingNewDates(false)
                    }}
                    className="rounded-md bg-[var(--bg4)] px-3 py-2 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
                  >
                    Cerrar
                  </button>
                  {(syncStatus.range_preview_count ?? syncStatus.discovered ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={handleRangeImport}
                      disabled={syncStatus.status === 'running'}
                      className="rounded-md bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
                    >
                      Importar
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ReelCard({
  reel,
  masterLists,
  isExpanded,
  onToggle,
  onUpdate,
  onKeywordUpdate,
  onClassificationUpdate,
  onRefresh,
}: {
  reel: Reel
  masterLists: { dolores: string[]; angulos: string[]; ctas: string[] }
  isExpanded: boolean
  onToggle: () => void
  onUpdate: (id: string, field: 'cash' | 'chats', value: number) => void
  onKeywordUpdate: (id: string, keyword: string) => Promise<void>
  onClassificationUpdate: (id: string, partial: { dolor?: string; angulos?: string; cta?: string }) => Promise<void>
  onRefresh: (id: string) => void
}) {
  const { toast } = useToast()
  const [imgErr, setImgErr] = useState(false)
  const [dolor, setDolor] = useState(reel.classification?.dolor || '')
  const [angulos, setAngulos] = useState(() => {
    const a = reel.classification?.angulos
    if (Array.isArray(a)) return a.join(', ')
    if (typeof a === 'string') return a
    return ''
  })
  const [cta, setCta] = useState(reel.classification?.cta || '')
  const [classifySaving, setClassifySaving] = useState(false)
  const [keyword, setKeyword] = useState(reel.keyword || '')
  const [keywordSaveFlash, setKeywordSaveFlash] = useState(false)
  const [keywordSaving, setKeywordSaving] = useState(false)
  const rawThumb = String(reel.metrics?.thumbnail || '')

  useEffect(() => {
    setImgErr(false)
    setDolor(reel.classification?.dolor || '')
    const a = reel.classification?.angulos
    setAngulos(Array.isArray(a) ? a.join(', ') : typeof a === 'string' ? a : '')
    setCta(reel.classification?.cta || '')
    setKeyword(reel.keyword || '')
  }, [rawThumb, reel.classification?.dolor, reel.classification?.angulos, reel.classification?.cta, reel.keyword])

  useEffect(() => {
    setKeywordSaveFlash(false)
    setKeywordSaving(false)
    setClassifySaving(false)
  }, [reel.id])

  const persistClassification = async (partial: { dolor?: string; angulos?: string; cta?: string }) => {
    setClassifySaving(true)
    try {
      await onClassificationUpdate(reel.id, partial)
    } catch (e) {
      toast(`No se guardó la clasificación: ${(e as Error).message}`)
      throw e
    } finally {
      setClassifySaving(false)
    }
  }

  const thumb = rawThumb && !imgErr ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : ''
  const plays = Number(reel.metrics?.plays) || 0
  const likes = Number(reel.metrics?.likes) || 0
  const comments = Number(reel.metrics?.comments_count ?? reel.metrics?.comments) || 0
  const shares = Number(reel.metrics?.shares) || 0
  const reach = Number(reel.metrics?.reach) || 0
  const agendasDisplay =
    reel.agendas != null && !Number.isNaN(Number(reel.agendas)) ? formatInt(Number(reel.agendas)) : '—'
  const cpc = reel.chats > 0 ? reel.cash / reel.chats : 0
  const title = reel.title || reel.notes?.substring(0, 60) || 'Sin titulo'
  const [editingCash, setEditingCash] = useState(false)
  const [editingChats, setEditingChats] = useState(false)
  const [cashDraft, setCashDraft] = useState(String(Number(reel.cash || 0)))
  const [chatsDraft, setChatsDraft] = useState(String(Math.trunc(Number(reel.manual_chats || 0))))

  useEffect(() => {
    setCashDraft(String(Number(reel.cash || 0)))
    setChatsDraft(String(Math.trunc(Number(reel.manual_chats || 0))))
    setEditingCash(false)
    setEditingChats(false)
  }, [reel.cash, reel.chats, reel.manual_chats, reel.id])

  return (
    <div className={`glass-card overflow-hidden transition-all ${isExpanded ? 'col-span-4 grid grid-cols-[300px_1fr]' : 'cursor-pointer'}`} onClick={!isExpanded ? onToggle : undefined}>
      <div className="relative">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className={`w-full object-cover ${isExpanded ? 'h-full min-h-[300px]' : 'h-44'}`}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className={`w-full bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)] flex flex-col items-center justify-center ${isExpanded ? 'h-full min-h-[300px]' : 'h-44'}`}>
            <div className="text-3xl mb-1">🎥</div>
            <div className="text-[10px] text-[var(--text3)] px-3 text-center truncate max-w-full">{title}</div>
          </div>
        )}
        {!isExpanded && (
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
            <div className="font-mono-num text-lg font-bold text-[var(--green)]">{formatCash(reel.cash)}</div>
          </div>
        )}
        {reel.url && !isExpanded && (
          <a
            href={reel.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/70 hover:text-white transition-colors backdrop-blur-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          </a>
        )}
      </div>

      {!isExpanded && (
        <div className="p-3">
          <div className="text-[12px] font-medium truncate">{title}</div>
          <div className="text-[11px] text-[var(--text3)] mt-0.5">{reel.chats} chats · cash por chat {formatCash(cpc)}</div>
          {dolor && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-md border border-red-500/20 bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium text-red-400">{dolor}</span>
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <div className="p-5 space-y-4 overflow-y-auto max-h-[500px]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-semibold">{title}</div>
              <div className="text-[11px] text-[var(--text3)] mt-0.5">{formatDateDMY(reel.published_at)}</div>
            </div>
            <div className="flex items-center gap-2">
              {reel.url && (
                <a href={reel.url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--text2)] hover:text-[var(--text)] transition-colors">
                  Ver en Instagram →
                </a>
              )}
              <button onClick={onToggle} className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--text3)] hover:text-[var(--text)]">✕ Cerrar</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <div className="group relative rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Cash</div>
              {editingCash ? (
                <div className="mt-1 flex items-center justify-center gap-1">
                  <input
                    type="number"
                    value={cashDraft}
                    onChange={(e) => setCashDraft(e.target.value)}
                    className="w-24 rounded bg-[var(--bg3)] px-2 py-1 text-center font-mono-num text-[14px] font-bold text-[var(--green)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate(reel.id, 'cash', Number(cashDraft) || 0)
                      setEditingCash(false)
                    }}
                    className="rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-semibold text-white"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-center justify-center">
                  <div className="font-mono-num text-[16px] font-bold text-[var(--green)]">{formatCash(reel.cash)}</div>
                </div>
              )}
              {!editingCash && (
                <button
                  type="button"
                  onClick={() => setEditingCash(true)}
                  className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 text-[10px] text-[var(--text3)] hover:text-[var(--text)]"
                  title="Editar cash"
                >
                  ✎ Editar
                </button>
              )}
              <button
                type="button"
                onClick={() => onRefresh(reel.id)}
                className="absolute top-2 right-2 rounded bg-[var(--bg3)] px-2 py-0.5 text-[9px] text-[var(--text3)] hover:text-[var(--text)]"
                title="Actualizar métricas del reel"
              >
                Refrescar
              </button>
            </div>
            <div className="group relative rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
              {editingChats ? (
                <div className="mt-1 flex items-center justify-center gap-1">
                  <input
                    type="number"
                    value={chatsDraft}
                    onChange={(e) => setChatsDraft(e.target.value)}
                    className="w-24 rounded bg-[var(--bg3)] px-2 py-1 text-center font-mono-num text-[14px] font-bold text-[var(--text)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate(reel.id, 'chats', Math.trunc(Number(chatsDraft)) || 0)
                      setEditingChats(false)
                    }}
                    className="rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-semibold text-white"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-center justify-center">
                  <div className="font-mono-num text-[16px] font-bold text-[var(--text)]">{formatInt(reel.chats)}</div>
                </div>
              )}
              {!editingChats && (
                <button
                  type="button"
                  onClick={() => setEditingChats(true)}
                  className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 text-[10px] text-[var(--text3)] hover:text-[var(--text)]"
                  title="Editar chats"
                >
                  ✎ Editar
                </button>
              )}
              <button
                type="button"
                onClick={() => onRefresh(reel.id)}
                className="absolute top-2 right-2 rounded bg-[var(--bg3)] px-2 py-0.5 text-[9px] text-[var(--text3)] hover:text-[var(--text)]"
                title="Actualizar métricas del reel"
              >
                Refrescar
              </button>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Cash por chat</div>
              <div className="font-mono-num text-[16px] font-bold">{formatCash(cpc)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Agendas</div>
              <div className="font-mono-num text-[16px] font-bold">{agendasDisplay}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Plays</div>
              <div className="font-mono-num text-[16px] font-bold">{formatInt(plays)}</div>
            </div>
          </div>

          <div className="rounded-lg bg-[var(--bg4)] p-3">
            <div className="mb-2 text-[8px] uppercase tracking-wider text-[var(--text3)]">Keyword ManyChat</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-full rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1.5 text-[12px] outline-none"
                placeholder="ej: reel_agenda"
              />
              <button
                type="button"
                disabled={keywordSaving}
                onClick={async () => {
                  if (keywordSaving) return
                  setKeywordSaving(true)
                  try {
                    await onKeywordUpdate(reel.id, keyword)
                    setKeywordSaveFlash(true)
                    window.setTimeout(() => setKeywordSaveFlash(false), 2200)
                  } catch {
                    /* toast en el padre */
                  } finally {
                    setKeywordSaving(false)
                  }
                }}
                className={`rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase text-white transition-colors duration-300 disabled:opacity-50 ${
                  keywordSaveFlash ? 'bg-[var(--green)] shadow-[0_0_0_1px_rgba(74,222,128,0.5)]' : 'bg-[var(--accent)]'
                }`}
              >
                {keywordSaveFlash ? 'Guardado' : 'Guardar'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Likes</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(likes)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Comentarios</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(comments)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Shares</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(shares)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Reach</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(reach)}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-[var(--text3)]">Dolor</div>
              <select
                value={dolor}
                disabled={classifySaving}
                onChange={async (e) => {
                  const v = e.target.value
                  const prev = dolor
                  setDolor(v)
                  try {
                    await persistClassification({ dolor: v })
                  } catch {
                    setDolor(prev)
                  }
                }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="">Seleccionar...</option>
                {masterLists.dolores.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-[var(--text3)]">Angulos</div>
              <select
                value={angulos}
                disabled={classifySaving}
                onChange={async (e) => {
                  const v = e.target.value
                  const prev = angulos
                  setAngulos(v)
                  try {
                    await persistClassification({ angulos: v })
                  } catch {
                    setAngulos(prev)
                  }
                }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="">Seleccionar...</option>
                {masterLists.angulos.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-[var(--text3)]">CTA</div>
              <select
                value={cta}
                disabled={classifySaving}
                onChange={async (e) => {
                  const v = e.target.value
                  const prev = cta
                  setCta(v)
                  try {
                    await persistClassification({ cta: v })
                  } catch {
                    setCta(prev)
                  }
                }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="">Seleccionar...</option>
                {masterLists.ctas.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
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

function formatCash(value: number): string {
  const n = Number(value || 0)
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function formatInt(value: number): string {
  const n = Number(value || 0)
  return Math.trunc(n).toLocaleString('es-AR')
}

/** Fecha de publicación en calendario Argentina (alineado con Instagram AR). */
function formatDateDMY(value: string | null | undefined): string {
  if (!value) return 'Sin fecha'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

