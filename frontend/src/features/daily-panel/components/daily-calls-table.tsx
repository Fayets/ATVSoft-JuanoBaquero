'use client'

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  canonicalLeadStatus,
  PROGRAM_COLORS,
  STATUS_COLORS,
  STATUS_OPTIONS,
} from '@/features/leads/types'
import { formatCash } from '@/shared/lib/format-utils'
import type { DailyCall } from '../types'
import { buildCloserOptions } from '../services/daily-panel-service'

type Props = {
  items: DailyCall[]
  closerOptions: string[]
  programOptions: string[]
  defaultCloser: string
  loading: boolean
  onStatusChange: (leadId: number, status: string) => Promise<void>
  onCloserChange: (leadId: number, closer: string) => Promise<void>
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

function ProgramSelect({
  leadId,
  value,
  programOptions,
  label,
  onChange,
}: {
  leadId: number
  value: string
  programOptions: string[]
  label: string
  onChange: (leadId: number, program: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const options = programSelectOptions(programOptions, value)
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
      {options.map((opt) => (
        <option key={opt || '__empty'} value={opt}>
          {opt || '—'}
        </option>
      ))}
    </select>
  )
}

function CloserSelect({
  leadId,
  closer,
  closerOptions,
  defaultCloser,
  onCloserChange,
}: {
  leadId: number
  closer: string
  closerOptions: string[]
  defaultCloser: string
  onCloserChange: (leadId: number, closer: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const options = buildCloserOptions(closerOptions)
  const value =
    options.find((o) => o.toLowerCase() === closer.trim().toLowerCase()) ?? defaultCloser

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
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}

function CalificacionToggle({
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
}

function StatusSelect({
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
}

function CurrencyCell({
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
}

function PaymentCell({
  leadId,
  value,
  onSave,
}: {
  leadId: number
  value: number
  onSave: (leadId: number, payment: number) => Promise<void>
}) {
  return <CurrencyCell leadId={leadId} value={value} variant="payment" onSave={onSave} />
}

function FathomLinkCell({
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
}

export function DailyCallsTable({
  items,
  closerOptions,
  programOptions,
  defaultCloser,
  loading,
  onStatusChange,
  onCloserChange,
  onCalificacionChange,
  onFathomLinkChange,
  onPaymentChange,
  onOwedChange,
  onProgramOfferedChange,
  onProgramadaOfrecidoChange,
  onAddManualCall,
}: Props) {
  if (loading && items.length === 0) {
    return <div className="neo-panel__loading">Cargando llamadas</div>
  }

  if (items.length === 0) {
    return (
      <div className="neo-panel__empty neo-panel__empty--actions">
        <p>No hay llamadas agendadas para hoy.</p>
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
      <div className="neo-calls__head">
        <div>Hora</div>
        <div>Lead</div>
        <div>Closer</div>
        <div>Link Fathom</div>
        <div>Status</div>
        <div>Calif. / Desc.</div>
        <div>Prog. comprado</div>
        <div>Prog. ofrecido</div>
        <div>Pago</div>
        <div>Debe</div>
      </div>
      {items.map((row) => (
        <div key={row.id} className="neo-calls__row">
          <div className="neo-calls__hora">{row.hora || '—'}</div>
          <div className="neo-calls__lead" title={row.lead || 'Sin nombre'}>
            {row.lead || 'Sin nombre'}
          </div>
          <CloserSelect
            leadId={row.id}
            closer={row.closer}
            closerOptions={closerOptions}
            defaultCloser={defaultCloser}
            onCloserChange={onCloserChange}
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
            programOptions={programOptions}
            label="Programa comprado"
            onChange={onProgramOfferedChange}
          />
          <ProgramSelect
            leadId={row.id}
            value={row.programada_ofrecido_llamada}
            programOptions={programOptions}
            label="Programa ofrecido"
            onChange={onProgramadaOfrecidoChange}
          />
          <PaymentCell leadId={row.id} value={row.payment} onSave={onPaymentChange} />
          <CurrencyCell leadId={row.id} value={row.owed} variant="owed" onSave={onOwedChange} />
        </div>
      ))}
    </div>
  )
}
