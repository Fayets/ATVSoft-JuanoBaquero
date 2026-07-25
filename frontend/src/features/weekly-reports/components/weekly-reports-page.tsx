'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatCallReportError } from '@/features/call-reports/lib/claude-status'
import {
  defaultWeekPeriod,
  daysBetweenInclusive,
  deleteWeeklyReport,
  downloadWeeklyReport,
  formatWeekRange,
  generateWeeklyReport,
  getWeeklyReports,
  previewWeeklyReport,
  type WeeklyReport,
} from '../services/weekly-reports-service'
import { WeeklyDayPicker, periodFromSelection } from './weekly-day-picker'
import { WeeklyReportContentViewer } from './weekly-report-content-viewer'
import { WeeklyReportMarketingFeedback } from './weekly-report-marketing-feedback'
import '../weekly-report-doc.css'

const POLL_MS = 4000

function formatReportBuilderName(username: string | null | undefined): string {
  const raw = (username || '').trim()
  if (!raw) return 'Tu equipo'
  const first = raw.split(/[._-\s]+/)[0] || raw
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function weeklyReportGeneratingLabel(username: string | null | undefined): string {
  return `${formatReportBuilderName(username)} está armando tu reporte semanal…`
}

function hasGenerating(items: WeeklyReport[]): boolean {
  return items.some((r) => r.estado === 'generando')
}

export function WeeklyReportsPage() {
  const { ready, userId, username } = useAuthUser()
  const { toast } = useToast()
  const defaultPeriod = useMemo(() => defaultWeekPeriod(), [])
  const [items, setItems] = useState<WeeklyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [desde, setDesde] = useState(defaultPeriod.fecha_inicio)
  const [hasta, setHasta] = useState(defaultPeriod.fecha_fin)
  const [selectedDays, setSelectedDays] = useState<Set<string>>(
    () => new Set(defaultPeriod.dias),
  )
  const [preview, setPreview] = useState<{
    llamadas: number
    closerDias: number
    diasSeleccionados: number
  } | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const period = useMemo(
    () => periodFromSelection(desde, hasta, selectedDays),
    [desde, hasta, selectedDays],
  )

  const fetchReports = useCallback(
    async (silent = false) => {
      if (!ready || !userId) {
        setItems([])
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      try {
        const rows = await getWeeklyReports()
        setItems(rows)
        setSelectedId((prev) => {
          if (prev && rows.some((r) => r.id === prev)) return prev
          return rows[0]?.id ?? null
        })
      } catch (e) {
        if (!silent) toast(e instanceof Error ? e.message : 'Error al cargar reportes.')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [ready, userId, toast],
  )

  useEffect(() => {
    void fetchReports()
  }, [fetchReports])

  useEffect(() => {
    if (desde > hasta) return
    const span = daysBetweenInclusive(desde, hasta)
    setSelectedDays((prev) => {
      const next = new Set<string>()
      for (const d of span) {
        if (prev.has(d)) next.add(d)
      }
      if (next.size === 0 && span.length > 0) {
        return new Set(span)
      }
      return next
    })
  }, [desde, hasta])

  useEffect(() => {
    if (!ready || !userId || period.dias.length === 0) {
      setPreview(null)
      return
    }
    let cancelled = false
    void previewWeeklyReport(period)
      .then((data) => {
        if (cancelled) return
        setPreview({
          llamadas: data.llamadas_count,
          closerDias: data.closer_dias_count,
          diasSeleccionados: data.dias_seleccionados,
        })
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [ready, userId, period])

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!ready || !userId || !hasGenerating(items)) return undefined
    pollRef.current = setInterval(() => void fetchReports(true), POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [items, ready, userId, fetchReports])

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) ?? null,
    [items, selectedId],
  )

  const canGenerate = Boolean(
    preview && period.dias.length > 0 && (preview.llamadas > 0 || preview.closerDias > 0),
  )

  const handleGenerate = async (override?: { desde: string; hasta: string; dias: string[] }) => {
    const target = override
      ? {
          fecha_inicio: override.desde,
          fecha_fin: override.hasta,
          dias: override.dias,
        }
      : period

    if (target.dias.length === 0) {
      toast('Seleccioná al menos un día.')
      return
    }
    if (!override && !canGenerate) {
      toast('No hay análisis Fathom ni reportes closer para los días seleccionados.')
      return
    }
    setGenerating(true)
    try {
      const res = await generateWeeklyReport(target)
      toast(weeklyReportGeneratingLabel(username))
      setSelectedId(res.id)
      await fetchReports(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo iniciar la generación.')
    } finally {
      setGenerating(false)
    }
  }

  const toggleDay = (iso: string) => {
    setSelectedDays((prev) => {
      const next = new Set(prev)
      if (next.has(iso)) next.delete(iso)
      else next.add(iso)
      return next
    })
  }

  const handleDelete = async (id: number) => {
    const row = items.find((r) => r.id === id)
    const label = row ? formatWeekRange(row.semana_inicio, row.semana_fin) : 'este reporte'
    if (!window.confirm(`¿Borrar el reporte del ${label}? Esta acción no se puede deshacer.`)) {
      return
    }
    setDeletingId(id)
    try {
      await deleteWeeklyReport(id)
      toast('Reporte eliminado.')
      setSelectedId((prev) => (prev === id ? null : prev))
      await fetchReports(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo borrar el reporte.')
    } finally {
      setDeletingId(null)
    }
  }

  if (!ready || loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-[13px] text-[var(--text3)]">
        Cargando reportes semanales…
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg3)] px-4 py-8 text-center text-[13px] text-[var(--text3)]">
        Iniciá sesión para ver reportes semanales.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="glass-card glass-card--performant p-5">
        <h1 className="text-lg font-semibold tracking-tight text-[var(--text)]">Reportes semanales</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--text3)]">
          Elegí el rango y marcá los días a incluir. Claude sintetiza los análisis Fathom y los reportes
          diarios del closer. Requiere API key de Claude en Conexiones API.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Desde</span>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Hasta</span>
            <input
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>

        <div className="mt-4">
          <WeeklyDayPicker
            desde={desde}
            hasta={hasta}
            selectedDays={selectedDays}
            onToggleDay={toggleDay}
            onSelectAll={() => setSelectedDays(new Set(daysBetweenInclusive(desde, hasta)))}
            onClearAll={() => setSelectedDays(new Set())}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {preview && period.dias.length > 0 ? (
            <div className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text2)]">
              <div className="font-medium text-[var(--text)]">
                {formatWeekRange(desde, hasta)} · {preview.diasSeleccionados} día
                {preview.diasSeleccionados === 1 ? '' : 's'} marcado
                {preview.diasSeleccionados === 1 ? '' : 's'}
              </div>
              <div className="mt-0.5 text-[var(--text3)]">
                {preview.llamadas} análisis Fathom · {preview.closerDias} días con reporte closer
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text3)]">Marcá al menos un día para ver la vista previa.</p>
          )}
          <button
            type="button"
            disabled={generating || !canGenerate}
            onClick={() => void handleGenerate()}
            className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? 'Iniciando…' : 'Generar reporte semanal'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <aside className="glass-card glass-card--performant p-3">
          <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)]">
            Historial
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-4 text-[12px] text-[var(--text3)]">Todavía no hay reportes generados.</p>
          ) : (
            <ul className="space-y-1">
              {items.map((row) => {
                const active = row.id === selectedId
                return (
                  <li key={row.id}>
                    <div
                      className={`flex items-stretch gap-1 rounded-lg ${
                        active ? 'bg-[var(--accent-faint)]' : 'hover:bg-[var(--nav-hover)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left transition-colors"
                      >
                        <div className="text-[12px] font-medium text-[var(--text)]">
                          {formatWeekRange(row.semana_inicio, row.semana_fin)}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text3)]">
                          <span
                            className={
                              row.estado === 'listo'
                                ? 'text-[var(--green)]'
                                : row.estado === 'error'
                                  ? 'text-[var(--accent)]'
                                  : ''
                            }
                          >
                            {row.estado === 'listo'
                              ? 'Listo'
                              : row.estado === 'generando'
                                ? 'Generando…'
                                : row.estado === 'error'
                                  ? 'Error'
                                  : row.estado}
                          </span>
                          <span>
                            {row.llamadas_count} calls · {row.closer_dias_count} días closer
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Borrar reporte"
                        disabled={deletingId === row.id}
                        onClick={() => void handleDelete(row.id)}
                        className="mr-1.5 shrink-0 self-center rounded-md p-2 text-[var(--text3)] transition-colors hover:bg-[rgba(230,57,70,0.12)] hover:text-[var(--accent)] disabled:opacity-50"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="glass-card glass-card--performant min-h-[320px] p-5">
          {!selected ? (
            <p className="text-[13px] text-[var(--text3)]">Seleccioná un reporte del historial o generá uno nuevo.</p>
          ) : selected.estado === 'generando' ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-[13px] text-[var(--text3)]">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
              {weeklyReportGeneratingLabel(username)}
            </div>
          ) : selected.estado === 'error' ? (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-[var(--accent)]">Error al generar</p>
              <p className="text-[13px] text-[var(--text2)]">
                {formatCallReportError(selected.error_msg) || 'Error desconocido.'}
              </p>
              <button
                type="button"
                onClick={() =>
                  void handleGenerate({
                    desde: selected.semana_inicio,
                    hasta: selected.semana_fin,
                    dias: daysBetweenInclusive(selected.semana_inicio, selected.semana_fin),
                  })
                }
                className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[12px] text-[var(--text2)] hover:bg-[var(--nav-hover)]"
              >
                Reintentar
              </button>
            </div>
          ) : selected.estado === 'listo' && selected.contenido ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-semibold text-[var(--text)]">
                    {formatWeekRange(selected.semana_inicio, selected.semana_fin)}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-[var(--text3)]">
                    {selected.llamadas_count} llamadas · {selected.closer_dias_count} días closer
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void downloadWeeklyReport(selected.id).catch((e) =>
                        toast(e instanceof Error ? e.message : 'No se pudo descargar.'),
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Descargar PDF
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === selected.id}
                    onClick={() => void handleDelete(selected.id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    Borrar
                  </button>
                </div>
              </div>
              {selected.feedback_marketing ? (
                <WeeklyReportMarketingFeedback feedback={selected.feedback_marketing} />
              ) : null}
              <WeeklyReportContentViewer
                contenido={selected.contenido}
                semanaInicio={selected.semana_inicio}
                semanaFin={selected.semana_fin}
              />
            </div>
          ) : (
            <p className="text-[13px] text-[var(--text3)]">Sin contenido.</p>
          )}
        </section>
      </div>
    </div>
  )
}
