import { apiFetch } from '@/lib/api'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type LeadRow = Record<string, unknown> & {
  email?: string | null
}

export type LeadsFunnel = {
  chats: number
  conversaciones: number
  agendas: number
  shows: number
  noShows: number
  cierres: number
  ingresos: number       // cash collected (payment)
  facturacion: number    // total revenue billed
  ticketPromedio: number
  closeRate: number
  showUpRate: number
  tasaAgendamiento: number
  cashPorAgenda: number
  cashPorShow: number
  aov: number            // average order value (facturacion / cierres)
}

export type WeekMetrics = {
  agendas: number[]
  conversaciones: number[]
  shows: number[]
  cierres: number[]
  /** Cash por bucket: reportes closer (`ingreso`) + seguimiento + cuotas. El embudo mensual `ingresos` = Pagó + seguimiento + cuotas. */
  ingresos: number[]
  /** Facturación en euros (mismo criterio que `funnel.facturacion` / `leadFacturacionUsd`) por bucket semanal. */
  facturacion: number[]
  noShows: number[]
}

export type CashCollectedComposition = {
  /** PIF / 1ra Cuota / Otro (LeadPayment) + Lead.pago sin historial. */
  pago: number
  /** Fee (LeadPayment) + formularios SeguimientoReport nativos. */
  seguimiento: number
  /** 2da / 3ra Cuota (LeadPayment). */
  cuotas: number
}

export type MonthPaymentEntry = {
  fecha: string
  monto: number
  lead_id?: string
  concepto?: string
}

const PAGO_CONCEPTOS = new Set(['PIF', '1ra Cuota', 'Otro'])
const CUOTAS_CONCEPTOS = new Set(['2da Cuota', '3ra Cuota'])

function cashBucketForConcepto(concepto: string): 'pago' | 'cuotas' | 'seguimiento' {
  const c = concepto.trim()
  if (c === 'Fee') return 'seguimiento'
  if (CUOTAS_CONCEPTOS.has(c)) return 'cuotas'
  if (PAGO_CONCEPTOS.has(c)) return 'pago'
  return 'pago'
}

/** Fuente única: LeadPayment del mes + Lead.pago solo si el lead no tiene historial LeadPayment. */
export function computeCashCollectedComposition(
  leads: LeadRow[],
  paymentEntries: MonthPaymentEntry[],
  leadIdsWithPaymentHistory: ReadonlySet<string>,
  seguimientoReportTotal: number,
): CashCollectedComposition {
  let pago = 0
  let cuotas = 0
  let seguimientoLp = 0

  for (const e of paymentEntries) {
    const monto = Number(e.monto) || 0
    if (monto <= 0) continue
    const bucket = cashBucketForConcepto(String(e.concepto ?? ''))
    if (bucket === 'pago') pago += monto
    else if (bucket === 'cuotas') cuotas += monto
    else seguimientoLp += monto
  }

  for (const l of leads) {
    const lid = String(l.id ?? '')
    if (!lid || leadIdsWithPaymentHistory.has(lid)) continue
    const m = Number(l.payment) || 0
    if (m > 0) pago += m
  }

  return {
    pago,
    cuotas,
    seguimiento: seguimientoReportTotal + seguimientoLp,
  }
}

function addCashToWeekBuckets(
  monto: number,
  iso: string,
  byWeek: WeekMetrics,
  byWeekDay: { [K in keyof WeekMetrics]: number[][] },
) {
  if (monto <= 0) return
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return
  const dayOfMonth = date.getDate()
  const w = Math.min(3, Math.floor((dayOfMonth - 1) / 7))
  const dow = (date.getDay() + 6) % 7
  byWeek.ingresos[w] += monto
  byWeekDay.ingresos[w][dow] += monto
}

export type LeadsAnalytics = LeadsFunnel & {
  chatsStories: number
  chatsReels: number
  conversacionesStories: number
  conversacionesReels: number
  agendasStories: number
  agendasReels: number
  agendasAds: number
  showsOrganico: number
  showsAds: number
  cierresOrganico: number
  cierresAds: number
  programas: { nombre: string; ventas: number; ingresos: number }[]
  byWeek: WeekMetrics
  byWeekDay: { [K in keyof WeekMetrics]: number[][] } // [4 weeks][7 days]
  cashCollectedComposition: CashCollectedComposition
}

