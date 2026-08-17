'use client'

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'

const PAGE_SIZE = 80
import {
  canonicalLeadStatus,
  PROGRAM_COLORS,
  STATUS_COLORS,
  STATUS_OPTIONS,
} from '@/features/leads/types'
import { useTimezone } from '@/shared/hooks/use-timezone'
import { formatCash } from '@/shared/lib/format-utils'
import { formatCallTime } from '@/shared/lib/timezone'
import type { DailyCall } from '../types'
import { buildCloserOptions } from '../services/daily-panel-service'

type Props = {
  items: DailyCall[]
  closerOptions: string[]
  triajerOptions: string[]
  setterOptions: string[]
  programOptions: string[]
  defaultCloser: string
  loading: boolean
  onStatusChange: (leadId: number, status: string) => Promise<void>
  onCloserChange: (leadId: number, closer: string) => Promise<void>
  onTriajerChange: (leadId: number, triajer: string) => Promise<void>
  onSetterChange: (leadId: number, setter: string) => Promise<void>
  onTriajeHechoChange: (leadId: number, hecho: boolean) => Promise<void>
  onOutboundChange: (leadId: number, outbound: boolean) => Promise<void>
  onCalificacionChange: (
    leadId: number,
    calificacion: DailyCall['calificacion_llamada'],
  ) => Promise<void>
  onFathomLinkChange: (leadId: number, callLink: string | null) => Promise<void>
  onPaymentChange: (leadId: number, payment: number) => Promise<void>
  onOwedChange: (leadId: number, owed: number) => Promise<void>
  onProgramOfferedChange: (leadId: number, program: string) => Promise<void>
  onProgramadaOfrecidoChange: (leadId: number, program: string) => Promise<void>
  onAddManualCall?: () => void
  /** Etiqueta del día seleccionado para mensajes vacíos (ej. 29/07/2026). */
  emptyDateLabel?: string
  /** Cambia al cambiar de día: no resetear página en un refresh del mismo día. */
  resetPageKey?: string
}

function programSelectOptions(programOptions: string[], current: string): string[] {
  const set = new Set(programOptions)
  const cur = current.trim()
  if (cur) set.add(cur)
  if (!set.has('')) set.add('')
  return [...set].sort((a, b) => {
    if (!a) return -1
    if (!b) return 1
    return a.localeCompare(b, 'es')
  })
}

