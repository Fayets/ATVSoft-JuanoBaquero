import type { DashboardData } from '../types/dashboard'

function getPrevMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(year, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function emptyMonthData(): Omit<DashboardData, 'prevMonth'> {
  return {
    cashTotal: 0,
    chatsTotal: 0,
    piezas: 0,
    cpc: 0,
    channels: [
      { name: 'Reels', chats: 0, cash: 0, cpc: 0, color: '#EF4444' },
      { name: 'Historias', chats: 0, cash: 0, cpc: 0, color: '#F59E0B' },
      { name: 'BIO', chats: 0, cash: 0, cpc: 0, color: '#A855F7' },
      { name: 'YouTube', chats: 0, cash: 0, cpc: 0, color: '#3B82F6' },
      { name: 'Referidos', chats: 0, cash: 0, cpc: 0, color: '#22C55E' },
    ],
  }
}

/** Datos agregados del dashboard: conectar con FastAPI cuando exista el endpoint. */
export async function getDashboardData(): Promise<DashboardData> {
  const month = getCurrentMonth()
  const prev = getPrevMonth(month)
  const current = emptyMonthData()
  const previous = emptyMonthData()

  return {
    ...current,
    prevMonth: {
      cashTotal: previous.cashTotal,
      chatsTotal: previous.chatsTotal,
      piezas: previous.piezas,
      cpc: previous.cpc,
    },
  }
}
