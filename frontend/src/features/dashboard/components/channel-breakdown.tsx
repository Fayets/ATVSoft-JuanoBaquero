import type { ChannelBreakdown } from '../types/dashboard'

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR')
}

type ChannelBreakdownProps = {
  channels: ChannelBreakdown[]
}

export function ChannelBreakdownCard({ channels }: ChannelBreakdownProps) {
  const totalCash = channels.reduce((s, c) => s + c.cash, 0)

  return (
    <div className="glass-card p-6">
      <div className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
        Breakdown por canal
      </div>

      <div className="space-y-3">
        {channels.map((ch) => {
          const pct = totalCash > 0 ? (ch.cash / totalCash) * 100 : 0
          return (
            <div key={ch.name}>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: ch.color }}
                  />
                  <span className="text-[12px] font-medium text-[var(--text)]">
                    {ch.name}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono-num text-[12px] text-[var(--text3)]">
                    {ch.chats} chats
                  </span>
                  <span className="font-mono-num text-[13px] font-medium text-[var(--green)]">
                    {fmt(ch.cash)}
                  </span>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg4)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(pct, 1)}%`,
                    backgroundColor: ch.color,
                    opacity: 0.8,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {totalCash === 0 && (
        <div className="py-6 text-center text-[13px] text-[var(--text3)]">
          Sin datos este mes. Importa contenido o agrega entradas manualmente.
        </div>
      )}
    </div>
  )
}
