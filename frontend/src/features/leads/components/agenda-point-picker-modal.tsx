'use client'

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { Modal } from '@/shared/components/modal'

export type AgendaPickerStep = 'menu' | 'reel' | 'historia' | 'youtube'

type ReelItem = {
  id: string
  title: string | null
  metrics?: Record<string, string | number>
  published_at?: string | null
  classification?: { cta?: string | null }
}

type SeqItem = { id: number; sequence_date: string; title: string | null }

type YtItem = {
  id: string
  title: string | null
  published_at?: string | null
  metrics?: Record<string, string | number>
}

type Props = {
  open: boolean
  onClose: () => void
  /** Título del modal (ej. «Punto de agenda» o «1er ingreso embudo»). */
  modalTitle?: string
  /** True si el lead ya tiene un valor guardado (mostrar opción de quitar). */
  hasAssignedPuntoAgenda: boolean
  onSavePuntoAgenda: (value: string) => Promise<void>
  onCacheReel: (id: string, meta: { title: string; publishedAt: string | null }) => void
  onCacheSequence: (id: string, meta: { title: string; sequenceDate: string | null }) => void
  onCacheYoutube?: (id: string, meta: { title: string; publishedAt: string | null }) => void
}

function reelThumbUrl(metrics: Record<string, string | number> | undefined): string {
  const raw = String(metrics?.thumbnail || '').trim()
  if (!raw) return ''
  return `/api/proxy-image?url=${encodeURIComponent(raw)}`
}

/** Alineado con `reels_services._cta_counts_as_reel_con_cta` y `reels-metrics-panel`. */
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

function ctaCountsAsReelConCta(cta: string | null | undefined): boolean {
  let s = (cta ?? '').trim().toLowerCase().replace(/[.!¡?]+$/g, '')
  if (!s) return false
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return !CTA_NEGATIVE_FOR_METRICS.has(s)
}

