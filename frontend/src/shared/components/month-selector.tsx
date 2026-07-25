'use client'

type MonthSelectorProps = {
  month: string
  options: { value: string; label: string }[]
  onChange: (month: string) => void
  /** Etiqueta encima del select (maqueta mes actual / comparación). */
  label?: string
  className?: string
}

export function MonthSelector({ month, options, onChange, label, className }: MonthSelectorProps) {
  const select = (
    <select
      value={month}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full min-w-[140px] rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none capitalize transition-colors focus:border-[var(--text3)] cursor-pointer ${className ?? ''}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
  if (!label) return select
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">{label}</div>
      {select}
    </div>
  )
}