const ProgramSelect = memo(function ProgramSelect({
  leadId,
  value,
  options,
  label,
  onChange,
}: {
  leadId: number
  value: string
  options: string[]
  label: string
  onChange: (leadId: number, program: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const merged = useMemo(() => programSelectOptions(options, value), [options, value])
  const current = value.trim()
  const color = current ? PROGRAM_COLORS[current] || '#c084fc' : '#6e5a78'

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (next === current) return
    setSaving(true)
    try {
      await onChange(leadId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <select
      value={current}
      disabled={saving}
      onChange={(e) => void handleChange(e)}
      className="neo-calls__program-select"
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}10`,
      }}
      aria-label={label}
    >
      {merged.map((opt) => (
        <option key={opt || '__empty'} value={opt}>
          {opt || '—'}
        </option>
      ))}
    </select>
  )
})

const CloserSelect = memo(function CloserSelect({
  leadId,
  closer,
  options,
  defaultCloser: _defaultCloser,
  onCloserChange,
}: {
  leadId: number
  closer: string
  options: string[]
  defaultCloser: string
  onCloserChange: (leadId: number, closer: string) => Promise<void>
}) {
  void _defaultCloser
  const [saving, setSaving] = useState(false)
  const trimmed = closer.trim()
  const matched = options.find((o) => o.toLowerCase() === trimmed.toLowerCase())
  const selectOptions =
    trimmed && !matched ? [trimmed, ...options.filter((o) => o !== trimmed)] : options
  const value = matched ?? trimmed

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (next === value) return
    setSaving(true)
    try {
      await onCloserChange(leadId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <select
      value={value}
      disabled={saving || options.length === 0}
      onChange={(e) => void handleChange(e)}
      className="neo-calls__closer-select"
      aria-label={`Closer de lead ${leadId}`}
    >
      {value === '' ? (
        <option value="">Sin closer</option>
      ) : null}
      {selectOptions.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
})

const TriajerSelect = memo(function TriajerSelect({
  leadId,
  triajer,
  options,
  onTriajerChange,
}: {
  leadId: number
  triajer: string
  options: string[]
  onTriajerChange: (leadId: number, triajer: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const matched = options.find((o) => o.toLowerCase() === triajer.trim().toLowerCase())
  const value = matched ?? (triajer.trim() || '')

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (next === value) return
    setSaving(true)
    try {
      await onTriajerChange(leadId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => void handleChange(e)}
      className="neo-calls__closer-select"
      aria-label={`Triajer de lead ${leadId}`}
    >
      <option value="">—</option>
      {value && !matched ? <option value={value}>{value}</option> : null}
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
})

const SetterSelect = memo(function SetterSelect({
  leadId,
  setter,
  options,
  onSetterChange,
}: {
  leadId: number
  setter: string
  options: string[]
  onSetterChange: (leadId: number, setter: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const matched = options.find((o) => o.toLowerCase() === setter.trim().toLowerCase())
  const value = matched ?? (setter.trim() || '')

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (next === value) return
    setSaving(true)
    try {
      await onSetterChange(leadId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => void handleChange(e)}
      className="neo-calls__closer-select"
      aria-label={`Setter de lead ${leadId}`}
    >
      <option value="">Sin especificar</option>
      {value && !matched ? <option value={value}>{value}</option> : null}
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
})

const TriajeCheckbox = memo(function TriajeCheckbox({
  leadId,
  hecho,
  onChange,
}: {
  leadId: number
  hecho: boolean
  onChange: (leadId: number, hecho: boolean) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  const toggle = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onChange(leadId, !hecho)
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="neo-calls__triaje-check">
      <input
        type="checkbox"
        checked={hecho}
        disabled={saving}
        onChange={() => void toggle()}
        aria-label={`Triaje hecho para lead ${leadId}`}
      />
      <span>{hecho ? 'Hecho' : 'Pendiente'}</span>
    </label>
  )
})

const OutboundCheckbox = memo(function OutboundCheckbox({
  leadId,
  marcado,
  onChange,
}: {
  leadId: number
  marcado: boolean
  onChange: (leadId: number, outbound: boolean) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  const toggle = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onChange(leadId, !marcado)
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="neo-calls__triaje-check">
      <input
        type="checkbox"
        checked={marcado}
        disabled={saving}
        onChange={() => void toggle()}
        aria-label={`Outbound para lead ${leadId}`}
      />
      <span>{marcado ? 'Sí' : 'No'}</span>
    </label>
  )
})

const CalificacionToggle = memo(function CalificacionToggle({
  leadId,
  value,
  onChange,
}: {
  leadId: number
  value: DailyCall['calificacion_llamada']
  onChange: (leadId: number, calificacion: DailyCall['calificacion_llamada']) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  const pick = async (next: DailyCall['calificacion_llamada']) => {
    if (next === value || saving) return
    setSaving(true)
    try {
      await onChange(leadId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="neo-calls__calif-toggle" aria-label={`Calificación de lead ${leadId}`}>
      <button
        type="button"
        disabled={saving}
        className={`neo-calls__calif-btn neo-calls__calif-btn--cal${value === 'calificado' ? ' is-on' : ''}`}
        title="Marcar como calificado"
        onClick={() => void pick(value === 'calificado' ? '' : 'calificado')}
      >
        Cal
      </button>
      <button
        type="button"
        disabled={saving}
        className={`neo-calls__calif-btn neo-calls__calif-btn--desc${value === 'descalificado' ? ' is-on' : ''}`}
        title="Marcar como descalificado"
        onClick={() => void pick(value === 'descalificado' ? '' : 'descalificado')}
      >
        Desc
      </button>
    </div>
  )
})

const StatusSelect = memo(function StatusSelect({
  leadId,
  status,
  onStatusChange,
}: {
  leadId: number
  status: string
  onStatusChange: (leadId: number, status: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const label = canonicalLeadStatus(status)
  const color = STATUS_COLORS[label] || '#b08ec4'

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (next === label) return
    setSaving(true)
    try {
      await onStatusChange(leadId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <select
      value={label}
      disabled={saving}
      onChange={(e) => void handleChange(e)}
      className="neo-calls__status-select"
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}10`,
      }}
      aria-label={`Status de lead ${leadId}`}
    >
      {STATUS_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
})

const CurrencyCell = memo(function CurrencyCell({
  leadId,
  value,
  variant,
  onSave,
}: {
  leadId: number
  value: number
  variant: 'payment' | 'owed'
  onSave: (leadId: number, amount: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const skipBlurRef = useRef(false)
  const num = Number(value) || 0
  const isOwed = variant === 'owed'

  const commit = async (raw: string) => {
    const next = Math.max(0, Number(raw) || 0)
    if (next === num) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(leadId, next)
      setEditing(false)
    } catch {
      /* toast en el padre */
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        step={1}
        defaultValue={num || ''}
        disabled={saving}
        placeholder="0"
        className="neo-calls__payment-input"
        onBlur={(e) => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false
            return
          }
          void commit(e.target.value)
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit(e.currentTarget.value)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            skipBlurRef.current = true
            setEditing(false)
          }
        }}
      />
    )
  }

  const paidClass = !isOwed && num > 0 ? 'neo-calls__payment--paid' : ''
  const owedClass = isOwed && num > 0 ? 'neo-calls__payment--owed' : ''

  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => setEditing(true)}
      className={`neo-calls__payment ${paidClass} ${owedClass}`}
      title={isOwed ? 'Editar debe' : 'Editar pago'}
    >
      {num > 0 ? formatCash(num) : isOwed ? '—' : '$0'}
    </button>
  )
})

