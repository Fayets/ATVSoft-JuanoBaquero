export type DashboardKPI = {
  label: string
  value: string
  subtitle?: string
  trend?: {
    value: string
    direction: 'up' | 'down' | 'neutral'
  }
  color?: 'default' | 'green' | 'amber' | 'red'
}

export type ChannelBreakdown = {
  name: string
  chats: number
  cash: number
  cpc: number
  color: string
}

export type DashboardData = {
  cashTotal: number
  chatsTotal: number
  piezas: number
  cpc: number
  channels: ChannelBreakdown[]
  prevMonth: {
    cashTotal: number
    chatsTotal: number
    piezas: number
    cpc: number
  }
}
