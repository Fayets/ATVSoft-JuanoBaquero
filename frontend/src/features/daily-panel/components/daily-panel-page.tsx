'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { addDaysIso } from '@/features/weekly-reports/services/weekly-reports-service'
import { useTimezone } from '@/shared/hooks/use-timezone'
import {
  DEFAULT_TIMEZONE,
  isDateBeforeToday,
  todayIsoInTimeZone,
} from '@/shared/lib/timezone'
import {
  createManualCall,
  generateCloserReportsForDay,
  getDailyCalls,
  getProgramOptions,
  getTeamClosers,
  getTeamTriajers,
  getTeamSetters,
  assignTriajersForDay,
  patchLeadCalificacion,
  patchLeadCallLink,
  patchLeadCloser,
  patchLeadTriajer,
  patchLeadSetter,
  patchLeadTriajeHecho,
  patchLeadOutbound,
  patchLeadOwed,
  patchLeadPayment,
  patchLeadProgramOffered,
  patchLeadProgramadaOfrecido,
  patchLeadStatus,
  resolveDefaultCloser,
  buildCloserOptions,
  syncGhlForDay,
  refrescarClosersFromGhl,
} from '../services/daily-panel-service'
import {
  createAdminManualCall,
  getAdminDailyCalls,
} from '@/features/admin-panel/services/admin-panel-service'
import { DEFAULT_DAILY_CLOSER } from '../constants'
import type { DailyCall } from '../types'
import { ArgentinaClock } from './argentina-clock'
import { DailyCallsTable } from './daily-calls-table'
import '../daily-panel.css'
import '../daily-panel-manual-call.css'

function confirmPastDayAction(dateLabel: string, action: string): boolean {
  return window.confirm(
    `Estás viendo el ${dateLabel}. ${action} puede modificar datos de ese día. ¿Continuar?`,
  )
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="neo-panel">
      <div className="neo-panel__backdrop" aria-hidden="true" />
      <div className="neo-panel__inner">{children}</div>
    </div>
  )
}

