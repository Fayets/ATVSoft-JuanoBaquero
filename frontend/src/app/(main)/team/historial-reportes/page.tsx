'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { Modal } from '@/shared/components/modal'
import { formatCash, formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'

const REPORTES_PAGE_SIZE = 20

type ReporteFiltro = 'todos' | 'setter' | 'closer_ventas' | 'seguimiento'

type ReportRow =
  | {
      kind: 'setter'
      id: number
      fecha: string
      member_nombre: string
      conversaciones: number
      agendas: number
      links_enviados: number
      notas: string
      sentimiento_trafico: string
      avatar_tipo_agendas: string
      insights_marketing: string
      leads_nuevos: number
      seguimientos: number
      outbounds: number
      dia_bueno_malo: string
    }
  | {
      kind: 'seguimiento'
      id: number
      fecha: string
      member_id: number
      member_nombre: string
      nombre_lead: string
      monto: number
    }
  | {
      kind: 'closer'
      id: number
      fecha: string
      member_nombre: string
      llamadas_agendadas: number
      shows: number
      cierres: number
      calificados: number
      descalificados: number
      ingreso: number
      notas: string
    }

function errMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d))
      return d
        .map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x)))
        .join(', ')
  }
  return 'Error en la solicitud'
}

function defaultDesde(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

/** `YYYY-MM` (input month) → primer y último día del mes en calendario local */
function ymToDesdeHasta(ym: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null
  const desde = `${y}-${String(mo).padStart(2, '0')}-01`
  const end = new Date(y, mo, 0)
  const d = end.getDate()
  const hasta = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { desde, hasta }
}

function currentYm(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

const PDF_MES_OPCIONES: { v: string; nombre: string }[] = [
  { v: '01', nombre: 'Enero' },
  { v: '02', nombre: 'Febrero' },
  { v: '03', nombre: 'Marzo' },
  { v: '04', nombre: 'Abril' },
  { v: '05', nombre: 'Mayo' },
  { v: '06', nombre: 'Junio' },
  { v: '07', nombre: 'Julio' },
  { v: '08', nombre: 'Agosto' },
  { v: '09', nombre: 'Septiembre' },
  { v: '10', nombre: 'Octubre' },
  { v: '11', nombre: 'Noviembre' },
  { v: '12', nombre: 'Diciembre' },
]

function pdfAniosOpciones(): number[] {
  const y = new Date().getFullYear()
  const out: number[] = []
  for (let a = y - 6; a <= y + 2; a += 1) out.push(a)
  return out
}

function reportDiscordEndpoint(r: ReportRow): string | null {
  if (r.kind === 'setter') return `/team/setter-reports/${r.id}/discord`
  if (r.kind === 'closer') return `/team/closer-reports/${r.id}/discord`
  return null
}

function reportDiscordKey(r: ReportRow): string {
  return `${r.kind}-${r.id}`
}

/** Formatea avatar_tipo_agendas (JSON o texto legacy) para el historial. */
function formatAvatarAgendas(raw: string): string {
  const t = raw.trim()
  if (!t) return '—'
  try {
    const parsed = JSON.parse(t) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => [k, Number(v)] as const)
        .filter(([, n]) => Number.isFinite(n) && n > 0)
        .map(([k, n]) => `${k}: ${n}`)
      if (entries.length > 0) return entries.join(' · ')
      return '—'
    }
  } catch {
    /* texto libre legacy */
  }
  return t
}

function textOrDash(value: string | undefined | null): string {
  const t = (value ?? '').trim()
  return t || '—'
}