function formatReelPublishedDate(iso: string | null | undefined): string {
  if (iso == null || !String(iso).trim()) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function ytThumbUrl(metrics: Record<string, string | number> | undefined): string {
  const raw = String(metrics?.thumbnail || '').trim()
  if (!raw) return ''
  try {
    const h = new URL(raw).hostname.toLowerCase()
    if (
      h.endsWith('ytimg.com') ||
      h.endsWith('googleusercontent.com') ||
      h.endsWith('ggpht.com')
    ) {
      return raw
    }
  } catch {
    /* usar proxy */
  }
  return `/api/proxy-image?url=${encodeURIComponent(raw)}`
}

function formatYtPublishedDate(iso: string | null | undefined): string {
  if (iso == null || !String(iso).trim()) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const REELS_PAGE_SIZE = 12

const YT_PAGE_SIZE = 12

export function AgendaPointPickerModal({
  open,
  onClose,
  modalTitle = 'Punto de agenda',
  hasAssignedPuntoAgenda,
  onSavePuntoAgenda,
  onCacheReel,
  onCacheSequence,
  onCacheYoutube,
}: Props) {
  const [step, setStep] = useState<AgendaPickerStep>('menu')
  const [reels, setReels] = useState<ReelItem[]>([])
  const [reelPage, setReelPage] = useState(1)
  const [reelTotalPages, setReelTotalPages] = useState(1)
  const [reelTotal, setReelTotal] = useState(0)
  const [seqs, setSeqs] = useState<SeqItem[]>([])
  const [loadingReels, setLoadingReels] = useState(false)
  const [loadingSeqs, setLoadingSeqs] = useState(false)
  const [loadingYt, setLoadingYt] = useState(false)
  const [ytVideos, setYtVideos] = useState<YtItem[]>([])
  const [ytPage, setYtPage] = useState(1)
  const [ytTotalPages, setYtTotalPages] = useState(1)
  const [ytTotal, setYtTotal] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setStep('menu')
      setReels([])
      setReelPage(1)
      setReelTotalPages(1)
      setReelTotal(0)
      setSeqs([])
      setYtVideos([])
      setYtPage(1)
      setYtTotalPages(1)
      setYtTotal(0)
    }
  }, [open])

  const fetchReelsPage = useCallback(async (page: number) => {
    setLoadingReels(true)
    try {
      const res = await apiFetch(`/reels?page=${page}&page_size=${REELS_PAGE_SIZE}&skip_agg=1`)
      const data = (await res.json().catch(() => ({}))) as {
        reels?: ReelItem[]
        total_pages?: number
        total?: number
      }
      if (!res.ok) {
        setReels([])
        setReelTotalPages(1)
        setReelTotal(0)
        return
      }
      const list = data.reels || []
      setReels(list)
      const tp = Math.max(1, data.total_pages ?? 1)
      setReelTotalPages(tp)
      if (typeof data.total === 'number') {
        setReelTotal(data.total)
      } else {
        setReelTotal((tp - 1) * REELS_PAGE_SIZE + list.length)
      }
    } finally {
      setLoadingReels(false)
    }
  }, [])

  useEffect(() => {
    if (!open || step !== 'reel') return
    void fetchReelsPage(reelPage)
  }, [open, step, reelPage, fetchReelsPage])

  const loadSeqs = useCallback(async () => {
    setLoadingSeqs(true)
    try {
      const res = await apiFetch('/stories/sequences?all_months=true')
      const data = (await res.json().catch(() => [])) as unknown
      setSeqs(Array.isArray(data) ? (data as SeqItem[]) : [])
    } finally {
      setLoadingSeqs(false)
    }
  }, [])

  useEffect(() => {
    if (!open || step !== 'historia') return
    void loadSeqs()
  }, [open, step, loadSeqs])

  const goToReelPicker = () => {
    setReelPage(1)
    setStep('reel')
  }

  const pickClear = async () => {
    setSaving(true)
    try {
      await onSavePuntoAgenda('')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const pickBio = async () => {
    setSaving(true)
    try {
      await onSavePuntoAgenda('bio')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const pickReel = async (r: ReelItem) => {
    const id = String(r.id)
    setSaving(true)
    try {
      await onSavePuntoAgenda(id)
      onCacheReel(id, {
        title: (r.title && r.title.trim()) || `Reel ${id}`,
        publishedAt: r.published_at ?? null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const pickSequence = async (s: SeqItem) => {
    const id = `story:${s.id}`
    setSaving(true)
    try {
      await onSavePuntoAgenda(id)
      onCacheSequence(id, {
        title:
          (s.title && s.title.trim()) ||
          (s.sequence_date ? `Historia ${s.sequence_date}` : `Historia ${id}`),
        sequenceDate: s.sequence_date ?? null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const fetchYtPage = useCallback(async (page: number) => {
    setLoadingYt(true)
    try {
      const res = await apiFetch(
        `/youtube/videos?page=${page}&page_size=${YT_PAGE_SIZE}&skip_agg=1`,
      )
      const data = (await res.json().catch(() => ({}))) as {
        videos?: YtItem[]
        total_pages?: number
        total?: number
      }
      if (!res.ok) {
        setYtVideos([])
        setYtTotalPages(1)
        setYtTotal(0)
        return
      }
      const list = data.videos || []
      setYtVideos(list)
      const tp = Math.max(1, data.total_pages ?? 1)
      setYtTotalPages(tp)
      if (typeof data.total === 'number') {
        setYtTotal(data.total)
      } else {
        setYtTotal((tp - 1) * YT_PAGE_SIZE + list.length)
      }
    } finally {
      setLoadingYt(false)
    }
  }, [])

  useEffect(() => {
    if (!open || step !== 'youtube') return
    void fetchYtPage(ytPage)
  }, [open, step, ytPage, fetchYtPage])

  const pickYoutube = async (v: YtItem) => {
    const id = String(v.id)
    setSaving(true)
    try {
      await onSavePuntoAgenda(`youtube:${id}`)
      onCacheYoutube?.(id, {
        title: (v.title && v.title.trim()) || `YouTube ${id}`,
        publishedAt: v.published_at ?? null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={() => !saving && onClose()} title={modalTitle} maxWidth="720px">
      {step === 'menu' && (
        <div className="space-y-4">
          <p className="text-[12px] text-[var(--text3)]">Elegí a qué pieza enlaza este lead.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              disabled={saving}
              onClick={goToReelPicker}
              className="rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-4 py-6 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50"
            >
              <div className="text-[13px] font-semibold text-[var(--text)]">Reel</div>
              <div className="mt-1 text-[11px] text-[var(--text3)]">Instagram · métricas reels</div>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setStep('historia')}
              className="rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-4 py-6 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50"
            >
              <div className="text-[13px] font-semibold text-[var(--text)]">Historia</div>
              <div className="mt-1 text-[11px] text-[var(--text3)]">Secuencia de stories</div>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setYtPage(1)
                setStep('youtube')
              }}
              className="rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-4 py-6 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50"
            >
              <div className="text-[13px] font-semibold text-[var(--text)]">YouTube</div>
              <div className="mt-1 text-[11px] text-[var(--text3)]">Videos sincronizados</div>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void pickBio()}
              className="rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-4 py-6 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50"
            >
              <div className="text-[13px] font-semibold text-[var(--text)]">Bio</div>
              <div className="mt-1 text-[11px] text-[var(--text3)]">Guarda &quot;bio&quot; como referencia</div>
            </button>
          </div>
          {hasAssignedPuntoAgenda && (
            <div className="flex justify-center border-t border-[var(--border2)] pt-4">
              <button
                type="button"
                disabled={saving}
                onClick={() => void pickClear()}
                className="text-[12px] font-medium text-[var(--text3)] underline-offset-2 transition-colors hover:text-[#F87171] hover:underline disabled:opacity-50"
              >
                Quitar asignación
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'reel' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setStep('menu')}
              className="text-[11px] text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              ← Volver
            </button>
            <div className="flex items-center gap-3">
              {hasAssignedPuntoAgenda && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void pickClear()}
                  className="text-[11px] font-medium text-[var(--text3)] hover:text-[#F87171] hover:underline disabled:opacity-50"
                >
                  Quitar asignación
                </button>
              )}
              {loadingReels && <span className="text-[11px] text-[var(--text3)]">Cargando reels…</span>}
            </div>
          </div>
          {!loadingReels && reels.length === 0 && (
            <p className="text-[12px] text-[var(--text3)]">No hay reels para este usuario.</p>
          )}
          <div className="max-h-[min(60vh,420px)] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {reels.map((r) => {
                const thumb = reelThumbUrl(r.metrics)
                const ctaRaw = r.classification?.cta ?? null
                const conCta = ctaCountsAsReelConCta(ctaRaw)
                const fecha = formatReelPublishedDate(r.published_at)
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={saving}
                    onClick={() => void pickReel(r)}
                    className="group flex flex-col overflow-hidden rounded-lg border border-[var(--border2)] bg-[var(--bg4)] text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                  >
                    <div className="aspect-[9/16] max-h-[140px] w-full bg-[var(--bg3)]">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-2xl text-[var(--text3)]">▶</div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono-num text-[10px] leading-tight text-[var(--text2)]" title="Fecha de publicación">
                          {fecha}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${
                            conCta
                              ? 'bg-[rgba(74,222,128,0.15)] text-[var(--green)]'
                              : 'bg-[var(--bg3)] text-[var(--text3)]'
                          }`}
                        >
                          {conCta ? 'Con CTA' : 'Sin CTA'}
                        </span>
                      </div>
                      <div className="line-clamp-1 text-[9px] leading-snug text-[var(--text3)]" title={r.title || undefined}>
                        {(r.title && r.title.trim()) || `Reel ${r.id}`}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          {!loadingReels && reelTotal > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border2)] pt-3">
              <span className="text-[11px] text-[var(--text3)]">
                {(reelPage - 1) * REELS_PAGE_SIZE + 1}
                –
                {Math.min(reelPage * REELS_PAGE_SIZE, reelTotal)} de {reelTotal}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || loadingReels || reelPage <= 1}
                  onClick={() => setReelPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-3 py-1.5 text-[11px] font-medium text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-[11px] font-mono-num text-[var(--text3)]">
                  {reelPage} / {reelTotalPages}
                </span>
                <button
                  type="button"
                  disabled={saving || loadingReels || reelPage >= reelTotalPages}
                  onClick={() => setReelPage((p) => Math.min(reelTotalPages, p + 1))}
                  className="rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-3 py-1.5 text-[11px] font-medium text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'historia' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setStep('menu')}
              className="text-[11px] text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              ← Volver
            </button>
            <div className="flex items-center gap-3">
              {hasAssignedPuntoAgenda && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void pickClear()}
                  className="text-[11px] font-medium text-[var(--text3)] hover:text-[#F87171] hover:underline disabled:opacity-50"
                >
                  Quitar asignación
                </button>
              )}
              {loadingSeqs && <span className="text-[11px] text-[var(--text3)]">Cargando historias…</span>}
            </div>
          </div>
          {!loadingSeqs && seqs.length === 0 && (
            <p className="text-[12px] text-[var(--text3)]">No hay secuencias de historias.</p>
          )}
          <ul className="max-h-[min(50vh,360px)] space-y-1 overflow-y-auto pr-1">
            {seqs.map((s) => {
              const label =
                (s.title && s.title.trim()) ||
                (s.sequence_date ? `Historia ${s.sequence_date}` : `Historia #${s.id}`)
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void pickSequence(s)}
                    className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg4)] px-3 py-2 text-left text-[12px] text-[var(--text2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-50"
                  >
                    {label}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {step === 'youtube' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setStep('menu')}
              className="text-[11px] text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              ← Volver
            </button>
            <div className="flex items-center gap-3">
              {hasAssignedPuntoAgenda && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void pickClear()}
                  className="text-[11px] font-medium text-[var(--text3)] hover:text-[#F87171] hover:underline disabled:opacity-50"
                >
                  Quitar asignación
                </button>
              )}
              {loadingYt && <span className="text-[11px] text-[var(--text3)]">Cargando videos…</span>}
            </div>
          </div>
          {!loadingYt && ytVideos.length === 0 && (
            <p className="text-[12px] text-[var(--text3)]">No hay videos de YouTube sincronizados.</p>
          )}
          <div className="max-h-[min(60vh,420px)] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ytVideos.map((v) => {
                const thumb = ytThumbUrl(v.metrics)
                const fecha = formatYtPublishedDate(v.published_at)
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={saving}
                    onClick={() => void pickYoutube(v)}
                    className="group flex flex-col overflow-hidden rounded-lg border border-[var(--border2)] bg-[var(--bg4)] text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                  >
                    <div className="aspect-video max-h-[140px] w-full bg-[var(--bg3)]">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-2xl text-[var(--text3)]">▶</div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 p-2">
                      <span className="font-mono-num text-[10px] leading-tight text-[var(--text2)]">{fecha}</span>
                      <div className="line-clamp-2 text-[10px] leading-snug text-[var(--text3)]" title={v.title || undefined}>
                        {(v.title && v.title.trim()) || `Video ${v.id}`}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          {!loadingYt && ytTotal > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border2)] pt-3">
              <span className="text-[11px] text-[var(--text3)]">
                {(ytPage - 1) * YT_PAGE_SIZE + 1}–{Math.min(ytPage * YT_PAGE_SIZE, ytTotal)} de {ytTotal}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || loadingYt || ytPage <= 1}
                  onClick={() => setYtPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-3 py-1.5 text-[11px] font-medium text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-[11px] font-mono-num text-[var(--text3)]">
                  {ytPage} / {ytTotalPages}
                </span>
                <button
                  type="button"
                  disabled={saving || loadingYt || ytPage >= ytTotalPages}
                  onClick={() => setYtPage((p) => Math.min(ytTotalPages, p + 1))}
                  className="rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-3 py-1.5 text-[11px] font-medium text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