export function DailyPanelPage({
  mode = 'default',
  adminToken = null,
}: {
  mode?: 'default' | 'admin'
  adminToken?: string | null
}) {
  const isAdmin = mode === 'admin' && Boolean(adminToken)
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const { timeZone, option } = useTimezone()
  const todayIso = useMemo(() => todayIsoInTimeZone(timeZone), [timeZone])
  const [selectedDate, setSelectedDate] = useState(() => todayIsoInTimeZone(DEFAULT_TIMEZONE))
  const [fecha, setFecha] = useState('')
  const [calls, setCalls] = useState<DailyCall[]>([])
  const [closerOptions, setCloserOptions] = useState<string[]>([])
  const [triajerOptions, setTriajerOptions] = useState<string[]>([])
  const [setterOptions, setSetterOptions] = useState<string[]>([])
  const [programOptions, setProgramOptions] = useState<string[]>([''])
  const [defaultCloser, setDefaultCloser] = useState(DEFAULT_DAILY_CLOSER)
  const [loading, setLoading] = useState(true)
  const [metaReady, setMetaReady] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualHora, setManualHora] = useState('')
  const [manualCloser, setManualCloser] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [assigningTriajers, setAssigningTriajers] = useState(false)
  const [refreshingClosers, setRefreshingClosers] = useState(false)
  /** '' = todos; '__empty__' = sin closer asignado */
  const [closerFilter, setCloserFilter] = useState('')
  const [nameSearch, setNameSearch] = useState('')

  // Closers / programas: una sola vez (no en cada cambio de fecha).
  useEffect(() => {
    if (!ready || !userId) {
      setMetaReady(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [closers, triajers, setters] = await Promise.all([
          getTeamClosers().catch(() => [] as string[]),
          getTeamTriajers().catch(() => [] as string[]),
          getTeamSetters().catch(() => [] as string[]),
        ])
        if (cancelled) return
        const resolvedDefault = resolveDefaultCloser(closers)
        setCloserOptions(closers)
        setTriajerOptions(triajers)
        setSetterOptions(setters)
        setDefaultCloser(resolvedDefault)
        setManualCloser((prev) => prev || resolvedDefault)
        setMetaReady(true)
      } catch {
        if (!cancelled) {
          setCloserOptions([])
          setTriajerOptions([])
          setSetterOptions([])
          setDefaultCloser('')
          setMetaReady(true)
        }
      }
      void getProgramOptions()
        .then((opts) => {
          if (!cancelled) setProgramOptions(opts)
        })
        .catch(() => {
          if (!cancelled) setProgramOptions([''])
        })
    })()
    return () => {
      cancelled = true
    }
  }, [ready, userId])

  const fetchCalls = useCallback(
    async (silent = false) => {
      if (!ready || !userId || !metaReady) {
        if (!ready || !userId) {
          setCalls([])
          setFecha('')
          setLoading(false)
        }
        return
      }
      if (isAdmin && !adminToken) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      try {
        const data = isAdmin
          ? await getAdminDailyCalls(selectedDate, adminToken!, closerOptions, defaultCloser)
          : await getDailyCalls(closerOptions, defaultCloser, selectedDate)
        setFecha(data.fecha)
        setCalls(data.llamadas)
      } catch (e) {
        if (!silent) {
          toast(e instanceof Error ? e.message : 'Error al cargar el panel.')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [
      ready,
      userId,
      toast,
      isAdmin,
      adminToken,
      selectedDate,
      metaReady,
      closerOptions,
      defaultCloser,
    ],
  )

  useEffect(() => {
    if (!metaReady) return
    void fetchCalls()
  }, [fetchCalls, metaReady])

  const handleStatusChange = useCallback(
    async (leadId: number, status: string) => {
      try {
        await patchLeadStatus(leadId, status)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, status } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el status.')
        throw e
      }
    },
    [toast],
  )

  const handleCloserChange = useCallback(
    async (leadId: number, closer: string) => {
      try {
        await patchLeadCloser(leadId, closer)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, closer } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el closer.')
        throw e
      }
    },
    [toast],
  )

  const handleTriajerChange = useCallback(
    async (leadId: number, triajer: string) => {
      try {
        await patchLeadTriajer(leadId, triajer)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, triajer } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el triajer.')
        throw e
      }
    },
    [toast],
  )

  const handleSetterChange = useCallback(
    async (leadId: number, setter: string) => {
      try {
        await patchLeadSetter(leadId, setter)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, setter } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el setter.')
        throw e
      }
    },
    [toast],
  )

  const handleTriajeHechoChange = useCallback(
    async (leadId: number, hecho: boolean) => {
      try {
        await patchLeadTriajeHecho(leadId, hecho)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, triaje_hecho: hecho } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el triaje.')
        throw e
      }
    },
    [toast],
  )

  const handleOutboundChange = useCallback(
    async (leadId: number, outbound: boolean) => {
      try {
        await patchLeadOutbound(leadId, outbound)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, outbound } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar outbound.')
        throw e
      }
    },
    [toast],
  )

  const handleFathomLinkChange = useCallback(
    async (leadId: number, callLink: string | null) => {
      try {
        await patchLeadCallLink(leadId, callLink)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, call_link: callLink ?? '' } : c)),
        )
        if (callLink?.trim()) {
          toast('Link guardado. Análisis Fathom en curso si aplica.')
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el link.')
        throw e
      }
    },
    [toast],
  )

  const handlePaymentChange = useCallback(
    async (leadId: number, payment: number) => {
      try {
        await patchLeadPayment(leadId, payment)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, payment } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el pago.')
        throw e
      }
    },
    [toast],
  )

  const handleOwedChange = useCallback(
    async (leadId: number, owed: number) => {
      try {
        await patchLeadOwed(leadId, owed)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, owed } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el debe.')
        throw e
      }
    },
    [toast],
  )

  const handleProgramOfferedChange = useCallback(
    async (leadId: number, program: string) => {
      try {
        await patchLeadProgramOffered(leadId, program)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, program_offered: program } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el programa comprado.')
        throw e
      }
    },
    [toast],
  )

  const handleProgramadaOfrecidoChange = useCallback(
    async (leadId: number, program: string) => {
      try {
        await patchLeadProgramadaOfrecido(leadId, program)
        setCalls((prev) =>
          prev.map((c) =>
            c.id === leadId ? { ...c, programada_ofrecido_llamada: program } : c,
          ),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el programa ofrecido.')
        throw e
      }
    },
    [toast],
  )

  const handleCalificacionChange = useCallback(
    async (leadId: number, calificacion: DailyCall['calificacion_llamada']) => {
      try {
        await patchLeadCalificacion(leadId, calificacion)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, calificacion_llamada: calificacion } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar la calificación.')
        throw e
      }
    },
    [toast],
  )

  const handleAddManualCall = useCallback(async () => {
    const name = manualName.trim()
    const hora = manualHora.trim()
    const closer = (manualCloser || defaultCloser).trim()
    if (!name) {
      toast('Indicá el nombre del lead.')
      return
    }
    if (!/^\d{1,2}:\d{2}$/.test(hora)) {
      toast('Hora inválida (usar HH:MM).')
      return
    }
    if (!closer) {
      toast('Seleccioná un closer.')
      return
    }
    setManualSaving(true)
    try {
      if (isAdmin && adminToken) {
        await createAdminManualCall(selectedDate, adminToken, {
          client_name: name,
          closer,
          hora,
        })
      } else {
        await createManualCall({
          client_name: name,
          closer,
          hora,
          fecha: selectedDate,
        })
      }
      toast('Llamada agregada.')
      setManualOpen(false)
      setManualName('')
      setManualHora('')
      await fetchCalls(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar la llamada.')
    } finally {
      setManualSaving(false)
    }
  }, [manualName, manualHora, manualCloser, defaultCloser, toast, fetchCalls, isAdmin, adminToken, selectedDate])

  const handleGenerateReport = useCallback(async () => {
    const reportDate = selectedDate || fecha
    if (!reportDate) {
      toast('Esperá a que cargue el panel.')
      return
    }
    if (calls.length === 0) {
      toast('No hay llamadas en el panel para generar reportes.')
      return
    }
    const dateLabel = formatIsoDateDdMmYyyy(reportDate)
    if (
      isDateBeforeToday(reportDate, timeZone) &&
      !confirmPastDayAction(dateLabel, 'Generar reporte')
    ) {
      return
    }
    setGeneratingReport(true)
    try {
      const result = await generateCloserReportsForDay(reportDate)
      const label =
        result.generated === 1 ? '1 reporte generado' : `${result.generated} reportes generados`
      toast(
        result.discord_sent ? `${label} y enviados a Discord` : `${label} (Discord no configurado)`,
      )
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el reporte del día.')
    } finally {
      setGeneratingReport(false)
    }
  }, [selectedDate, fecha, calls.length, toast, timeZone])

  const handleRefresh = useCallback(async () => {
    if (!ready || !userId || !metaReady) return
    if (isAdmin && !adminToken) return
    const day = selectedDate || todayIso
    const dateLabel = formatIsoDateDdMmYyyy(day)
    if (isDateBeforeToday(day, timeZone) && !confirmPastDayAction(dateLabel, 'Actualizar GHL')) {
      return
    }
    setLoading(true)
    try {
      const sync = await syncGhlForDay(day)
      const data = isAdmin
        ? await getAdminDailyCalls(day, adminToken!, closerOptions, defaultCloser)
        : await getDailyCalls(closerOptions, defaultCloser, day)
      setFecha(data.fecha)
      setCalls(data.llamadas)
      const parts = [
        sync.created ? `${sync.created} nuevas` : null,
        sync.updated ? `${sync.updated} actualizadas` : null,
      ].filter(Boolean)
      toast(
        parts.length > 0
          ? `GHL ${day}: ${parts.join(', ')}.`
          : `GHL ${day}: sin cambios.`,
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al sincronizar GHL.')
    } finally {
      setLoading(false)
    }
  }, [
    ready,
    userId,
    metaReady,
    selectedDate,
    isAdmin,
    adminToken,
    closerOptions,
    defaultCloser,
    toast,
    timeZone,
    todayIso,
  ])

  const handleRefreshClosers = useCallback(async () => {
    if (!ready || !userId || !metaReady) return
    const endDay = selectedDate || todayIso
    const startDay = addDaysIso(endDay, -6)
    const rangeLabel = `${formatIsoDateDdMmYyyy(startDay)} – ${formatIsoDateDdMmYyyy(endDay)}`
    const ok = window.confirm(
      `Esto actualiza el closer de las llamadas (${rangeLabel}) según lo que figura en Go High Level.\n\nSi corregiste algún closer manualmente en ATV, se va a reemplazar por el de GHL.\n\n¿Continuar?`,
    )
    if (!ok) return
    setRefreshingClosers(true)
    try {
      const result = await refrescarClosersFromGhl(startDay, endDay)
      await fetchCalls(true)
      const summary =
        result.actualizadas === 0
          ? `${result.revisadas} citas revisadas, sin cambios.`
          : `${result.actualizadas} closers actualizados de ${result.revisadas} citas revisadas.`
      toast(summary)
      if (result.detalle.length > 0) {
        const lines = result.detalle
          .slice(0, 8)
          .map((d) => `${d.nombre}: ${d.antes || '(vacío)'} → ${d.despues}`)
        const extra =
          result.detalle.length > 8 ? `\n… y ${result.detalle.length - 8} más` : ''
        window.alert(`Closers actualizados:\n\n${lines.join('\n')}${extra}`)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron refrescar los closers.')
    } finally {
      setRefreshingClosers(false)
    }
  }, [ready, userId, metaReady, selectedDate, todayIso, toast, fetchCalls])

  const handleAssignTriajers = useCallback(async () => {
    const day = selectedDate || todayIso
    const missing = calls.filter((c) => !(c.triajer || '').trim()).length
    if (missing === 0) {
      toast('Todas las llamadas del día ya tienen triajer.')
      return
    }
    if (triajerOptions.length === 0) {
      toast('No hay triajers. Creá uno en Equipo → + Triajer.')
      return
    }
    setAssigningTriajers(true)
    try {
      const result = await assignTriajersForDay(day)
      await fetchCalls(true)
      if (result.assigned === 0) {
        toast('No se asignó ningún triajer.')
      } else {
        toast(
          result.assigned === 1
            ? '1 triajer asignado.'
            : `${result.assigned} triajers asignados.`,
        )
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron asignar triajers.')
    } finally {
      setAssigningTriajers(false)
    }
  }, [selectedDate, calls, triajerOptions.length, toast, fetchCalls, todayIso])

  const shiftDay = useCallback((delta: number) => {
    setSelectedDate((prev) => addDaysIso(prev || todayIso, delta))
  }, [todayIso])

  const goToToday = useCallback(() => {
    setSelectedDate(todayIso)
  }, [todayIso])

  const closerFilterOptions = useMemo(() => {
    const names = new Set<string>()
    for (const n of closerOptions) {
      const t = n.trim()
      if (t) names.add(t)
    }
    for (const c of calls) {
      const t = (c.closer || '').trim()
      if (t) names.add(t)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es'))
  }, [closerOptions, calls])

  const hasEmptyCloser = useMemo(
    () => calls.some((c) => !(c.closer || '').trim()),
    [calls],
  )

  const filteredCalls = useMemo(() => {
    let result = calls
    if (closerFilter === '__empty__') {
      result = result.filter((c) => !(c.closer || '').trim())
    } else if (closerFilter) {
      const needle = closerFilter.trim().toLowerCase()
      result = result.filter((c) => (c.closer || '').trim().toLowerCase() === needle)
    }
    const q = nameSearch.trim().toLowerCase()
    if (q) {
      result = result.filter((c) => (c.lead || '').toLowerCase().includes(q))
    }
    return result
  }, [calls, closerFilter, nameSearch])

  if (!ready) {
    return (
      <PanelShell>
        <div className="neo-panel__loading">Cargando…</div>
      </PanelShell>
    )
  }

  if (!userId) {
    return (
      <PanelShell>
        <div className="neo-panel__empty">Iniciá sesión para ver el panel.</div>
      </PanelShell>
    )
  }

  const activeDate = fecha || selectedDate
  const fechaLabel = activeDate ? formatIsoDateDdMmYyyy(activeDate) : '—'
  const viewingPast = activeDate ? isDateBeforeToday(activeDate, timeZone) : false
  const isFiltered = Boolean(closerFilter || nameSearch.trim())
  const countLabel =
    isFiltered && filteredCalls.length !== calls.length
      ? `${filteredCalls.length} de ${calls.length} llamadas`
      : filteredCalls.length === 1
        ? '1 llamada'
        : `${filteredCalls.length} llamadas`

  return (
    <PanelShell>
      <header className="neo-panel__header">
        <div>
          <h1 className="neo-panel__title">
            {isAdmin ? 'Corrección reportes' : 'Dashboard diario'}
          </h1>
          <div className="neo-panel__day-nav" aria-label="Navegación de días">
            <button
              type="button"
              className="neo-panel__day-nav-btn"
              onClick={() => shiftDay(-1)}
              disabled={loading}
            >
              ← Anterior
            </button>
            <p className="neo-panel__day-nav-date">{fechaLabel}</p>
            <button
              type="button"
              className="neo-panel__day-nav-btn"
              onClick={() => shiftDay(1)}
              disabled={loading}
            >
              Siguiente →
            </button>
            <button
              type="button"
              className="neo-panel__day-nav-btn neo-panel__day-nav-btn--today"
              onClick={goToToday}
              disabled={loading || selectedDate === todayIso}
              title="Volver al día de hoy"
            >
              Hoy
            </button>
          </div>
          <p className="neo-panel__subtitle">
            {option.label}
            {viewingPast ? ' · día anterior' : ''}
            {isAdmin ? ' · modo admin' : ''}
          </p>
        </div>
        <div className="neo-panel__header-meta">
          <label className="neo-panel__date-field">
            <span className="sr-only">Fecha</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="neo-panel__date-input"
              disabled={loading}
            />
          </label>
          <ArgentinaClock active={ready && Boolean(userId)} />
          <button
            type="button"
            disabled={loading || generatingReport || calls.length === 0}
            onClick={() => void handleGenerateReport()}
            className="neo-panel__btn"
            title="Genera el reporte closer desde los datos del panel del día seleccionado"
          >
            {generatingReport ? 'Generando…' : 'Generar reporte'}
          </button>
          <button
            type="button"
            disabled={
              loading ||
              assigningTriajers ||
              calls.length === 0 ||
              calls.every((c) => Boolean((c.triajer || '').trim()))
            }
            onClick={() => void handleAssignTriajers()}
            className="neo-panel__btn neo-panel__btn--ghost"
            title="Asigna triajer a todas las llamadas del día que aún no tienen uno"
          >
            {assigningTriajers ? 'Asignando…' : 'Asignar triajers'}
          </button>
          <button
            type="button"
            disabled={loading || refreshingClosers}
            onClick={() => void handleRefreshClosers()}
            className="neo-panel__btn neo-panel__btn--ghost"
            title="Actualiza el closer desde GHL (últimos 7 días respecto al día seleccionado). Reemplaza correcciones manuales en ATV."
          >
            {refreshingClosers ? 'Refrescando…' : 'Refrescar closers'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleRefresh()}
            className="neo-panel__btn neo-panel__btn--ghost"
            title="Sincroniza las agendas de GHL del día seleccionado"
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <section className="neo-panel__module">
        <div className="neo-panel__module-head">
          <h2 className="neo-panel__module-title">Llamadas del día</h2>
          <label className="neo-panel__name-search">
            <span className="sr-only">Buscar por nombre</span>
            <input
              type="search"
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              placeholder="Buscar por nombre…"
              className="neo-panel__name-search-input"
              aria-label="Buscar por nombre"
            />
          </label>
          <label className="neo-panel__closer-filter">
            <span className="sr-only">Filtrar por closer</span>
            <select
              value={closerFilter}
              onChange={(e) => setCloserFilter(e.target.value)}
              className="neo-panel__closer-filter-select"
              aria-label="Filtrar por closer"
            >
              <option value="">Todos los closers</option>
              {closerFilterOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {hasEmptyCloser ? (
                <option value="__empty__">Sin closer</option>
              ) : null}
            </select>
          </label>
          <p className="neo-panel__module-hint">{countLabel}</p>
        </div>
        <DailyCallsTable
          items={filteredCalls}
          closerOptions={closerOptions}
          triajerOptions={triajerOptions}
          setterOptions={setterOptions}
          programOptions={programOptions}
          defaultCloser={defaultCloser}
          loading={loading}
          onStatusChange={handleStatusChange}
          onCloserChange={handleCloserChange}
          onTriajerChange={handleTriajerChange}
          onSetterChange={handleSetterChange}
          onTriajeHechoChange={handleTriajeHechoChange}
          onOutboundChange={handleOutboundChange}
          onCalificacionChange={handleCalificacionChange}
          onFathomLinkChange={handleFathomLinkChange}
          onPaymentChange={handlePaymentChange}
          onOwedChange={handleOwedChange}
          onProgramOfferedChange={handleProgramOfferedChange}
          onProgramadaOfrecidoChange={handleProgramadaOfrecidoChange}
          onAddManualCall={() => setManualOpen(true)}
          emptyDateLabel={fechaLabel !== '—' ? fechaLabel : undefined}
        />
      </section>

      {manualOpen ? (
        <div className="neo-manual-call">
          <div className="neo-manual-call__backdrop" onClick={() => setManualOpen(false)} />
          <div className="neo-manual-call__card" role="dialog" aria-labelledby="manual-call-title">
            <h3 id="manual-call-title" className="neo-manual-call__title">
              Agregar llamada manual
            </h3>
            <p className="neo-manual-call__hint">
              {`El lead se crea para el ${formatIsoDateDdMmYyyy(selectedDate)} y aparece en el panel de ese día.`}
            </p>
            <label className="neo-manual-call__field">
              <span>Nombre del lead</span>
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Ej. Juan Pérez"
              />
            </label>
            <label className="neo-manual-call__field">
              <span>Hora (HH:MM)</span>
              <input
                value={manualHora}
                onChange={(e) => setManualHora(e.target.value)}
                placeholder="14:30"
              />
            </label>
            <label className="neo-manual-call__field">
              <span>Closer</span>
              <select value={manualCloser || defaultCloser} onChange={(e) => setManualCloser(e.target.value)}>
                {buildCloserOptions(closerOptions).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="neo-manual-call__actions">
              <button type="button" className="neo-panel__btn neo-panel__btn--ghost" onClick={() => setManualOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="neo-panel__btn"
                disabled={manualSaving}
                onClick={() => void handleAddManualCall()}
              >
                {manualSaving ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PanelShell>
  )
}