const FathomLinkCell = memo(function FathomLinkCell({
  leadId,
  value,
  onSave,
}: {
  leadId: number
  value: string
  onSave: (leadId: number, callLink: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const skipBlurRef = useRef(false)
  const trimmed = value.trim()

  const commit = async (next: string | null) => {
    const normalized = (next ?? '').trim()
    if (normalized === trimmed) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(leadId, normalized || null)
      setEditing(false)
    } catch {
      /* toast en el padre */
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        defaultValue={trimmed}
        disabled={saving}
        placeholder="Pegar link Fathom…"
        className="neo-calls__fathom-input"
        onBlur={(e) => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false
            return
          }
          void commit(e.target.value)
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit(e.currentTarget.value)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            skipBlurRef.current = true
            setEditing(false)
          }
        }}
      />
    )
  }

  if (!trimmed) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => setEditing(true)}
        className="neo-calls__fathom-empty"
        title="Pegar link Fathom"
      >
        —
      </button>
    )
  }

  return (
    <span className="neo-calls__fathom-wrap">
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        title={trimmed}
        onDoubleClick={(e) => {
          e.preventDefault()
          setEditing(true)
        }}
        className="neo-calls__fathom-link"
      >
        ↗ Fathom
      </a>
      <button
        type="button"
        disabled={saving}
        onClick={() => void onSave(leadId, null)}
        className="neo-calls__fathom-clear"
        title="Borrar link"
        aria-label="Borrar link Fathom"
      >
        ×
      </button>
    </span>
  )
})

type RowProps = {
  row: DailyCall
  closerOptions: string[]
  triajerOptions: string[]
  setterOptions: string[]
  programOptions: string[]
  defaultCloser: string
  onStatusChange: Props['onStatusChange']
  onCloserChange: Props['onCloserChange']
  onTriajerChange: Props['onTriajerChange']
  onSetterChange: Props['onSetterChange']
  onTriajeHechoChange: Props['onTriajeHechoChange']
  onOutboundChange: Props['onOutboundChange']
  onCalificacionChange: Props['onCalificacionChange']
  onFathomLinkChange: Props['onFathomLinkChange']
  onPaymentChange: Props['onPaymentChange']
  onOwedChange: Props['onOwedChange']
  onProgramOfferedChange: Props['onProgramOfferedChange']
  onProgramadaOfrecidoChange: Props['onProgramadaOfrecidoChange']
}

const DailyCallRow = memo(function DailyCallRow({
  row,
  closerOptions,
  triajerOptions,
  setterOptions,
  programOptions,
  defaultCloser,
  onStatusChange,
  onCloserChange,
  onTriajerChange,
  onSetterChange,
  onTriajeHechoChange,
  onOutboundChange,
  onCalificacionChange,
  onFathomLinkChange,
  onPaymentChange,
  onOwedChange,
  onProgramOfferedChange,
  onProgramadaOfrecidoChange,
}: RowProps) {
  const { timeZone } = useTimezone()
  const hora =
    formatCallTime(row.call, timeZone) || row.hora || '—'

  return (
    <div className="neo-calls__row">
      <div className="neo-calls__hora">{hora}</div>
      <div className="neo-calls__lead" title={row.lead || 'Sin nombre'}>
        {row.lead || 'Sin nombre'}
      </div>
      <CloserSelect
        leadId={row.id}
        closer={row.closer}
        options={closerOptions}
        defaultCloser={defaultCloser}
        onCloserChange={onCloserChange}
      />
      <TriajerSelect
        leadId={row.id}
        triajer={row.triajer}
        options={triajerOptions}
        onTriajerChange={onTriajerChange}
      />
      <SetterSelect
        leadId={row.id}
        setter={row.setter}
        options={setterOptions}
        onSetterChange={onSetterChange}
      />
      <TriajeCheckbox
        leadId={row.id}
        hecho={row.triaje_hecho}
        onChange={onTriajeHechoChange}
      />
      <OutboundCheckbox
        leadId={row.id}
        marcado={row.outbound}
        onChange={onOutboundChange}
      />
      <FathomLinkCell leadId={row.id} value={row.call_link} onSave={onFathomLinkChange} />
      <StatusSelect leadId={row.id} status={row.status} onStatusChange={onStatusChange} />
      <CalificacionToggle
        leadId={row.id}
        value={row.calificacion_llamada}
        onChange={onCalificacionChange}
      />
      <ProgramSelect
        leadId={row.id}
        value={row.program_offered}
        options={programOptions}
        label="Programa comprado"
        onChange={onProgramOfferedChange}
      />
      <ProgramSelect
        leadId={row.id}
        value={row.programada_ofrecido_llamada}
        options={programOptions}
        label="Programa ofrecido"
        onChange={onProgramadaOfrecidoChange}
      />
      <CurrencyCell leadId={row.id} value={row.payment} variant="payment" onSave={onPaymentChange} />
      <CurrencyCell leadId={row.id} value={row.owed} variant="owed" onSave={onOwedChange} />
    </div>
  )
})

