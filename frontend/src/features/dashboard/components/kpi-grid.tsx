import type { DashboardData } from '../types/dashboard'
import { KpiCard } from './kpi-card'
import { ChannelBreakdownCard } from './channel-breakdown'

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR')
}

function trendCalc(current: number, previous: number): { value: string; direction: 'up' | 'down' | 'neutral' } {
  if (previous === 0 && current === 0) return { value: '—', direction: 'neutral' }
  if (previous === 0) return { value: '+100%', direction: 'up' }
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) < 1) return { value: '0%', direction: 'neutral' }
  return {
    value: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`,
    direction: pct > 0 ? 'up' : 'down',
  }
}

type KpiGridProps = {
  data: DashboardData
}

export function KpiGrid({ data }: KpiGridProps) {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Cash Total"
          value={fmt(data.cashTotal)}
          accent
          trend={trendCalc(data.cashTotal, data.prevMonth.cashTotal)}
        />
        <KpiCard
          label="Chats Total"
          value={data.chatsTotal.toLocaleString()}
          trend={trendCalc(data.chatsTotal, data.prevMonth.chatsTotal)}
        />
        <KpiCard
          label="Piezas"
          value={data.piezas.toString()}
          trend={trendCalc(data.piezas, data.prevMonth.piezas)}
        />
        <KpiCard
          label="Cash por chat"
          value={fmt(data.cpc)}
          trend={trendCalc(data.cpc, data.prevMonth.cpc)}
        />
      </div>

      {/* Channel Breakdown */}
      <ChannelBreakdownCard channels={data.channels} />
    </div>
  )
}