function SetterReportDetail({ r }: { r: Extract<ReportRow, { kind: 'setter' }> }) {
  const tasaAgend = r.conversaciones > 0 ? ((r.agendas / r.conversaciones) * 100).toFixed(1) : null

  return (
    <dl className="grid gap-3 text-[12px] text-[var(--text)]">
      <div className="sm:col-span-2">
        <dt className="mb-2 font-bold text-[var(--text)]">Métricas del día</dt>
        <dd className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-[var(--text3)]">Conversaciones</span>
            <span className="font-mono-num text-[var(--text)]">{r.conversaciones}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-[var(--text3)]">Agendas</span>
            <span className="font-mono-num text-[var(--text)]">{r.agendas}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-[var(--text3)]">Calendlys enviados</span>
            <span className="font-mono-num text-[var(--text)]">{r.links_enviados}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-[var(--text3)]">Seguimientos</span>
            <span className="font-mono-num text-[var(--text)]">{r.seguimientos ?? 0}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-[var(--text3)]">Outbounds</span>
            <span className="font-mono-num text-[var(--text)]">{r.outbounds ?? 0}</span>
          </div>
          {tasaAgend != null ? (
            <div>
              <span className="block text-[10px] uppercase tracking-wide text-[var(--text3)]">Tasa agend.</span>
              <span className="font-mono-num text-[var(--accent)]">{tasaAgend}%</span>
            </div>
          ) : null}
        </dd>
      </div>

      <div>
        <dt className="font-bold text-[var(--text)]">Avatar / Tipo de agendas generadas</dt>
        <dd className="whitespace-pre-wrap text-[var(--text)]">{formatAvatarAgendas(r.avatar_tipo_agendas)}</dd>
      </div>

      <div>
        <dt className="font-bold text-[var(--text)]">Tipo de tráfico</dt>
        <dd className="whitespace-pre-wrap text-[var(--text)]">{textOrDash(r.sentimiento_trafico)}</dd>
      </div>

      <div>
        <dt className="font-bold text-[var(--text)]">¿Fue un día bueno o malo?</dt>
        <dd className="whitespace-pre-wrap text-[var(--text)]">{textOrDash(r.dia_bueno_malo)}</dd>
      </div>

      <div>
        <dt className="font-bold text-[var(--text)]">Feedback a MKT</dt>
        <dd className="whitespace-pre-wrap text-[var(--text)]">{textOrDash(r.insights_marketing)}</dd>
      </div>

      {r.notas.trim() ? (
        <div>
          <dt className="font-bold text-[var(--text)]">Notas</dt>
          <dd className="whitespace-pre-wrap text-[var(--text)]">{r.notas}</dd>
        </div>
      ) : null}
    </dl>
  )
}

/** Una línea: REPORTE SETTER | CLOSER VENTAS | CLOSER MARKETING - dd-mm-aaaa - NOMBRE */
function reportListTitle(r: ReportRow): string {
  const fd = formatIsoDateDdMmYyyy(r.fecha)
  if (r.kind === 'setter') {
    return `REPORTE SETTER - ${fd} - ${r.member_nombre}`
  }
  if (r.kind === 'seguimiento') {
    return `REPORTE SEGUIMIENTO - ${fd} - ${r.member_nombre}`
  }
  return `REPORTE CLOSER VENTAS - ${fd} - ${r.member_nombre}`
}