export const DailyCallsTable = memo(function DailyCallsTable({
  items,
  closerOptions,
  triajerOptions,
  setterOptions,
  programOptions,
  defaultCloser,
  loading,
  onStatusChange,
  onCloserChange,
  onTriajerChange,
  onSetterChange,
  onTriajeHechoChange,
  onOutboundChange,
  onCalificacionChange,
  onFathomLinkChange,
  onPaymentChange,
  onOwedChange,
  onProgramOfferedChange,
  onProgramadaOfrecidoChange,
  onAddManualCall,
  emptyDateLabel,
  resetPageKey,
}: Props) {
  const [page, setPage] = useState(1)
  const closerSelectOptions = useMemo(
    () => buildCloserOptions(closerOptions),
    [closerOptions],
  )
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return items.slice(start, start + PAGE_SIZE)
  }, [items, page])

  useEffect(() => {
    setPage(1)
  }, [resetPageKey])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  if (loading && items.length === 0) {
    return <div className="neo-panel__loading">Cargando llamadas</div>
  }

  if (items.length === 0) {
    return (
      <div className="neo-panel__empty neo-panel__empty--actions">
        <p>
          {emptyDateLabel
            ? `No hay llamadas para el ${emptyDateLabel}.`
            : 'No hay llamadas para este día.'}
        </p>
        {onAddManualCall ? (
          <button type="button" className="neo-panel__btn" onClick={onAddManualCall}>
            + Agregar llamada manual
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="neo-calls">
      {onAddManualCall ? (
        <div className="neo-calls__toolbar">
          <button type="button" className="neo-panel__btn neo-panel__btn--ghost" onClick={onAddManualCall}>
            + Agregar llamada manual
          </button>
        </div>
      ) : null}
      <div className="neo-calls__scroll">
        <div className="neo-calls__grid">
          <div className="neo-calls__head">
            <div>Hora</div>
            <div>Lead</div>
            <div>Closer</div>
            <div>Triajer</div>
            <div>Setter</div>
            <div>Triaje</div>
            <div>Outbound</div>
            <div>Link Fathom</div>
            <div>Status</div>
            <div>Calif. / Desc.</div>
            <div>Prog. comprado</div>
            <div>Prog. ofrecido</div>
            <div>Pago</div>
            <div>Debe</div>
          </div>
          {paged.map((row) => (
            <DailyCallRow
              key={row.id}
              row={row}
              closerOptions={closerSelectOptions}
              triajerOptions={triajerOptions}
              setterOptions={setterOptions}
              programOptions={programOptions}
              defaultCloser={defaultCloser}
              onStatusChange={onStatusChange}
              onCloserChange={onCloserChange}
              onTriajerChange={onTriajerChange}
              onSetterChange={onSetterChange}
              onTriajeHechoChange={onTriajeHechoChange}
              onOutboundChange={onOutboundChange}
              onCalificacionChange={onCalificacionChange}
              onFathomLinkChange={onFathomLinkChange}
              onPaymentChange={onPaymentChange}
              onOwedChange={onOwedChange}
              onProgramOfferedChange={onProgramOfferedChange}
              onProgramadaOfrecidoChange={onProgramadaOfrecidoChange}
            />
          ))}
        </div>
      </div>
      {items.length > PAGE_SIZE ? (
        <div className="neo-calls__pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="neo-panel__btn neo-panel__btn--ghost"
          >
            Anterior
          </button>
          <span className="neo-calls__pagination-label">
            Página {page} de {totalPages}
            <span className="neo-calls__pagination-range">
              ({Math.min(items.length, (page - 1) * PAGE_SIZE + 1)}–
              {Math.min(items.length, page * PAGE_SIZE)} de {items.length})
            </span>
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="neo-panel__btn neo-panel__btn--ghost"
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  )
})
