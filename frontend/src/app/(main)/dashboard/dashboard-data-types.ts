import type { LeadRow } from '@/features/leads/services/leads-analytics'

export type DashCall = {
  id: string
  date: string
  name: string
  revenue: number
  payment: number
  program: string
  closer: string
  setter: string
  status: string
  callLink: string
  closerReport: string
  igHandle: string
  phone: string
  entryChannel: string
  notes: string
}

export type DashContentRow = {
  content_type: string
  cash: number
  chats: number
  published_at: string
}

export type DashBioRow = { cash: number; chats: number }

export type DashData = {
  cash: number
  prevCash: number
  prevCashAtDay: number
  /** Total chats por canal (reels + historias + bio + youtube + otros); independiente de SetterReport. */
  chats: number
  prevChats: number
  reelsChats: number
  historiasChats: number
  bioChats: number
  youtubeChats: number
  otrosChats: number
  /** Mes completo vía /reels/metrics y /stories/metrics (misma fuente que embudo Ventas). */
  reelsChatsMetrics: number
  storiesChatsMetrics: number
  prevReelsChatsMetrics: number
  prevStoriesChatsMetrics: number
  prevBioChats: number
  prevYoutubeChats: number
  prevOtrosChats: number
  igCash: number
  ytCash: number
  refCash: number
  defCash: number
  bioCash: number
  historiasCash: number
  reelsCash: number
  dailyCash: number[]
  prevDailyCash: number[]
  rawDailyCash: number[]
  rawPrevDailyCash: number[]
  dailyChats: number[]
  dailyAgendas: number[]
  dailyCierres: number[]
  rawLeads: LeadRow[]
  /** Leads del mes con y sin agendo (conteo chats YouTube / Otros). */
  rawAllLeads: LeadRow[]
  rawContent: DashContentRow[]
  rawBio: DashBioRow[]
  calls: DashCall[]
  programCounts: { program: string; count: number }[]
  ventas: {
    cierres: number
    cashCollected: number
    ticketPromedio: number
    closeRate: number
    agendas: number
    leads: number
  }
}