function ReportDetail({ r }: { r: ReportRow }) {
  if (r.kind === 'setter') {
    return <SetterReportDetail r={r} />
  }
  if (r.kind === 'seguimiento') {
    return (
      <dl className="grid gap-2 text-[12px] text-[var(--text)] sm:grid-cols-2">
        <div>
          <dt className="font-bold text-[var(--text)]">Nombre del lead</dt>
          <dd className="text-[var(--text)]">{r.nombre_lead || '—'}</dd>
        </div>
        <div>
          <dt className="font-bold text-[var(--text)]">Monto</dt>
          <dd className="font-mono-num text-[var(--text)]">{formatCash(r.monto)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-bold text-[var(--text)]">Quién completó el reporte</dt>
          <dd className="text-[var(--text)]">{r.member_nombre}</dd>
        </div>
      </dl>
    )
  }
  return (
    <dl className="grid gap-1 text-[12px] text-[var(--text)] sm:grid-cols-3">
      <div>
        <dt className="font-bold text-[var(--text)]">Agendadas</dt>
        <dd className="font-mono-num text-[var(--text)]">{r.llamadas_agendadas}</dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Shows</dt>
        <dd className="font-mono-num text-[var(--text)]">{r.shows}</dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Cierres</dt>
        <dd className="font-mono-num text-[var(--text)]">{r.cierres}</dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Calif. / Desc.</dt>
        <dd className="font-mono-num text-[var(--text)]">
          {r.calificados} / {r.descalificados}
        </dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Ingreso</dt>
        <dd className="font-mono-num text-[var(--text)]">{formatCash(r.ingreso)}</dd>
      </div>
    </dl>
  )
}

export default function TeamHistorialReportesPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [desde, setDesde] = useState(defaultDesde)
  const [hasta, setHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [roleFilter, setRoleFilter] = useState<ReporteFiltro>('todos')
  const [diaFiltro, setDiaFiltro] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<ReportRow[]>([])
  const [downloading, setDownloading] = useState(false)
  const [pdfModalOpen, setPdfModalOpen] = useState(false)
  const [pdfMode, setPdfMode] = useState<'mes' | 'rango'>('mes')
  const [pdfMonth, setPdfMonth] = useState(() => currentYm())
  const [pdfDesdeModal, setPdfDesdeModal] = useState('')
  const [pdfHastaModal, setPdfHastaModal] = useState('')
  const [pdfFiltro, setPdfFiltro] = useState<ReporteFiltro>('todos')
  const [discordSendingId, setDiscordSendingId] = useState<string | null>(null)

  const fetchReports = useCallback(async () => {
    if (!ready || !userId) {
      setReports([])
      return
    }
    setLoading(true)
    try {
      const q = `desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`
      const res = await apiFetch(`/team/reports?${q}`)
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        setReports([])
        return
      }
      const data = (await res.json()) as { reports?: ReportRow[] }
      setReports(data.reports ?? [])
    } catch {
      toast('No se pudo cargar el historial.')
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, desde, hasta, toast])

  useEffect(() => {
    void fetchReports()
  }, [fetchReports])

  useEffect(() => {
    const refresh = () => {
      void fetchReports()
    }
    window.addEventListener('atvmkt-team-reports-changed', refresh)
    return () => window.removeEventListener('atvmkt-team-reports-changed', refresh)
  }, [fetchReports])

  const filteredReports = useMemo(() => {
    let rows = reports
    if (roleFilter === 'setter') rows = rows.filter((x) => x.kind === 'setter')
    else if (roleFilter === 'closer_ventas') {
      rows = rows.filter((x) => x.kind === 'closer')
    } else if (roleFilter === 'seguimiento') {
      rows = rows.filter((x) => x.kind === 'seguimiento')
    }
    if (diaFiltro.trim()) {
      rows = rows.filter((x) => x.fecha === diaFiltro.trim())
    }
    return [...rows].sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1
      return b.id - a.id
    })
  }, [reports, roleFilter, diaFiltro])

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / REPORTES_PAGE_SIZE))

  const paginatedReports = useMemo(() => {
    const start = (page - 1) * REPORTES_PAGE_SIZE
    return filteredReports.slice(start, start + REPORTES_PAGE_SIZE)
  }, [filteredReports, page])

  useEffect(() => {
    setPage(1)
  }, [roleFilter, diaFiltro, desde, hasta])

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])

  const openPdfModal = useCallback(() => {
    setPdfMode('mes')
    const ym = hasta.length >= 7 ? hasta.slice(0, 7) : currentYm()
    setPdfMonth(ym)
    setPdfDesdeModal(desde)
    setPdfHastaModal(hasta)
    setPdfFiltro(roleFilter)
    setPdfModalOpen(true)
  }, [desde, hasta, roleFilter])

  const runPdfDownload = useCallback(
    async (desdeStr: string, hastaStr: string) => {
      if (!userId) {
        toast('Iniciá sesión')
        return
      }
      if (!desdeStr || !hastaStr) {
        toast('Completá las fechas.')
        return
      }
      if (desdeStr > hastaStr) {
        toast('La fecha inicial no puede ser posterior a la final.')
        return
      }
      setDownloading(true)
      try {
        const q = `desde=${encodeURIComponent(desdeStr)}&hasta=${encodeURIComponent(hastaStr)}&filtro=${encodeURIComponent(pdfFiltro)}`
        const res = await apiFetch(`/team/reports/pdf?${q}`)
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `reportes_equipo_${formatIsoDateDdMmYyyy(desdeStr)}_${formatIsoDateDdMmYyyy(hastaStr)}.pdf`
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toast('PDF descargado')
        setPdfModalOpen(false)
      } catch {
        toast('No se pudo generar el PDF.')
      } finally {
        setDownloading(false)
      }
    },
    [userId, toast, pdfFiltro],
  )

  const confirmPdfDownload = () => {
    if (pdfMode === 'mes') {
      const r = ymToDesdeHasta(pdfMonth)
      if (!r) {
        toast('Elegí un mes válido.')
        return
      }
      void runPdfDownload(r.desde, r.hasta)
      return
    }
    void runPdfDownload(pdfDesdeModal, pdfHastaModal)
  }

  const sendReportToDiscord = useCallback(
    async (r: ReportRow) => {
      if (!userId) {
        toast('Iniciá sesión')
        return
      }
      const endpoint = reportDiscordEndpoint(r)
      if (!endpoint) return
      const key = reportDiscordKey(r)
      setDiscordSendingId(key)
      try {
        const res = await apiFetch(endpoint, { method: 'POST' })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
        toast('Reporte enviado a Discord')
      } catch {
        toast('No se pudo enviar a Discord.')
      } finally {
        setDiscordSendingId(null)
      }
    },
    [userId, toast],
  )

  if (!ready) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando…</div>
  }

  if (!userId) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Iniciá sesión para ver el historial.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-lg font-bold tracking-tight">Historial de reportes</h2>
        <button
          type="button"
          disabled={downloading || loading}
          onClick={openPdfModal}
          className="shrink-0 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        >
          Descargar PDF
        </button>
      </div>

      <Modal
        open={pdfModalOpen}
        onClose={() => {
          if (!downloading) setPdfModalOpen(false)
        }}
        title="Descargar PDF"
        maxWidth="480px"
        compact
      >
        <div className="space-y-4 text-[13px] text-[var(--text)]">
          <p className="text-[12px] leading-snug text-[var(--text2)]">
            Elegí si querés un mes completo o un rango entre dos fechas.
          </p>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Reportes en el PDF</label>
            <select
              value={pdfFiltro}
              onChange={(e) => setPdfFiltro(e.target.value as ReporteFiltro)}
              disabled={downloading}
              className="w-full max-w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)] disabled:opacity-50"
            >
              <option value="todos">Todos</option>
              <option value="setter">Setter</option>
              <option value="closer_ventas">Closer ventas</option>
              <option value="seguimiento">Seguimiento</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="pdf-mode"
                checked={pdfMode === 'mes'}
                onChange={() => setPdfMode('mes')}
                className="accent-[var(--accent)]"
              />
              <span className="font-semibold">Por mes</span>
            </label>
            {pdfMode === 'mes' ? (
              <div className="ml-6 max-w-[min(100%,280px)] rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2.5">
                <div className="flex gap-2">
                  <select
                    aria-label="Mes"
                    value={pdfMonth.length >= 7 ? pdfMonth.slice(5, 7) : '01'}
                    onChange={(e) => {
                      const mm = e.target.value
                      const yy = pdfMonth.length >= 4 ? pdfMonth.slice(0, 4) : String(new Date().getFullYear())
                      setPdfMonth(`${yy}-${mm}`)
                    }}
                    className="min-w-0 flex-1 rounded-md border border-[var(--border2)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    {PDF_MES_OPCIONES.map(({ v, nombre }) => (
                      <option key={v} value={v}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Año"
                    value={pdfMonth.length >= 4 ? pdfMonth.slice(0, 4) : String(new Date().getFullYear())}
                    onChange={(e) => {
                      const yy = e.target.value
                      const mm = pdfMonth.length >= 7 ? pdfMonth.slice(5, 7) : '01'
                      setPdfMonth(`${yy}-${mm}`)
                    }}
                    className="w-[4.75rem] shrink-0 rounded-md border border-[var(--border2)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    {pdfAniosOpciones().map((a) => (
                      <option key={a} value={String(a)}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 pt-1">
              <input
                type="radio"
                name="pdf-mode"
                checked={pdfMode === 'rango'}
                onChange={() => setPdfMode('rango')}
                className="accent-[var(--accent)]"
              />
              <span className="font-semibold">Entre fechas</span>
            </label>
            {pdfMode === 'rango' ? (
              <div className="ml-6 flex flex-wrap items-end gap-3">
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Desde</span>
                  <input
                    type="date"
                    value={pdfDesdeModal}
                    onChange={(e) => setPdfDesdeModal(e.target.value)}
                    className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Hasta</span>
                  <input
                    type="date"
                    value={pdfHastaModal}
                    onChange={(e) => setPdfHastaModal(e.target.value)}
                    className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={downloading}
              onClick={() => setPdfModalOpen(false)}
              className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void confirmPdfDownload()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-all hover:brightness-110 disabled:opacity-50"
            >
              {downloading ? 'Generando…' : 'Descargar'}
            </button>
          </div>
        </div>
      </Modal>

      <div className="glass-card glass-card--performant flex flex-wrap items-end gap-4 p-4 sm:p-5">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Reportes de</label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as ReporteFiltro)}
            className="min-w-[200px] cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          >
            <option value="todos">Todos</option>
            <option value="setter">Setter</option>
            <option value="closer_ventas">Closer ventas</option>
            <option value="seguimiento">Seguimiento</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Día (opcional)</label>
          <input
            type="date"
            value={diaFiltro}
            onChange={(e) => setDiaFiltro(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <button
          type="button"
          onClick={() => void fetchReports()}
          disabled={loading}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white transition-all hover:brightness-110 disabled:opacity-50"
        >
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
        {diaFiltro ? (
          <button
            type="button"
            onClick={() => setDiaFiltro('')}
            className="rounded-lg border border-[var(--border2)] px-3 py-2.5 text-[11px] font-semibold text-[var(--text)] hover:border-[var(--text3)]"
          >
            Quitar día
          </button>
        ) : null}
      </div>

      {loading && reports.length === 0 ? (
        <div className="text-[13px] text-[var(--text2)]">Cargando reportes…</div>
      ) : reports.length === 0 ? (
        <p className="text-[13px] text-[var(--text2)]">No hay reportes en este rango.</p>
      ) : filteredReports.length === 0 ? (
        <p className="text-[13px] text-[var(--text2)]">No hay reportes con estos filtros.</p>
      ) : (
        <>
          <div className="glass-card glass-card--performant divide-y divide-[var(--border2)] overflow-hidden rounded-lg border border-[var(--border)]">
            {paginatedReports.map((r) => (
              <details key={`${r.kind}-${r.id}`} className="group bg-[var(--bg2)]/30 open:bg-[var(--bg3)]/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[11px] font-extrabold uppercase leading-snug tracking-wide text-[var(--text)] transition-colors hover:bg-[var(--nav-hover)] marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1 select-none">{reportListTitle(r)}</span>
                  {reportDiscordEndpoint(r) ? (
                    <button
                      type="button"
                      title="Enviar reporte a Discord"
                      disabled={discordSendingId === reportDiscordKey(r)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        void sendReportToDiscord(r)
                      }}
                      className="shrink-0 rounded-lg border border-[#5865F2]/40 bg-[#5865F2]/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-[#949cf0] transition-colors hover:border-[#5865F2] hover:bg-[#5865F2]/20 hover:text-[#c5c9ff] disabled:opacity-50"
                    >
                      {discordSendingId === reportDiscordKey(r) ? 'Enviando…' : 'Discord'}
                    </button>
                  ) : null}
                </summary>
                <div className="border-t border-[var(--border2)] px-4 pb-3 pt-2">
                  <ReportDetail r={r} />
                </div>
              </details>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-transparent pt-3">
            <p className="text-[12px] text-[var(--text3)]">
              Mostrando{' '}
              <span className="font-medium text-[var(--text2)]">
                {(page - 1) * REPORTES_PAGE_SIZE + 1}–{Math.min(page * REPORTES_PAGE_SIZE, filteredReports.length)}
              </span>{' '}
              de <span className="font-medium text-[var(--text2)]">{filteredReports.length}</span>
            </p>
            {totalPages > 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] transition-all hover:border-[var(--text3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="min-w-[8rem] text-center text-[12px] text-[var(--text3)]">
                  Página <span className="font-semibold text-[var(--text)]">{page}</span> de{' '}
                  <span className="font-semibold text-[var(--text)]">{totalPages}</span>
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] transition-all hover:border-[var(--text3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