export type MemberMetrics = LeadsFunnel & {
  name: string
  leads: LeadRow[]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CORE CALCULATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function leadHasAgenda(l: LeadRow): boolean {
  const ag = l.agendo
  const hasAgendo = ag != null && String(ag).trim() !== ''
  return !!(l.scheduled_at || l.call_at || l.call || hasAgendo)
}

export function leadHasShow(l: LeadRow): boolean {
  const st = String(l.status ?? '').trim().toLowerCase()
  return leadHasAgenda(l) && st !== 'no show'
}

export function leadIsCierre(l: LeadRow): boolean {
  return String(l.status ?? '').trim().toLowerCase() === 'cerrado'
}

function textLooksLikeBioTraffic(s: string): boolean {
  const t = String(s || '').trim().toLowerCase()
  if (!t) return false
  if (t === 'bio') return true
  if (t.includes('información') || t.includes('informacion')) return true
  if (/\binfo\b/.test(t)) return true
  if ((t.includes('link') || t.includes('enlace')) && (t.includes('bio') || t.includes('biografía') || t.includes('perfil'))) return true
  if (t.includes('link en bio') || t.includes('link del perfil') || t.includes('desde perfil')) return true
  return false
}

export type LeadChatSource = 'Historias' | 'Reels' | 'Perfil' | 'YouTube' | 'Otros'

export function classifyLeadChatSource(l: LeadRow): LeadChatSource {
  const url = String(l.content_url || '').toLowerCase()
  if (url.includes('/reel/') || url.includes('instagram.com/reel')) return 'Reels'
  const candidates = [
    l.agenda_point,
    l.entry_funnel,
    l.keyword,
    l.origin,
  ].map(v => String(v || '').trim().toLowerCase())
  for (const s of candidates) {
    if (!s) continue
    if (s.startsWith('story:') || s.includes('historia') || /\bstor(y|ies)\b/.test(s)) return 'Historias'
    if (s.includes('reel') || /^\d+$/.test(s)) return 'Reels'
    if (textLooksLikeBioTraffic(s) || s === 'perfil') return 'Perfil'
    if (s === 'youtube' || s.startsWith('youtube:')) return 'YouTube'
  }
  const origin = String(l.origin || '').trim().toLowerCase()
  if (origin === 'youtube') return 'YouTube'
  return 'Otros'
}

export type FunnelLeadStep = 'CHATS' | 'CONVERSACIONES' | 'AGENDAS' | 'SHOWS' | 'CIERRES'

export function filterLeadsForFunnelStep(leads: LeadRow[], step: FunnelLeadStep): LeadRow[] {
  switch (step) {
    case 'CHATS':
    case 'CONVERSACIONES':
      return leads
    case 'AGENDAS':
      return leads.filter(leadHasAgenda)
    case 'SHOWS':
      return leads.filter(leadHasShow)
    case 'CIERRES':
      return leads.filter(leadIsCierre)
    default:
      return leads
  }
}

export function sortLeadsForFunnelStep(leads: LeadRow[], step: FunnelLeadStep): LeadRow[] {
  const ts = (l: LeadRow, keys: string[]) => {
    for (const k of keys) {
      const n = Date.parse(String(l[k] ?? ''))
      if (!Number.isNaN(n)) return n
    }
    return 0
  }
  const keysByStep: Record<FunnelLeadStep, string[]> = {
    CHATS: ['fecha_bot', 'date', 'agendo'],
    CONVERSACIONES: ['fecha_bot', 'date', 'agendo'],
    AGENDAS: ['agendo', 'scheduled_at', 'call_at', 'call'],
    SHOWS: ['call', 'scheduled_at', 'call_at', 'agendo'],
    CIERRES: ['agendo', 'call', 'scheduled_at', 'date'],
  }
  const keys = keysByStep[step]
  return [...leads].sort((a, b) => ts(b, keys) - ts(a, keys))
}

export function calcFunnel(leads: LeadRow[], conversaciones?: number): LeadsFunnel {
  const agendas = leads.filter(leadHasAgenda).length
  const noShows = leads.filter(l => String(l.status ?? '').trim().toLowerCase() === 'no show').length
  const shows = leads.filter(leadHasShow).length
  const cierres = leads.filter(leadIsCierre).length
  const ingresos = leads.reduce((s, l) => s + (Number(l.payment) || 0), 0)
  const facturacion = leads.reduce((s, l) => s + (Number(l.revenue) || 0), 0)
  const conv = conversaciones ?? leads.length

  return {
    chats: 0,
    conversaciones: conv,
    agendas, shows, noShows, cierres, ingresos, facturacion,
    ticketPromedio: cierres > 0 ? ingresos / cierres : 0,
    closeRate: shows > 0 ? (cierres / shows) * 100 : 0,
    showUpRate: agendas > 0 ? ((agendas - noShows) / agendas) * 100 : 0,
    tasaAgendamiento: conv > 0 ? (agendas / conv) * 100 : 0,
    cashPorAgenda: agendas > 0 ? ingresos / agendas : 0,
    cashPorShow: shows > 0 ? ingresos / shows : 0,
    aov: cierres > 0 ? facturacion / cierres : 0,
  }
}

export function distribute(total: number, n: number): number[] {
  const arr: number[] = []
  const base = Math.floor(total / n)
  const rem = total - base * n
  for (let i = 0; i < n; i++) arr.push(base + (i < rem ? 1 : 0))
  return arr
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FULL ANALYTICS (for sales-dashboard)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Igual que status: ignorar mayúsculas y acentos al cruzar programa del lead con el catálogo. */
function normProgramLookupKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

function resolveProgramPrice(programPrices: Record<string, number>, progRaw: unknown): number | null {
  const raw = String(progRaw ?? '').trim()
  if (!raw) return null
  if (Object.prototype.hasOwnProperty.call(programPrices, raw)) {
    const v = programPrices[raw]
    return v !== undefined ? v : null
  }
  const nk = normProgramLookupKey(raw)
  for (const [k, v] of Object.entries(programPrices)) {
    if (normProgramLookupKey(k) === nk) return v
  }
  return null
}

/** ISO `YYYY-MM-DD` para bucket semanal/diario de facturación en leads. */
function leadMetricDateIso(l: LeadRow): string | null {
  const candidates = [l.date, l.scheduled_at, l.call_at, l.agendo]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (!s) continue
    const head = s.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head
  }
  return null
}

export function monthRangeIso(month: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null
  const desde = `${y}-${String(mo).padStart(2, '0')}-01`
  const last = new Date(y, mo, 0).getDate()
  const hasta = `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { desde, hasta }
}

export async function getLeadsAnalytics(month: string): Promise<{ leads: LeadRow[]; analytics: LeadsAnalytics; conversaciones: number }> {
  const leads: LeadRow[] = []
  const setterReports: Record<string, unknown>[] = []
  const closerReports: Record<string, unknown>[] = []
  let programPrices: Record<string, number> = {}

  const range = monthRangeIso(month)
  let seguimientoEntries: { fecha: string; monto: number }[] = []
  let seguimientoTotal = 0
  let paymentEntries: MonthPaymentEntry[] = []
  let leadIdsWithPaymentHistory = new Set<string>()
  let chatsReels = 0
  let chatsStories = 0
  try {
    const leadsReq = apiFetch(`/leads?month=${encodeURIComponent(month)}`)
    const programsReq = apiFetch('/programs')
    const reelsMetricsReq = apiFetch(`/reels/metrics?month=${encodeURIComponent(month)}`)
    const storiesMetricsReq = apiFetch(`/stories/metrics?month=${encodeURIComponent(month)}`)
    const segReq =
      range != null
        ? apiFetch(`/team/seguimiento-reports/month?month=${encodeURIComponent(month)}`)
        : Promise.resolve(new Response('', { status: 400 }))
    const cuotasReq =
      range != null
        ? apiFetch(`/cobranzas/pagos/month?month=${encodeURIComponent(month)}`)
        : Promise.resolve(new Response('', { status: 400 }))
    const reportsReq =
      range != null
        ? apiFetch(
            `/team/reports?desde=${encodeURIComponent(range.desde)}&hasta=${encodeURIComponent(range.hasta)}`,
          )
        : Promise.resolve(new Response('', { status: 400 }))
    const [leadsRes, repRes, progRes, segRes, cuotasRes, reelsMetricsRes, storiesMetricsRes] =
      await Promise.all([
        leadsReq,
        reportsReq,
        programsReq,
        segReq,
        cuotasReq,
        reelsMetricsReq,
        storiesMetricsReq,
      ])
    if (leadsRes.ok) {
      const j = (await leadsRes.json().catch(() => ({}))) as { leads?: LeadRow[] }
      if (Array.isArray(j.leads)) leads.push(...j.leads)
    }
    if (progRes.ok) {
      const pj = (await progRes.json().catch(() => ({}))) as {
        programs?: { name?: string; price_usd?: number }[]
      }
      const next: Record<string, number> = {}
      for (const p of pj.programs || []) {
        const n = String(p?.name ?? '').trim()
        if (n) next[n] = Number(p?.price_usd) || 0
      }
      programPrices = next
    }

    if (segRes.ok) {
      const sj = (await segRes.json().catch(() => ({}))) as {
        total?: unknown
        entries?: unknown
      }
      seguimientoTotal = Number(sj.total) || 0
      if (Array.isArray(sj.entries)) {
        seguimientoEntries = sj.entries
          .map((x) => x as Record<string, unknown>)
          .map((x) => ({
            fecha: String(x.fecha ?? '').slice(0, 10),
            monto: Number(x.monto) || 0,
          }))
          .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.fecha))
      }
    }

    if (cuotasRes.ok) {
      const cj = (await cuotasRes.json().catch(() => ({}))) as {
        total?: unknown
        entries?: unknown
        lead_ids_with_history?: unknown
      }
      if (Array.isArray(cj.lead_ids_with_history)) {
        leadIdsWithPaymentHistory = new Set(
          cj.lead_ids_with_history.map((x) => String(x ?? '').trim()).filter(Boolean),
        )
      }
      if (Array.isArray(cj.entries)) {
        paymentEntries = cj.entries
          .map((x) => x as Record<string, unknown>)
          .map((x) => ({
            fecha: String(x.fecha ?? '').slice(0, 10),
            monto: Number(x.monto) || 0,
            lead_id: String(x.lead_id ?? ''),
            concepto: String(x.concepto ?? ''),
          }))
          .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.fecha))
      }
    }

    if (repRes.ok && range != null) {
      const j = (await repRes.json().catch(() => ({}))) as { reports?: unknown[] }
      if (Array.isArray(j.reports)) {
        for (const raw of j.reports) {
          const r = raw as Record<string, unknown>
          const fecha = String(r.fecha ?? '').slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue
          if (r.kind === 'setter') {
            setterReports.push({
              date: fecha,
              conversaciones: Number(r.conversaciones) || 0,
              agendas: Number(r.agendas) || 0,
              conversaciones_stories: Number(r.conversaciones_stories) || 0,
              conversaciones_reels: Number(r.conversaciones_reels) || 0,
              agendas_stories: Number(r.agendas_stories) || 0,
              agendas_reels: Number(r.agendas_reels) || 0,
              agendas_ads: Number(r.agendas_ads) || 0,
              shows: 0,
              cierres: 0,
              ingreso: 0,
            })
          } else if (r.kind === 'closer') {
            closerReports.push({
              date: fecha,
              conversaciones: 0,
              agendas: 0,
              shows: Number(r.shows) || 0,
              cierres: Number(r.cierres) || 0,
              shows_organico: Number(r.shows_organico) || 0,
              shows_ads: Number(r.shows_ads) || 0,
              cierres_organico: Number(r.cierres_organico) || 0,
              cierres_ads: Number(r.cierres_ads) || 0,
              reservas: Number(r.reservas) || 0,
              ingreso: Number(r.ingreso) || 0,
            })
          }
        }
      }
    }

    if (reelsMetricsRes.ok) {
      const reelsMetricsData = (await reelsMetricsRes.json().catch(() => ({}))) as {
        chats_del_mes?: number
      }
      chatsReels = reelsMetricsData?.chats_del_mes ?? 0
    }
    if (storiesMetricsRes.ok) {
      const storiesMetricsData = (await storiesMetricsRes.json().catch(() => ({}))) as {
        chats_del_mes?: number
      }
      chatsStories = storiesMetricsData?.chats_del_mes ?? 0
    }
  } catch {
    /* red / sin sesión: seguimos con arrays vacíos */
  }

  const chats = chatsReels + chatsStories

  // Embudo y series: reportes diarios setter + closer (ventas); programas y revenue desde leads
  const sumField = (reports: Record<string, unknown>[], field: string) =>
    reports.reduce((s, r) => s + (Number(r[field]) || 0), 0)

  const conversaciones = sumField(setterReports, 'conversaciones')
  const agendas = sumField(setterReports, 'agendas')
  const shows = sumField(closerReports, 'shows')
  const cierres = sumField(closerReports, 'cierres')
  const conversacionesStories = sumField(setterReports, 'conversaciones_stories')
  const conversacionesReels = sumField(setterReports, 'conversaciones_reels')
  const agendasStories = sumField(setterReports, 'agendas_stories')
  const agendasReels = sumField(setterReports, 'agendas_reels')
  const agendasAds = sumField(setterReports, 'agendas_ads')
  const showsOrganico = sumField(closerReports, 'shows_organico')
  const showsAds = sumField(closerReports, 'shows_ads')
  const cierresOrganico = sumField(closerReports, 'cierres_organico')
  const cierresAds = sumField(closerReports, 'cierres_ads')
  /** Ingreso declarado en reportes closer (solo fallback facturación si no hay programa en leads). */
  const ingresosReports = sumField(closerReports, 'ingreso')
  const cashCollectedComposition = computeCashCollectedComposition(
    leads,
    paymentEntries,
    leadIdsWithPaymentHistory,
    seguimientoTotal,
  )
  const cashCollected =
    cashCollectedComposition.pago +
    cashCollectedComposition.cuotas +
    cashCollectedComposition.seguimiento
  const noShows = Math.max(0, agendas - shows)

  const catalogDefined = Object.keys(programPrices).length > 0
  const leadsWithProgramOfferedCount = leads.filter(
    (l) => String(l.program_offered ?? '').trim() !== '',
  ).length

  /**
   * Facturación por programa: solo «Prog. comprado» (`program_offered` / `programa_ofrecido` en BD).
   * `programada_ofrecido_llamada` no interviene aquí.
   */
  const leadFacturacionUsd = (l: LeadRow): number => {
    const prog = String(l.program_offered ?? '').trim()
    const apiPriceRaw = l.program_price_usd
    const hasApiPrice = apiPriceRaw != null && Number.isFinite(Number(apiPriceRaw))

    if (!prog) {
      if (!catalogDefined && !hasApiPrice) {
        return Number(l.revenue) || Number(l.payment) || 0
      }
      return 0
    }

    if (hasApiPrice) return Number(apiPriceRaw)
    const priced = resolveProgramPrice(programPrices, l.program_offered)
    if (priced != null) return priced
    return Number(l.revenue) || 0
  }

  const revenueLeads = leads.reduce((s, l) => s + leadFacturacionUsd(l), 0)
  const facturacion = revenueLeads > 0 ? revenueLeads : ingresosReports

  const billingUsesPrograms =
    catalogDefined ||
    leads.some(
      (x) =>
        String(x.program_offered ?? '').trim() !== '' &&
        x.program_price_usd != null &&
        Number.isFinite(Number(x.program_price_usd)),
    )

  const avgTicketFromBilling =
    (catalogDefined || billingUsesPrograms) && leadsWithProgramOfferedCount > 0
      ? facturacion / leadsWithProgramOfferedCount
      : null

  const funnel: LeadsFunnel = {
    chats,
    conversaciones,
    agendas,
    shows,
    noShows,
    cierres,
    ingresos: cashCollected,
    facturacion,
    ticketPromedio:
      avgTicketFromBilling != null
        ? avgTicketFromBilling
        : cierres > 0
          ? cashCollected / cierres
          : 0,
    closeRate: shows > 0 ? (cierres / shows) * 100 : 0,
    showUpRate: agendas > 0 ? (shows / agendas) * 100 : 0,
    tasaAgendamiento: conversaciones > 0 ? (agendas / conversaciones) * 100 : 0,
    cashPorAgenda: agendas > 0 ? cashCollected / agendas : 0,
    cashPorShow: shows > 0 ? cashCollected / shows : 0,
    aov:
      avgTicketFromBilling != null
        ? avgTicketFromBilling
        : cierres > 0
          ? facturacion / cierres
          : 0,
  }

  // Programs breakdown (solo programa comprado / facturación; no `programada_ofrecido_llamada`)
  const progMap: Record<string, { ventas: number; ingresos: number }> = {}
  leads.forEach(l => {
    const p = String(l.program_offered ?? '').trim()
    if (!p) return
    progMap[p] = progMap[p] || { ventas: 0, ingresos: 0 }
    progMap[p].ventas++
    if (catalogDefined) {
      progMap[p].ingresos += leadFacturacionUsd(l)
    } else {
      progMap[p].ingresos += Number(l.payment) || 0
    }
  })
  const programas = Object.entries(progMap)
    .map(([nombre, v]) => ({ nombre, ...v }))
    .sort((a, b) => b.ingresos - a.ingresos)

  // Weekly + daily distributions from daily_reports by actual date
  const allReports = [...setterReports, ...closerReports]
  const byWeek: WeekMetrics = {
    agendas: [0, 0, 0, 0],
    conversaciones: [0, 0, 0, 0],
    shows: [0, 0, 0, 0],
    cierres: [0, 0, 0, 0],
    ingresos: [0, 0, 0, 0],
    facturacion: [0, 0, 0, 0],
    noShows: [0, 0, 0, 0],
  }
  const z7 = () => [0, 0, 0, 0, 0, 0, 0]
  const byWeekDay: LeadsAnalytics['byWeekDay'] = {
    conversaciones: [z7(), z7(), z7(), z7()],
    agendas: [z7(), z7(), z7(), z7()],
    shows: [z7(), z7(), z7(), z7()],
    cierres: [z7(), z7(), z7(), z7()],
    ingresos: [z7(), z7(), z7(), z7()],
    facturacion: [z7(), z7(), z7(), z7()],
    noShows: [z7(), z7(), z7(), z7()],
  }

  allReports.forEach((r: Record<string, unknown>) => {
    const date = new Date((r.date as string) + 'T12:00:00')
    if (Number.isNaN(date.getTime())) return
    const dayOfMonth = date.getDate()
    const w = Math.min(3, Math.floor((dayOfMonth - 1) / 7))
    const dow = (date.getDay() + 6) % 7 // Mon=0 Sun=6

    const conv = Number(r.conversaciones) || 0
    const ag = Number(r.agendas) || 0
    const sh = Number(r.shows) || 0
    const ci = Number(r.cierres) || 0
    const ing = Number(r.ingreso) || 0

    byWeek.conversaciones[w] += conv; byWeekDay.conversaciones[w][dow] += conv
    byWeek.agendas[w] += ag;         byWeekDay.agendas[w][dow] += ag
    byWeek.shows[w] += sh;           byWeekDay.shows[w][dow] += sh
    byWeek.cierres[w] += ci;         byWeekDay.cierres[w][dow] += ci
    byWeek.ingresos[w] += ing;       byWeekDay.ingresos[w][dow] += ing
  })

  seguimientoEntries.forEach((e) => {
    addCashToWeekBuckets(Number(e.monto) || 0, e.fecha, byWeek, byWeekDay)
  })

  paymentEntries.forEach((e) => {
    addCashToWeekBuckets(Number(e.monto) || 0, e.fecha, byWeek, byWeekDay)
  })

  leads.forEach((l) => {
    const lid = String(l.id ?? '')
    if (!lid || leadIdsWithPaymentHistory.has(lid)) return
    const m = Number(l.payment) || 0
    if (m <= 0) return
    const iso = leadMetricDateIso(l)
    if (!iso) return
    addCashToWeekBuckets(m, iso, byWeek, byWeekDay)
  })

  // Facturación por día/semana: mismo `leadFacturacionUsd` que el embudo mensual (fecha vía `leadMetricDateIso`)
  leads.forEach((l) => {
    const bill = leadFacturacionUsd(l)
    if (bill <= 0) return
    const iso = leadMetricDateIso(l)
    if (!iso) return
    const date = new Date(`${iso}T12:00:00`)
    if (Number.isNaN(date.getTime())) return
    const dayOfMonth = date.getDate()
    const w = Math.min(3, Math.floor((dayOfMonth - 1) / 7))
    const dow = (date.getDay() + 6) % 7
    byWeek.facturacion[w] += bill
    byWeekDay.facturacion[w][dow] += bill
  })

  // Compute noShows per week and per day
  for (let w = 0; w < 4; w++) {
    byWeek.noShows[w] = Math.max(0, byWeek.agendas[w] - byWeek.shows[w])
    for (let d = 0; d < 7; d++) {
      byWeekDay.noShows[w][d] = Math.max(0, byWeekDay.agendas[w][d] - byWeekDay.shows[w][d])
    }
  }

  return {
    leads,
    conversaciones,
    analytics: {
      ...funnel,
      chatsStories,
      chatsReels,
      conversacionesStories,
      conversacionesReels,
      agendasStories,
      agendasReels,
      agendasAds,
      showsOrganico,
      showsAds,
      cierresOrganico,
      cierresAds,
      programas,
      byWeek,
      byWeekDay,
      cashCollectedComposition,
    },
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEMBER METRICS (for setter/closer dashboards)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getMemberMetrics(
  allLeads: LeadRow[],
  memberName: string,
  field: 'setter' | 'closer'
): MemberMetrics {
  const memberLeads = allLeads.filter(l => l[field] === memberName)
  const funnel = calcFunnel(memberLeads)
  return { ...funnel, name: memberName, leads: memberLeads }
}
