type KpiCardProps = {
  label: string
  value: string
  trend?: {
    value: string
    direction: 'up' | 'down' | 'neutral'
  }
  accent?: boolean
}

export function KpiCard({ label, value, trend, accent }: KpiCardProps) {
  return (
    <div className={`glass-card p-6 ${accent ? 'border-[rgba(34,197,94,0.15)]' : ''}`}>
      <div className="mb-2 text-[11px] font-normal tracking-wide text-[var(--text2)]">
        {label}
      </div>
      <div className={`font-mono-num text-3xl font-semibold tracking-tight leading-none ${accent ? 'text-[var(--green)]' : 'text-[var(--text)]'}`}>
        {value}
      </div>
      {trend && (
        <div className={`mt-2 text-[11px] font-normal ${
          trend.direction === 'up' ? 'text-[var(--green)]' :
          trend.direction === 'down' ? 'text-[var(--red)]' :
          'text-[var(--text3)]'
        }`}>
          {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '—'} {trend.value} vs mes anterior
        </div>
      )}
    </div>
  )
}
