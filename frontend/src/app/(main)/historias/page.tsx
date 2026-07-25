'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'
import { resolveMediaUrl } from '@/shared/lib/backend-public-url'
import { Line } from '@/shared/components/charts'
import { apiFetch } from '@/lib/api'
import { LineChart, Line as ReLine, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

type StorySlide = {
  id: number
  order_index: number
  image_url: string | null
  dolor: string | null
  angulo: string | null
  cta_text: string | null
  instagram_media_id: string | null
  views: number | null
  reach: number | null
  shares: number | null
  like_count: number | null
  replies: number | null
  navigation: number | null
  profile_visits: number | null
  synced_at: string | null
}

type StorySequence = {
  id: number
  sequence_date: string
  title: string | null
  dolor: string | null
  angulo: string | null
  cta_text: string | null
  cash_generado: number
  cash_manual?: number
  cash_leads?: number
  agendas?: number
  has_cta: boolean
  chats: number
  slides: StorySlide[]
  created_at: string
}

type StoriesMetrics = {
  chats_del_mes: number
  secuencias_con_cta: number
  secuencias_sin_cta: number
  stories_sincronizadas: number
}

type Secuencia = {
  id: number
  fecha: string
  slides: StorySlide[]
  totalReach: number
  /** Promedio de views (Graph API) entre los slides de la secuencia. */
  avgViews: number
  totalReplies: number
  dolor?: string
  angulo?: string
  cta_text?: string
  chats: number
  cash_generado: number
  cash_manual: number
  /** Suma de pagos de leads con esta historia como punto de agenda. */
  cash_leads: number
  /** Leads con punto de agenda = historia (viene del backend). */
  agendas: number
  notes: string
  secuenciaDesc: string
  hasSync: boolean
}

type SyncStatus = {
  last_sync: string | null
  next_sync: string | null
  token_saved_at?: string | null
  token_expires_at?: string | null
}

type YTVideo = { id: string; title: string }
const UNDO_DURATION = 6000
const INSTAGRAM_TOKEN_WARN_DAYS_LEFT = 5
const getImageUrl = (url: string | null | undefined) => resolveMediaUrl(url)
const toNumber = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Fecha de secuencia en pantalla: DD-MM-AAAA (API envía ISO YYYY-MM-DD o con hora). */
function formatSequenceDateDisplay(iso: string): string {
  const dayPart = String(iso || '').trim().slice(0, 10)
  const m = dayPart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(iso || '').trim() || '—'
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Alcance único por slide (Graph API `reach`); métrica principal de historias — no views ni navigation. */
const slideReachCount = (s: Pick<StorySlide, 'reach'>) => toNumber(s.reach)
/** Reproducciones/impresiones por slide (Graph API `views`). */
const slideViewsCount = (s: Pick<StorySlide, 'views'>) => toNumber(s.views)

const hasCtaValue = (value: string | null | undefined): boolean => {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return false
  return !['no', 'sin cta', 'ninguno', 'none', 'false', '0', 'n/a'].includes(normalized)
}

/** Misma story IG no se muestra dos veces (p. ej. manual + sync o doble sync). */
function dedupeSlidesByInstagramId(slides: StorySlide[]): StorySlide[] {
  const sorted = [...slides].sort((a, b) => a.order_index - b.order_index || a.id - b.id)
  const seen = new Set<string>()
  const out: StorySlide[] = []
  for (const s of sorted) {
    const mid = String(s.instagram_media_id ?? '').trim()
    if (mid) {
      if (seen.has(mid)) continue
      seen.add(mid)
    }
    out.push(s)
  }
  return out
}

export default function HistoriasPage() {
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [sequences, setSequences] = useState<StorySequence[]>([])
  const [metrics, setMetrics] = useState<StoriesMetrics>({
    chats_del_mes: 0,
    secuencias_con_cta: 0,
    secuencias_sin_cta: 0,
    stories_sincronizadas: 0,
  })
  const [ytVideos, setYtVideos] = useState<YTVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [masterLists, setMasterLists] = useState<{ dolores: string[]; angulos: string[]; ctas: string[] }>({ dolores: [], angulos: [], ctas: [] })
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [countdown, setCountdown] = useState<string>('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [detailSecuencia, setDetailSecuencia] = useState<Secuencia | null>(null)
  const [monthMode, setMonthMode] = useState<'current' | 'selected'>('current')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [monthDraft, setMonthDraft] = useState('')
  const [form, setForm] = useState<Record<string, string>>({ chats: '0', cash: '0' })
  const [formAngulos, setFormAngulos] = useState<string[]>([])
  const [formSlides, setFormSlides] = useState<string[]>([])
  const [formSlideThumbs, setFormSlideThumbs] = useState<string[]>([])
  const [formSelected, setFormSelected] = useState<Set<number>>(new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [showManualForm, setShowManualForm] = useState(false)
  const authHeaders = () => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('evoluciona_token') : null
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (userId) headers['X-User-Id'] = userId
    return headers
  }

  // Undo
  const [undoAction, setUndoAction] = useState<{ label: string; execute: () => Promise<void> } | null>(null)
  const [undoProgress, setUndoProgress] = useState(100)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentMonth = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }, [])

  const effectiveMonth = monthMode === 'current' ? currentMonth : selectedMonth || currentMonth

  const monthChoices = useMemo(() => {
    const fromSequences = sequences
      .map((s) => String(s.sequence_date || '').trim().slice(0, 7))
      .filter((ym) => /^\d{4}-\d{2}$/.test(ym))
    const merged = [...new Set([...fromSequences, ...recentMonthOptions(36)])]
    merged.sort((a, b) => b.localeCompare(a))
    return merged
  }, [sequences])

  const filterSubtitle = useMemo(() => {
    if (monthMode === 'current') return formatMonthLabel(currentMonth)
    if (monthMode === 'selected' && selectedMonth) return formatMonthLabel(selectedMonth)
    return formatMonthLabel(currentMonth)
  }, [monthMode, selectedMonth, currentMonth])
  const showUndo = (label: string, fn: () => Promise<void>) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    setUndoAction({ label, execute: fn }); setUndoProgress(100)
    const start = Date.now()
    undoIntervalRef.current = setInterval(() => { const r = Math.max(0, 100 - ((Date.now() - start) / UNDO_DURATION) * 100); setUndoProgress(r); if (r <= 0) { clearInterval(undoIntervalRef.current!); setUndoAction(null) } }, 50)
    undoTimerRef.current = setTimeout(() => { if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); setUndoAction(null) }, UNDO_DURATION)
  }
  const handleUndo = async () => { if (!undoAction) return; if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); await undoAction.execute(); setUndoAction(null); toast('Revertido'); fetchData() }

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const [seqRes, metricsRes] = await Promise.all([
        apiFetch(`/stories/sequences?month=${encodeURIComponent(effectiveMonth)}`, {
          headers: authHeaders(),
        }),
        apiFetch(`/stories/metrics?month=${encodeURIComponent(effectiveMonth)}`, {
          headers: authHeaders(),
        }),
      ])
      const seqData = await seqRes.json().catch(() => [])
      const metricsData = await metricsRes.json().catch(() => ({}))
      if (seqRes.ok && Array.isArray(seqData)) {
        setSequences(seqData as StorySequence[])
      } else {
        setSequences([])
      }
      if (metricsRes.ok) {
        setMetrics({
          chats_del_mes: Number(metricsData.chats_del_mes || 0),
          secuencias_con_cta: Number(metricsData.secuencias_con_cta || 0),
          secuencias_sin_cta: Number(metricsData.secuencias_sin_cta || 0),
          stories_sincronizadas: Number(metricsData.stories_sincronizadas || 0),
        })
      }
    } finally {
      setLoading(false)
    }
  }, [effectiveMonth, ready, userId])

  const handleDeleteSlide = useCallback(
    async (slideId: number, options?: { closeDetail?: boolean }) => {
      if (!ready || !userId) return
      if (!confirm('¿Eliminar esta historia de la secuencia?')) return
      const res = await apiFetch(`/stories/slides/${slideId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo eliminar: ${detail}`)
        return
      }
      toast('Historia eliminada')
      if (options?.closeDetail) setDetailSecuencia(null)
      await fetchData()
    },
    [ready, userId, fetchData, toast],
  )

  const fetchMasterLists = useCallback(async () => {
    if (!ready || !userId) return
    try {
      const res = await apiFetch('/master-lists', { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMasterLists({
          dolores: Array.isArray(data.dolores) ? data.dolores : [],
          angulos: Array.isArray(data.angulos) ? data.angulos : [],
          ctas: Array.isArray(data.ctas) ? data.ctas : [],
        })
      }
    } catch {
      setMasterLists({ dolores: [], angulos: [], ctas: [] })
    }
  }, [ready, userId])

  const fetchSyncStatus = useCallback(async () => {
    if (!ready) return
    const res = await apiFetch('/stories/sync-status', { headers: authHeaders() })
    const data = await res.json().catch(() => ({ last_sync: null, next_sync: null, token_saved_at: null, token_expires_at: null }))
    if (res.ok) {
      setSyncStatus({
        last_sync: data.last_sync || null,
        next_sync: data.next_sync || null,
        token_saved_at: data.token_saved_at || null,
        token_expires_at: data.token_expires_at || null,
      })
    }
  }, [ready, userId])

  useEffect(() => { fetchData(); fetchSyncStatus(); fetchMasterLists() }, [fetchData, fetchSyncStatus, fetchMasterLists])

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
    const refresh = () => {
      void fetchSyncStatus()
      void fetchData()
    }
    window.addEventListener('stories-sync-settings-updated', refresh)
    return () => window.removeEventListener('stories-sync-settings-updated', refresh)
  }, [fetchSyncStatus, fetchData])

  // Group stories by date -> secuencias (includes manual secuencias without Metricool stories)
  const secuencias: Secuencia[] = useMemo(() => {
    return sequences.map((seq) => {
      const slides = dedupeSlidesByInstagramId(seq.slides)
      const angulos = Array.from(new Set(slides.map((s) => s.angulo || '').filter(Boolean)))
      const dolor = seq.dolor || slides.find((s) => s.dolor)?.dolor || ''
      const ctaText = seq.cta_text || slides.find((s) => s.cta_text)?.cta_text || ''
      return {
        id: seq.id,
        fecha: seq.sequence_date,
        slides,
        totalReach: slides.reduce((acc, s) => acc + slideReachCount(s), 0),
        avgViews: slides.length > 0
          ? Math.round(slides.reduce((acc, s) => acc + slideViewsCount(s), 0) / slides.length)
          : 0,
        totalReplies: slides.reduce((acc, s) => acc + toNumber(s.replies), 0),
        dolor,
        angulo: seq.angulo || angulos[0] || '',
        cta_text: ctaText,
        chats: toNumber(seq.chats),
        cash_manual: toNumber(seq.cash_manual ?? seq.cash_generado),
        cash_generado: toNumber(seq.cash_generado),
        cash_leads: toNumber(seq.cash_leads),
        agendas: toNumber(seq.agendas),
        notes: seq.title || '',
        secuenciaDesc: (seq.title || '').trim(),
        hasSync: slides.some((s) => Boolean(s.instagram_media_id)),
      }
    })
  }, [sequences])

  // Sync Instagram
  const handleSync = async () => {
    setSyncing(true)
    setSyncMessage('Sincronizando...')
    try {
      const res = await apiFetch('/stories/sync', {
        method: 'POST',
        headers: authHeaders(),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSyncMessage(`Error: ${result.detail || 'No se pudo sincronizar Instagram'}`)
      } else {
        const okText = `Sincronizadas: ${Number(result.synced || 0)} | Sin match: ${Number(result.not_matched || 0)}`
        setSyncMessage(result.warning ? `${okText} — ${result.warning}` : okText)
        toast(okText)
        if (result.warning) toast(String(result.warning))
        await fetchData()
        await fetchSyncStatus()
      }
    } catch (e) {
      setSyncMessage(`Error: ${(e as Error).message}`)
    }
    setSyncing(false)
  }

  useEffect(() => {
    if (!syncStatus?.next_sync) return
    const interval = setInterval(() => {
      const now = new Date()
      const next = new Date(syncStatus.next_sync as string)
      const diff = next.getTime() - now.getTime()
      if (diff <= 0) {
        handleSync().then(() => fetchSyncStatus())
        setCountdown('Sincronizando...')
        clearInterval(interval)
        return
      }
      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [syncStatus?.next_sync])

  // Crop stories from screenshot using AI grid info
  const cropStoriesFromImage = (imgSrc: string, gridInfo: { headerHeightPercent: number; rows: number; cols: number }, positions: number[]): Promise<string[]> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const cols = gridInfo.cols || 3
        const headerOffset = Math.floor(img.height * (gridInfo.headerHeightPercent || 15) / 100)
        const gridHeight = img.height - headerOffset
        const rows = gridInfo.rows || Math.ceil(gridHeight / (img.width / cols * 16 / 9))
        const cellW = Math.floor(img.width / cols)
        const cellH = Math.floor(gridHeight / rows)
        const padX = Math.floor(cellW * 0.02)
        const padY = Math.floor(cellH * 0.02)
        const thumbs: string[] = []
        for (const pos of positions) {
          const idx = pos - 1
          const row = Math.floor(idx / cols)
          const col = idx % cols
          const x = col * cellW + padX
          const y = headerOffset + row * cellH + padY
          const w = cellW - padX * 2
          const h = Math.min(cellH - padY * 2, img.height - y)
          if (y >= img.height || w <= 0 || h <= 0) continue
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
          thumbs.push(canvas.toDataURL('image/jpeg', 0.7))
        }
        resolve(thumbs)
      }
      img.src = imgSrc
    })
  }

  // Analyze screenshot
  const handleScreenshot = async (file: File) => {
    setAnalyzing(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve) => { reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file) })
      const base64 = dataUrl.split(',')[1]
      const res = await fetch('/api/analyze-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mediaType: file.type || 'image/jpeg' }) })
      const data = await res.json()
      if (data.success) {
        const seqPositions: number[] = data.sequencePositions || []
        const allDescs: string[] = data.allSlides || data.slides || []
        const total = data.totalStoriesInGrid || allDescs.length
        setForm(prev => ({ ...prev, dolor: data.dolor || '', fecha: prev.fecha || new Date().toISOString().split('T')[0] }))
        setFormAngulos(data.angulos || [])
        setFormSlides(allDescs)
        setFormSelected(new Set(seqPositions))
        const gridInfo = data.gridInfo || { headerHeightPercent: 15, rows: 3, cols: 3 }
        const allPositions = Array.from({ length: total }, (_, i) => i + 1)
        const thumbs = await cropStoriesFromImage(dataUrl, gridInfo, allPositions)
        setFormSlideThumbs(thumbs)
        toast(`IA detecto ${seqPositions.length} de ${total} stories`)
        fetchData()
      } else { toast(`Error IA: ${data.error}`) }
    } catch (e) { toast(`Error: ${(e as Error).message}`) }
    setAnalyzing(false)
  }

  // Save new secuencia (manual)
  const saveNewSecuencia = async () => {
    if (!form.fecha) { toast('Pone la fecha'); return }
    const selectedSlides = formSlides
      .map((desc, idx) => ({ desc, idx }))
      .filter((x) => formSelected.has(x.idx + 1))
      .filter((x) => x.desc.trim().length > 0)
    if (selectedSlides.length === 0) { toast('Selecciona al menos una story'); return }
    const tieneCTA = hasCtaValue(form.cta)
    const titulo = form.secuenciaDesc || `Secuencia ${formatSequenceDateDisplay(form.fecha)}`
    const selectedThumbs = formSlideThumbs.filter((_, i) => formSelected.has(i + 1))
    const res = await apiFetch('/stories/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        sequence_date: form.fecha,
        title: titulo || null,
        has_cta: tieneCTA,
        chats: Number(form.chats) || 0,
        slides: selectedSlides.map((s, i) => ({
          order_index: i + 1,
          image_url: selectedThumbs[i] || null,
          dolor: form.dolor || null,
          angulo: formAngulos[0] || null,
          cta_text: form.cta || null,
        })),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast(`Error al guardar: ${body.detail || 'No se pudo guardar'}`); return }
    toast('Secuencia agregada')
    setForm({ chats: '0', cash: '0' }); setFormAngulos([]); setFormSlides([]); setFormSlideThumbs([]); setFormSelected(new Set()); setShowManualForm(false)
    await fetchData()
  }

  // Save secuencia metadata (inline edit)
  const saveSecuencia = async (sec: Secuencia, overrides?: Partial<{
    dolor: string
    angulo: string
    cta_text: string
    cash_generado: number
    chats: number
  }>) => {
    const dolor = overrides?.dolor ?? form.dolor ?? sec.dolor ?? ''
    const angulo = overrides?.angulo ?? formAngulos[0] ?? sec.angulo ?? ''
    const ctaText = overrides?.cta_text ?? form.cta ?? sec.cta_text ?? ''
    const cashGenerado =
      overrides?.cash_generado ?? (Number(form.cash) || sec.cash_manual || 0)
    const chats = overrides?.chats ?? (Number(form.chats) || sec.chats || 0)
    const res = await apiFetch(`/stories/sequences/${sec.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        sequence_date: sec.fecha,
        title: form.secuenciaDesc || sec.notes || null,
        dolor: dolor || null,
        angulo: angulo || null,
        cta_text: ctaText || null,
        cash_generado: cashGenerado,
        has_cta: hasCtaValue(ctaText),
        chats,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast(`Error al guardar: ${body.detail || 'No se pudo actualizar'}`)
      return
    }
    toast('Secuencia guardada')
    setExpanded(null); setForm({ chats: '0', cash: '0' }); setFormAngulos([])
    await fetchData()
  }

  const patchSecuencia = async (
    sec: Secuencia,
    payload: {
      dolor?: string
      angulo?: string
      cta?: boolean
      cash_manual?: number
      chats?: number
    },
  ) => {
    const res = await apiFetch(`/stories/sequences/${sec.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast(`Error al guardar: ${body.detail || 'No se pudo actualizar'}`)
      return false
    }
    toast('Secuencia guardada')
    await fetchData()
    return true
  }

  const startEdit = (sec: Secuencia) => {
    setExpanded(sec.id)
    setForm({
      dolor: sec.dolor || '',
      cta: sec.cta_text || '',
      chats: String(sec.chats),
      cash: String(sec.cash_manual),
      notes: sec.notes,
      secuenciaDesc: sec.secuenciaDesc,
    })
    setFormAngulos(sec.angulo ? [sec.angulo] : [])
  }

  // Master list creators
  const addToList = async (category: 'dolores' | 'angulos' | 'ctas', value: string) => {
    const clean = value.trim()
    if (!clean) return
    const existing = masterLists[category] || []
    if (existing.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      toast('Ya existe')
      return
    }
    const res = await apiFetch(`/master-lists/${category}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ item: clean }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast(`Error al guardar lista: ${String((data as { detail?: unknown }).detail || 'error')}`)
      return
    }
    setMasterLists({
      dolores: Array.isArray(data.dolores) ? data.dolores : [],
      angulos: Array.isArray(data.angulos) ? data.angulos : [],
      ctas: Array.isArray(data.ctas) ? data.ctas : [],
    })
    toast('Creado')
  }

  const totalChats = metrics.chats_del_mes
  const conCTA = metrics.secuencias_con_cta
  const sinCTA = metrics.secuencias_sin_cta
  const tokenExpiresAt = syncStatus?.token_expires_at ? new Date(syncStatus.token_expires_at) : null
  const tokenDaysLeft =
    tokenExpiresAt && !Number.isNaN(tokenExpiresAt.getTime())
      ? Math.max(0, Math.floor((tokenExpiresAt.getTime() - Date.now()) / 86400000))
      : null
  const showTokenRenewal =
    tokenDaysLeft !== null && tokenDaysLeft <= INSTAGRAM_TOKEN_WARN_DAYS_LEFT
  const tokenStatusColor =
    tokenDaysLeft === null
      ? 'text-[var(--text3)]'
      : tokenDaysLeft < 5
        ? 'text-[var(--red)]'
        : tokenDaysLeft <= 10
          ? 'text-[var(--amber)]'
          : 'text-[var(--text3)]'

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          Historias{' '}
          <span className="text-[var(--text3)] text-sm font-normal">{filterSubtitle}</span>
        </h2>
        <div className="inline-flex gap-2 rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-1">
          <button
            type="button"
            onClick={() => setMonthMode('current')}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'current' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            MES ACTUAL
          </button>
          <button
            type="button"
            onClick={() => {
              const opts = monthChoices
              setMonthDraft(
                monthMode === 'selected' && selectedMonth
                  ? selectedMonth
                  : opts[1] || opts[0] || currentMonth,
              )
              setShowMonthModal(true)
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'selected' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            SELECCIONAR MES Y AÑO
          </button>
        </div>
      </div>

      {showMonthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-5">
            <div className="mb-4 text-[14px] font-semibold">Seleccionar mes y año</div>
            <p className="mb-4 text-[12px] text-[var(--text3)]">
              Elegí el mes para ver secuencias, métricas y chats de historias.
            </p>
            <div>
              <label className="mb-1 block text-[11px] text-[var(--text3)]">Mes y año</label>
              <select
                value={monthDraft}
                onChange={(e) => setMonthDraft(e.target.value)}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] capitalize text-[var(--text)] outline-none"
              >
                {monthChoices.map((ym) => (
                  <option key={ym} value={ym}>
                    {formatMonthLabel(ym)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMonthModal(false)}
                className="rounded-md bg-[var(--bg4)] px-3 py-2 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!monthDraft) {
                    toast('Elegí un mes.')
                    return
                  }
                  setSelectedMonth(monthDraft)
                  setMonthMode('selected')
                  setShowMonthModal(false)
                }}
                className="rounded-md bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats row — 4 cards */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats del mes</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{totalChats}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Secuencias con CTA</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{conCTA}</div>
        </div>
        <div className="glass-card p-5 border-[var(--accent)]">
          <div className="text-[10px] text-[var(--accent)] uppercase tracking-wider">Secuencias sin CTA</div>
          <div className="font-mono-num mt-1 text-3xl font-bold text-[var(--accent)]">{sinCTA}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Stories sincronizadas</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.stories_sincronizadas}</div>
        </div>
      </div>

      {/* Sync + manual add */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={handleSync} disabled={syncing} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30">
          {syncing ? 'Sincronizando...' : 'SINCRONIZAR INSTAGRAM'}
        </button>
        {!showManualForm && (
          <button onClick={() => setShowManualForm(true)} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
            + Agregar secuencia manualmente
          </button>
        )}
      </div>
      {syncMessage && <div className={`mb-4 text-[12px] ${syncMessage.startsWith('Error') ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>{syncMessage}</div>}
      {syncStatus && (
        <div className="mb-4 text-sm text-zinc-400">
          <div className="flex items-center gap-4">
            {syncStatus.last_sync && (
              <span>
                Último sync: {new Date(syncStatus.last_sync).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </span>
            )}
            {countdown && (
              <span className="text-zinc-300">
                Próximo en: <span className="font-mono text-white">{countdown}</span>
              </span>
            )}
          </div>
          <div className={`mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${tokenStatusColor}`}>
            {tokenDaysLeft !== null ? (
              <>
                <span className="flex items-center gap-2">
                  {showTokenRenewal && <span aria-hidden="true">⚠️</span>}
                  {showTokenRenewal ? (
                    tokenDaysLeft === 0 ? (
                      'El token de Instagram venció. Renovalo para seguir sincronizando historias.'
                    ) : (
                      `Renová el token de Instagram: quedan ${tokenDaysLeft} día${tokenDaysLeft === 1 ? '' : 's'}.`
                    )
                  ) : (
                    <>Token Instagram: {tokenDaysLeft} día{tokenDaysLeft === 1 ? '' : 's'} restantes (avisamos desde 5 días antes).</>
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
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Manual secuencia form (overlay section) */}
      {showManualForm && (
        <div className="glass-card p-6 mb-6 border-[var(--accent)]">
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] mb-4">Nueva secuencia de historias</div>
          {/* Screenshot upload */}
          <div className="mb-4 glass-card p-5 relative accent-top">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--accent)] mb-3">Subir screenshot de historias (la IA analiza automaticamente)</div>
            <label className={`block min-h-[80px] rounded-lg border-2 border-dashed ${analyzing ? 'border-[var(--accent)]' : 'border-[var(--border2)]'} bg-[var(--bg3)] flex items-center justify-center cursor-pointer hover:border-[var(--accent)] transition-all`}>
              <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleScreenshot(e.target.files[0]) }} />
              <div className="text-center p-4">
                {analyzing ? <div className="text-[var(--accent)] text-[13px]">Analizando con IA...</div>
                  : formSlides.length > 0 ? <div className="text-[var(--green)] text-[13px]">{formSlides.length} slides detectados — subi otra imagen para reanalizar</div>
                  : <><div className="text-[13px] text-[var(--text3)]">Subi o arrastra el screenshot de tus historias</div><div className="text-[10px] text-[var(--text3)] mt-1">.JPG, .PNG</div></>}
              </div>
            </label>
          </div>
          {/* Slide thumbnails — click to select/deselect */}
          {formSlides.length > 0 && (
            <div className="mb-4">
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                Click para seleccionar/deseleccionar stories ({formSelected.size} de {formSlides.length})
              </label>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {formSlides.map((_, i) => {
                  const pos = i + 1
                  const isSelected = formSelected.has(pos)
                  return (
                    <button key={i} type="button" onClick={() => setFormSelected(prev => { const next = new Set(prev); if (next.has(pos)) next.delete(pos); else next.add(pos); return next })}
                      className={`flex-shrink-0 w-20 rounded-lg overflow-hidden transition-all cursor-pointer ${isSelected ? 'border-2 border-[var(--accent)] ring-2 ring-[var(--accent)] ring-opacity-30' : 'border border-[var(--border)] opacity-40 hover:opacity-70'}`}>
                      {formSlideThumbs[i] ? <img src={formSlideThumbs[i]} alt={`Slide ${pos}`} className="w-full h-36 object-cover" />
                        : <div className="w-full h-36 bg-[var(--bg4)] flex items-center justify-center text-[var(--text3)] text-lg font-bold">{pos}</div>}
                      <div className={`px-2 py-1.5 text-center ${isSelected ? 'bg-[var(--accent)]' : 'bg-[var(--bg3)]'}`}>
                        <div className={`text-[9px] font-semibold ${isSelected ? 'text-white' : 'text-[var(--text3)]'}`}>{pos}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* Form fields */}
          <div className="grid grid-cols-5 gap-3 mb-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Dolor</label>
              <select value={form.dolor || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo dolor:'); if (v) { await addToList('dolores', v); setForm(p => ({ ...p, dolor: v.trim() })) } } else setForm(p => ({ ...p, dolor: e.target.value })) }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                <option value="">Seleccionar...</option>
                {masterLists.dolores.map(d => <option key={d} value={d}>{d}</option>)}
                <option value="__new__">+ Crear nuevo...</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Angulos</label>
              <select
                value={formAngulos[0] || ''}
                onChange={async e => {
                  if (e.target.value === '__new__') {
                    const v = prompt('Nuevo angulo:')
                    if (v) {
                      await addToList('angulos', v)
                      setFormAngulos([v.trim()])
                    }
                  } else {
                    setFormAngulos(e.target.value ? [e.target.value] : [])
                  }
                }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer"
              >
                <option value="">Seleccionar...</option>
                {masterLists.angulos.map(a => <option key={a} value={a}>{a}</option>)}
                <option value="__new__">+ Crear nuevo...</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</label>
              <input type="date" value={form.fecha || ''} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">CTA</label>
              <select value={form.cta || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo CTA:'); if (v) { await addToList('ctas', v); setForm(p => ({ ...p, cta: v.trim() })) } } else setForm(p => ({ ...p, cta: e.target.value })) }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                <option value="">Seleccionar...</option>
                {ytVideos.length > 0 && <optgroup label="Videos de YouTube">{ytVideos.map(v => <option key={v.id} value={`YT: ${v.title}`}>{v.title}</option>)}</optgroup>}
                {masterLists.ctas.length > 0 && <optgroup label="CTAs">{masterLists.ctas.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>}
                <option value="__new__">+ Crear nuevo...</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Chats</label>
              <input type="number" value={form.chats || '0'} onChange={e => setForm(p => ({ ...p, chats: e.target.value }))} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveNewSecuencia} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90">+ Agregar Secuencia</button>
            <button onClick={() => { setShowManualForm(false); setForm({ chats: '0', cash: '0' }); setFormAngulos([]); setFormSlides([]); setFormSlideThumbs([]); setFormSelected(new Set()) }} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cancelar</button>
          </div>
        </div>
      )}

      {/* Secuencias list */}
      {secuencias.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--text3)]">No hay historias este mes. Apreta &quot;SINCRONIZAR INSTAGRAM&quot; para importar.</div>
      ) : (
        <div className="space-y-4">
          {secuencias.map(sec => {
            const isExpanded = expanded === sec.id
            const cpc = sec.chats > 0 ? sec.cash_generado / sec.chats : 0
            const hasSlides = sec.slides.length > 0
            const slideCount = hasSlides ? sec.slides.length : 0

            return (
              <div key={sec.fecha} className={`glass-card p-5 transition-all ${isExpanded ? 'border-[var(--accent)]' : 'cursor-pointer hover:border-[var(--border2)]'}`}
                onClick={() => { if (!isExpanded) startEdit(sec) }}>
                {/* Header with date + metrics */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <div className="text-[14px] font-semibold">{formatSequenceDateDisplay(sec.fecha)}</div>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">ALCANCE: {sec.totalReach.toLocaleString('es-AR')}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">VIS. PROM.: {sec.avgViews.toLocaleString('es-AR')}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">CASH: {formatCash(sec.cash_generado)}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">CHATS: {sec.chats}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">AGENDAS: {sec.agendas}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">CPC: {formatCash(cpc)}</span>
                    {sec.hasSync
                      ? <span className="rounded bg-[rgba(34,197,94,0.15)] px-2 py-1 text-[10px] text-[var(--green)] font-medium">SINCRONIZADO</span>
                      : <span className="rounded bg-[rgba(161,161,170,0.15)] px-2 py-1 text-[10px] text-[var(--text3)] font-medium">Sin sincronizar</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isExpanded && (
                      <button onClick={async (e) => {
                        e.stopPropagation()
                        if (!confirm(`Eliminar secuencia del ${formatSequenceDateDisplay(sec.fecha)}?`)) return
                        await apiFetch(`/stories/sequences/${sec.id}`, {
                          method: 'DELETE',
                          headers: authHeaders(),
                        })
                        toast('Secuencia eliminada')
                        if (expanded === sec.id) setExpanded(null)
                        fetchData()
                      }} className="text-[var(--text3)] hover:text-[var(--red)] text-[13px]" title="Eliminar">✕</button>
                    )}
                    {isExpanded && (
                      <button onClick={(e) => { e.stopPropagation(); setExpanded(null); setForm({ chats: '0', cash: '0' }); setFormAngulos([]) }} className="text-[var(--text3)] hover:text-[var(--text)] text-[13px]" title="Cerrar">✕</button>
                    )}
                  </div>
                </div>

                {/* Slide strip — only visible when collapsed */}
                {!isExpanded && hasSlides ? (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                    {sec.slides.map((slide, i) => {
                      const thumb = getImageUrl(slide.image_url)
                      return (
                        <div key={slide.id} className="flex-shrink-0 w-[120px] h-[200px] rounded-lg bg-[var(--bg4)] border border-[var(--border)] overflow-hidden relative cursor-pointer" onClick={(e) => { e.stopPropagation(); setDetailSecuencia(sec) }}>
                          <button
                            type="button"
                            title="Eliminar esta historia"
                            className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-[14px] font-bold text-white hover:bg-[#F87171]"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDeleteSlide(slide.id)
                            }}
                          >
                            ×
                          </button>
                          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover rounded-lg" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)] text-[10px]">{i + 1}</div>}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[8px] text-white py-0.5">{i + 1}/{slideCount}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : !isExpanded ? (
                  <div className="mb-3 text-[11px] text-[var(--text3)] italic">Secuencia manual — sin preview</div>
                ) : null}

                {/* Classification tags (collapsed view) */}
                {!isExpanded && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDetailSecuencia(sec) }} className="rounded bg-[rgba(230,57,70,0.15)] px-2.5 py-1 text-[10px] text-[var(--red)] font-medium">DOLOR: {sec.dolor || '—'}</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDetailSecuencia(sec) }} className="rounded bg-[rgba(245,158,11,0.15)] px-2.5 py-1 text-[10px] text-[var(--amber)] font-medium">ANGULO: {sec.angulo || '—'}</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDetailSecuencia(sec) }} className="rounded bg-[rgba(59,130,246,0.15)] px-2.5 py-1 text-[10px] text-[var(--blue)] font-medium">CTA: {sec.cta_text || '—'}</button>
                  </div>
                )}

                {/* Expanded: full detail view */}
                {isExpanded && (() => {
                  // Build slide data from Metricool stories OR base64 thumbnails
                  const slideMetrics = sec.slides.map((s, i) => ({
                    slideId: s.id,
                    idx: i + 1,
                    reach: slideReachCount(s),
                    likes: Number(s.replies || 0),
                    shares: toNumber(s.shares),
                    thumb: getImageUrl(s.image_url) || null,
                  }))
                  const maxReach = Math.max(...slideMetrics.map(s => s.reach), 1)
                  const retentionData = slideMetrics.map(s => maxReach > 0 ? (s.reach / maxReach) * 100 : 100)
                  const hasMetrics = slideMetrics.some(s => s.reach > 0)

                  return (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]" onClick={e => e.stopPropagation()}>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash generado</div>
                        <div className="font-mono-num text-2xl font-bold text-[var(--green)]">
                          {formatCash(sec.cash_generado)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
                        <input type="number" value={form.chats || '0'} onChange={e => setForm(p => ({ ...p, chats: e.target.value }))}
                          className="w-full bg-transparent text-center font-mono-num text-2xl font-bold text-[var(--text)] outline-none" />
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash por Chat</div>
                        <div className="font-mono-num text-2xl font-bold">
                          {sec.chats > 0 ? formatCash(sec.cash_generado / sec.chats) : '$0'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Agendas</div>
                        <div className="font-mono-num text-2xl font-bold text-[var(--text)]">{sec.agendas}</div>
                      </div>
                    </div>

                    {/* Stories with thumbnails + dropoff between them */}
                    {slideMetrics.length > 0 && (
                      <div className="mb-5">
                        <div className="flex items-end overflow-x-auto pb-2">
                          {slideMetrics.map((s, i) => {
                            const dropoff = i > 0 && slideMetrics[i - 1].reach > 0
                              ? Math.round(((slideMetrics[i - 1].reach - s.reach) / slideMetrics[i - 1].reach) * 100)
                              : 0
                            return (
                              <div key={s.slideId} className="flex items-end flex-1 min-w-0">
                                {/* Dropoff between stories */}
                                {i > 0 && hasMetrics && (
                                  <div className="flex flex-col items-center justify-center w-6 flex-shrink-0 mb-14">
                                    <div className={`text-[9px] font-mono-num font-bold ${dropoff > 10 ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>
                                      {dropoff > 0 ? `-${dropoff}%` : '0%'}
                                    </div>
                                  </div>
                                )}
                                {!hasMetrics && i > 0 && (
                                  <div className="w-2 flex-shrink-0" />
                                )}
                                {/* Story card — fixed width to avoid giant single-slide cards */}
                                <div className="w-[120px] flex-shrink-0 text-center">
                                  <div className="relative aspect-[9/16] rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg4)] mb-1.5">
                                    <button
                                      type="button"
                                      title="Eliminar esta historia"
                                      className="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded bg-black/55 text-[11px] font-bold text-white hover:bg-[#F87171]"
                                      onClick={() => void handleDeleteSlide(s.slideId)}
                                    >
                                      ×
                                    </button>
                                    {s.thumb ? <img src={s.thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)] text-lg font-bold">{s.idx}</div>}
                                  </div>
                                  {hasMetrics && (
                                    <>
                                      <div className="text-[9px] text-[var(--text3)]">Alcance: <span className="font-mono-num text-[var(--text)]">{s.reach.toLocaleString('es-AR')}</span></div>
                                      <div className="text-[9px] text-[var(--text3)]">Replies: <span className="font-mono-num text-[var(--text)]">{s.likes}</span></div>
                                      <div className="text-[9px] text-[var(--text3)]">Compartidos: <span className="font-mono-num text-[var(--text)]">{s.shares.toLocaleString()}</span></div>
                                    </>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Classification — Dolor, Angulo, CTA */}
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Dolor</label>
                        <select value={form.dolor || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo dolor:'); if (v) { await addToList('dolores', v); setForm(p => ({ ...p, dolor: v.trim() })) } } else setForm(p => ({ ...p, dolor: e.target.value })) }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                          <option value="">Seleccionar...</option>
                          {masterLists.dolores.map(d => <option key={d} value={d}>{d}</option>)}
                          <option value="__new__">+ Crear nuevo...</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Angulos</label>
                        <select
                          value={formAngulos[0] || ''}
                          onChange={async e => {
                            if (e.target.value === '__new__') {
                              const v = prompt('Nuevo angulo:')
                              if (v) {
                                await addToList('angulos', v)
                                setFormAngulos([v.trim()])
                              }
                            } else {
                              setFormAngulos(e.target.value ? [e.target.value] : [])
                            }
                          }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer"
                        >
                          <option value="">Seleccionar...</option>
                          {masterLists.angulos.map(a => <option key={a} value={a}>{a}</option>)}
                          <option value="__new__">+ Crear nuevo...</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">CTA</label>
                        <select value={form.cta || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo CTA:'); if (v) { await addToList('ctas', v); setForm(p => ({ ...p, cta: v.trim() })) } } else setForm(p => ({ ...p, cta: e.target.value })) }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                          <option value="">Seleccionar...</option>
                          {ytVideos.length > 0 && <optgroup label="Videos de YouTube">{ytVideos.map(v => <option key={v.id} value={`YT: ${v.title}`}>▶ {v.title}</option>)}</optgroup>}
                          {masterLists.ctas.length > 0 && <optgroup label="CTAs">{masterLists.ctas.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>}
                          <option value="__new__">+ Crear nuevo...</option>
                        </select>
                      </div>
                    </div>

                    {/* Retention chart — only when we have real metrics */}
                    {hasMetrics && slideMetrics.length > 1 && (
                      <div className="mb-5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">Retención de alcance entre slides</div>
                        <div className="h-32">
                          <Line data={{
                            labels: slideMetrics.map(s => `S${s.idx}`),
                            datasets: [{
                              data: retentionData,
                              borderColor: '#E63946',
                              backgroundColor: 'rgba(230,57,70,0.1)',
                              fill: true, tension: 0.3, pointRadius: 3,
                              pointBackgroundColor: '#E63946', borderWidth: 2,
                            }],
                          }} options={{
                            responsive: true, maintainAspectRatio: false,
                            scales: {
                              x: { grid: { display: false }, ticks: { color: '#A1A1AA', font: { size: 9 } } },
                              y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%`, color: '#52525B', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.03)' } },
                            },
                            plugins: { tooltip: { callbacks: { label: (ctx) => `${Number(ctx.raw).toFixed(1)}% retención (vs 1er slide, alcance)` } }, legend: { display: false } },
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Save / Close */}
                    <div className="flex gap-3">
                      <button onClick={() => saveSecuencia(sec)} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90">Guardar</button>
                      <button onClick={() => { setExpanded(null); setForm({ chats: '0', cash: '0' }); setFormAngulos([]) }} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cerrar</button>
                    </div>
                  </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}

      {/* Undo toast */}
      {undoAction && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] glass-card overflow-hidden shadow-lg border border-[var(--border2)] min-w-[320px]">
          <div className="flex items-center gap-4 px-5 py-3.5">
            <span className="text-[13px] text-[var(--text2)]">{undoAction.label}</span>
            <button onClick={handleUndo} className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-[11px] font-semibold uppercase text-white">Deshacer</button>
            <button onClick={() => { setUndoAction(null); if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current) }} className="text-[var(--text3)] text-sm">x</button>
          </div>
          <div className="h-[3px] bg-[var(--bg4)]"><div className="h-full bg-[var(--accent)] transition-[width] duration-[50ms] ease-linear" style={{ width: `${undoProgress}%` }} /></div>
        </div>
      )}

      {detailSecuencia && (
        <StorySequenceDetail
          sequence={detailSecuencia}
          onClose={() => setDetailSecuencia(null)}
          onDeleteSlide={(slideId) => handleDeleteSlide(slideId, { closeDetail: true })}
          onSave={async (payload) => {
            const ok = await patchSecuencia(detailSecuencia, {
              dolor: payload.dolor,
              angulo: payload.angulo,
              cta: hasCtaValue(payload.cta_text),
              cash_manual: payload.cash_manual,
              chats: payload.chats,
            })
            if (ok) setDetailSecuencia(null)
          }}
        />
      )}
    </div>
  )
}

function StorySequenceDetail({
  sequence,
  onClose,
  onSave,
  onDeleteSlide,
}: {
  sequence: Secuencia
  onClose: () => void
  onSave: (payload: { dolor: string; angulo: string; cta_text: string; cash_manual: number; chats: number }) => Promise<void>
  onDeleteSlide?: (slideId: number) => Promise<void>
}) {
  const [cash, setCash] = useState<number>(sequence.cash_manual || 0)
  const [chats, setChats] = useState<number>(sequence.chats || 0)
  const [dolor, setDolor] = useState<string>(sequence.dolor || '')
  const [angulo, setAngulo] = useState<string>(sequence.angulo || '')
  const [ctaText, setCtaText] = useState<string>(sequence.cta_text || '')
  const cashPorChatTotal =
    sequence.chats > 0 ? sequence.cash_generado / sequence.chats : 0
  const firstReach = slideReachCount(sequence.slides[0] ?? { reach: null })
  const retentionData = sequence.slides
    .map((s, i) => {
      const rc = slideReachCount(s)
      if (firstReach <= 0) return null
      return { slide: i + 1, retention: Math.max(0, Number(((rc / firstReach) * 100).toFixed(1))) }
    })
    .filter(Boolean) as { slide: number; retention: number }[]

  return (
    <div className="fixed inset-0 z-[500] bg-black/70 flex items-stretch justify-end" onClick={onClose}>
      <div className="h-full w-full max-w-[920px] bg-[var(--bg2)] border-l border-[var(--border)] p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold">Detalle secuencia {formatSequenceDateDisplay(sequence.fecha)}</h3>
          <button className="text-[var(--text3)]" onClick={onClose}>✕</button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--text2)]">
          <span className="font-mono-num">ALCANCE: {sequence.totalReach.toLocaleString('es-AR')}</span>
          <span className="font-mono-num">VIS. PROM: {sequence.avgViews.toLocaleString('es-AR')}</span>
          <span className="font-mono-num">CASH: {formatCash(sequence.cash_generado)}</span>
          <span className="font-mono-num">CHATS: {sequence.chats}</span>
          <span className="font-mono-num">AGENDAS: {sequence.agendas}</span>
          <span className="font-mono-num">
            CPC: {formatCash(sequence.chats > 0 ? sequence.cash_generado / sequence.chats : 0)}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash generado</div>
            <div className="font-mono-num text-2xl font-bold text-[var(--green)]">
              {formatCash(sequence.cash_generado)}
            </div>
            <input
              type="number"
              value={cash}
              onChange={(e) => setCash(Number(e.target.value) || 0)}
              className="mt-2 w-full rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1.5 text-center font-mono-num text-[13px] text-[var(--text)] outline-none"
              aria-label="Ajuste opcional de cash en base de datos"
            />
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
            <input type="number" value={chats} onChange={(e) => setChats(Number(e.target.value) || 0)} className="w-full bg-transparent text-center font-mono-num text-2xl font-bold text-[var(--text)] outline-none" />
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">CPC</div>
            <div className="font-mono-num text-2xl font-bold">{formatCash(cashPorChatTotal)}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Agendas</div>
            <div className="font-mono-num text-2xl font-bold text-[var(--text)]">{sequence.agendas}</div>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex items-end overflow-x-auto pb-2 gap-3">
            {sequence.slides.map((slide, i) => {
              const reachVal = slideReachCount(slide)
              const prevReach = i > 0 ? slideReachCount(sequence.slides[i - 1]!) : 0
              const currentReach = reachVal
              const dropoff = i === 0 || prevReach <= 0 ? '—' : `${(((prevReach - currentReach) / prevReach) * 100).toFixed(1)}%`
              const thumb = getImageUrl(slide.image_url)
              return (
                <div key={slide.id} className="w-[120px] flex-shrink-0">
                  <div className="relative h-[200px] rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg4)]">
                    {onDeleteSlide && (
                      <button
                        type="button"
                        title="Eliminar esta historia"
                        className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-[14px] font-bold text-white hover:bg-[#F87171]"
                        onClick={() => void onDeleteSlide(slide.id)}
                      >
                        ×
                      </button>
                    )}
                    {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover rounded-lg" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)]">{i + 1}</div>}
                  </div>
                  <div className="mt-2 text-[10px] text-[var(--text3)]">ALCANCE: <span className="text-[var(--text)]">{reachVal ? reachVal.toLocaleString('es-AR') : '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">REPLIES: <span className="text-[var(--text)]">{toNumber(slide.replies) || '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">COMPARTIDOS: <span className="text-[var(--text)]">{toNumber(slide.shares) || '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">PERFIL: <span className="text-[var(--text)]">{toNumber(slide.profile_visits) || '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">DROPOFF: <span className="text-[var(--text)]">{dropoff}</span></div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Dolor</label>
            <input value={dolor} onChange={(e) => setDolor(e.target.value)} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] outline-none" />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Angulo</label>
            <input value={angulo} onChange={(e) => setAngulo(e.target.value)} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] outline-none" />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">CTA</label>
            <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] outline-none" />
          </div>
        </div>

        {retentionData.length > 0 && (
          <div className="mb-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">Retención de alcance entre slides</div>
            <div className="h-56 w-full rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={retentionData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="slide" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <ReLine type="monotone" dataKey="retention" stroke="#E63946" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => onSave({ dolor, angulo, cta_text: ctaText, cash_manual: cash, chats })}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90"
          >
            Guardar
          </button>
          <button onClick={onClose} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cerrar</button>
        </div>
      </div>
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
