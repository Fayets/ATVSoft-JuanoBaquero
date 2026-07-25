'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

const AR_TZ = 'America/Argentina/Buenos_Aires'
const PAGE_SIZE = 20

type KeywordClientRow = {
  lead_id: string
  nombre: string
  instagram: string
  reel_id?: string | null
  reel_permalink: string | null
  reel_published_at: string | null
  keyword: string
}

type ReelOption = { id: string; label: string }

type KeywordsMetrics = {
  total_rows: number
  unique_leads: number
  unique_keywords: number
  rows_with_reel: number
  unique_reels: number
}

type KeywordsResponse = {
  rows?: KeywordClientRow[]
  total?: number
  reels?: ReelOption[]
  metrics?: Partial<KeywordsMetrics>
}

/** `reel_published_at` viene como YYYY-MM-DD desde la API. */
function formatReelLabel(isoDate: string | null): string {
  if (!isoDate?.trim()) return 'REEL'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (m) {
    const [, y, mo, d] = m
    return `REEL ${d}/${mo}/${y}`
  }
  const t = Date.parse(isoDate)
  if (Number.isNaN(t)) return 'REEL'
  return `REEL ${new Date(t).toLocaleDateString('es-AR', { timeZone: AR_TZ, day: '2-digit', month: '2-digit', year: 'numeric' })}`
}

export default function KeywordsPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<KeywordClientRow[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [reelId, setReelId] = useState('')
  const [reelOptions, setReelOptions] = useState<ReelOption[]>([])
  const [uniqueLeads, setUniqueLeads] = useState(0)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchDebounced(search)
      setPage(1)
    }, 350)
    return () => window.clearTimeout(t)
  }, [search])

  const fetchKeywords = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const q = new URLSearchParams()
      q.set('page', String(page))
      q.set('page_size', String(PAGE_SIZE))
      if (reelId.trim()) q.set('reel_id', reelId.trim())
      if (searchDebounced.trim()) q.set('q', searchDebounced.trim())
      const res = await apiFetch(`/keywords?${q.toString()}`)
      const data = (await res.json().catch(() => ({}))) as KeywordsResponse
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar Keyword: ${detail}`)
        setRows([])
        setTotal(0)
        setUniqueLeads(0)
        return
      }
      setRows(Array.isArray(data.rows) ? data.rows : [])
      setTotal(Number(data.total ?? 0))
      setReelOptions(Array.isArray(data.reels) ? data.reels : [])
      setUniqueLeads(Number(data.metrics?.unique_leads ?? 0))
    } catch (e) {
      toast(`Error al cargar Keyword: ${(e as Error).message}`)
      setRows([])
      setTotal(0)
      setUniqueLeads(0)
    } finally {
      setLoading(false)
    }
  }, [ready, toast, page, reelId, searchDebounced])

  useEffect(() => {
    fetchKeywords()
  }, [fetchKeywords])

  const visible = useMemo(() => rows, [rows])

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Lead por reel</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[var(--bg4)] px-3 py-1 text-[11px] text-[var(--text3)]">
            {visible.length} de {total} filas (página {page} de {totalPages})
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={reelId}
              onChange={(e) => {
                setReelId(e.target.value)
                setPage(1)
              }}
              className="w-64 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
            >
              <option value="">Todos los reels</option>
              {reelOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {reelId.trim() ? (
              <span className="rounded-full border border-[var(--border2)] bg-[var(--bg3)] px-3 py-1.5 text-[11px] text-[var(--text)]">
                <span className="text-[var(--text3)]">Leads en este reel:</span>{' '}
                <span className="font-mono-num font-semibold tabular-nums">{uniqueLeads}</span>
              </span>
            ) : null}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre, IG, fecha o keyword…"
            className="w-64 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text3)]"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">
          No hay leads con keyword. Cuando ManyChat guarde la keyword en el lead, van a aparecer acá.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,140px)_minmax(0,100px)] gap-4 px-4 py-2 sm:grid">
            {['Nombre', 'Instagram', 'Reel', 'Keyword'].map((h) => (
              <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                {h}
              </div>
            ))}
          </div>
          {visible.map((r) => {
            const hasReel = Boolean(r.reel_permalink || r.reel_published_at)
            const label = formatReelLabel(r.reel_published_at)
            return (
              <div key={`${r.lead_id}-${r.keyword}`} className="glass-card overflow-hidden">
                <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,140px)_minmax(0,100px)] sm:items-center sm:gap-4">
                  <div className="min-w-0 overflow-hidden text-[13px] text-[var(--text)]">
                    <span className="block truncate">{r.nombre || '—'}</span>
                  </div>
                  <div className="min-w-0 overflow-hidden text-[13px] text-[var(--text2)]">
                    <span className="block truncate">{r.instagram || '—'}</span>
                  </div>
                  <div className="min-w-0 overflow-hidden text-[12px]">
                    {r.reel_permalink ? (
                      <a
                        href={r.reel_permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate font-medium whitespace-nowrap text-[var(--accent)] hover:underline"
                        title={label}
                      >
                        {label}
                      </a>
                    ) : hasReel ? (
                      <span className="block truncate whitespace-nowrap text-[var(--text2)]">{label}</span>
                    ) : (
                      <span className="block truncate text-[var(--text3)]">—</span>
                    )}
                  </div>
                  <div className="min-w-0 overflow-hidden text-[13px] font-medium text-[var(--text)]">
                    <span className="block truncate">{r.keyword}</span>
                  </div>
                </div>
              </div>
            )
          })}
          {visible.length === 0 && (
            <div className="py-8 text-center text-[12px] text-[var(--text3)]">Ninguna fila coincide con la búsqueda.</div>
          )}
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
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
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
