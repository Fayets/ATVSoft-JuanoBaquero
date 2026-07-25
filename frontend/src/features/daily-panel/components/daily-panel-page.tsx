'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import {
  createManualCall,
  generateCloserReportsForDay,
  getDailyCalls,
  getProgramOptions,
  getTeamClosers,
  patchLeadCalificacion,
  patchLeadCallLink,
  patchLeadCloser,
  patchLeadOwed,
  patchLeadPayment,
  patchLeadProgramOffered,
  patchLeadProgramadaOfrecido,
  patchLeadStatus,
  resolveDefaultCloser,
  buildCloserOptions,
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
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [fecha, setFecha] = useState('')
  const [calls, setCalls] = useState<DailyCall[]>([])
  const [closerOptions, setCloserOptions] = useState<string[]>([])
  const [programOptions, setProgramOptions] = useState<string[]>([''])
  const [defaultCloser, setDefaultCloser] = useState(DEFAULT_DAILY_CLOSER)
  const [loading, setLoading] = useState(true)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualHora, setManualHora] = useState('')
  const [manualCloser, setManualCloser] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)

  const fetchCalls = useCallback(
    async (silent = false) => {
      if (!ready || !userId) {
        setCalls([])
        setFecha('')
        setLoading(false)
        return
      }
      if (isAdmin && !adminToken) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      try {
        let closers: string[] = []
        try {
          closers = await getTeamClosers()
        } catch {
          closers = []
        }
        const resolvedDefault = resolveDefaultCloser(closers)
        setCloserOptions(closers)
        setDefaultCloser(resolvedDefault)
        setManualCloser((prev) => prev || resolvedDefault)
        void getProgramOptions()
          .then(setProgramOptions)
          .catch(() => setProgramOptions(['']))
        const data = isAdmin
          ? await getAdminDailyCalls(selectedDate, adminToken!, closers, resolvedDefault)
          : await getDailyCalls(closers, resolvedDefault)
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
    [ready, userId, toast, isAdmin, adminToken, selectedDate],
  )

  useEffect(() => {
    void fetchCalls()
  }, [fetchCalls])

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
        await createManualCall({ client_name: name, closer, hora })
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
    const reportDate = isAdmin ? selectedDate : fecha
    if (!reportDate) {
      toast('Esperá a que cargue el panel.')
      return
    }
    if (calls.length === 0) {
      toast('No hay llamadas en el panel para generar reportes.')
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
  }, [isAdmin, selectedDate, fecha, calls.length, toast])

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

  const fechaLabel = fecha ? formatIsoDateDdMmYyyy(fecha) : isAdmin ? formatIsoDateDdMmYyyy(selectedDate) : 'HOY'
  const countLabel =
    calls.length === 1 ? '1 llamada' : `${calls.length} llamadas`

  return (
    <PanelShell>
      <header className="neo-panel__header">
        <div>
          <h1 className="neo-panel__title">
            {isAdmin ? 'Corrección reportes' : 'Dashboard diario'}
          </h1>
          <p className="neo-panel__subtitle">
            {fechaLabel} · Argentina
            {isAdmin ? ' · modo admin' : ''}
          </p>
        </div>
        <div className="neo-panel__header-meta">
          {isAdmin ? (
            <label className="neo-panel__date-field">
              <span className="sr-only">Fecha</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="neo-panel__date-input"
              />
            </label>
          ) : null}
          <ArgentinaClock active={ready && Boolean(userId)} />
          <button
            type="button"
            disabled={loading || generatingReport || calls.length === 0}
            onClick={() => void handleGenerateReport()}
            className="neo-panel__btn"
            title={
              isAdmin
                ? 'Actualiza el reporte closer de la fecha seleccionada'
                : 'Genera el reporte closer desde los datos del panel (como a las 23:00)'
            }
          >
            {generatingReport ? 'Generando…' : 'Generar reporte'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchCalls()}
            className="neo-panel__btn neo-panel__btn--ghost"
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <section className="neo-panel__module">
        <div className="neo-panel__module-head">
          <h2 className="neo-panel__module-title">
            {isAdmin ? 'Llamadas del día' : 'Llamadas de hoy'}
          </h2>
          <p className="neo-panel__module-hint">{countLabel}</p>
        </div>
        <DailyCallsTable
          items={calls}
          closerOptions={closerOptions}
          programOptions={programOptions}
          defaultCloser={defaultCloser}
          loading={loading}
          onStatusChange={handleStatusChange}
          onCloserChange={handleCloserChange}
          onCalificacionChange={handleCalificacionChange}
          onFathomLinkChange={handleFathomLinkChange}
          onPaymentChange={handlePaymentChange}
          onOwedChange={handleOwedChange}
          onProgramOfferedChange={handleProgramOfferedChange}
          onProgramadaOfrecidoChange={handleProgramadaOfrecidoChange}
          onAddManualCall={() => setManualOpen(true)}
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
              {isAdmin
                ? `El lead se crea para el ${formatIsoDateDdMmYyyy(selectedDate)} y aparece en la tabla leads.`
                : 'El lead se crea en la tabla leads y aparece en el panel de hoy.'}
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
