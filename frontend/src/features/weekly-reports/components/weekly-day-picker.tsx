'use client'

import {
  dayLabel,
  dayNumber,
  daysBetweenInclusive,
  type WeeklyPeriod,
} from '../services/weekly-reports-service'

type Props = {
  desde: string
  hasta: string
  selectedDays: Set<string>
  onToggleDay: (iso: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}

export function WeeklyDayPicker({
  desde,
  hasta,
  selectedDays,
  onToggleDay,
  onSelectAll,
  onClearAll,
}: Props) {
  const spanDays = daysBetweenInclusive(desde, hasta)

  if (spanDays.length === 0) {
    return (
      <p className="text-[12px] text-[var(--text3)]">
        Elegí un rango válido (desde ≤ hasta).
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--text2)]">
          Días a incluir ({selectedDays.size}/{spanDays.length})
        </span>
        <div className="flex gap-2 text-[10px]">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-[var(--accent)] hover:underline"
          >
            Todos
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="text-[var(--text3)] hover:underline"
          >
            Ninguno
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {spanDays.map((iso) => {
          const on = selectedDays.has(iso)
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onToggleDay(iso)}
              className={`flex min-w-[3.25rem] flex-col items-center rounded-lg border px-2 py-2 transition-all ${
                on
                  ? 'border-[var(--accent)] bg-[var(--accent-faint)] text-[var(--text)] shadow-[0_0_0_1px_rgba(230,57,70,0.15)]'
                  : 'border-[var(--border2)] bg-[var(--bg3)] text-[var(--text3)] hover:border-[var(--border)]'
              }`}
              title={iso}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide">{dayLabel(iso)}</span>
              <span className="text-[14px] font-semibold tabular-nums">{dayNumber(iso)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function periodFromSelection(desde: string, hasta: string, selectedDays: Set<string>): WeeklyPeriod {
  const span = daysBetweenInclusive(desde, hasta)
  const dias = span.filter((d) => selectedDays.has(d))
  return {
    fecha_inicio: desde,
    fecha_fin: hasta,
    dias,
  }
}
