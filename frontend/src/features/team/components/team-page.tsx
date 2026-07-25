'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'
import { getLeadsAnalytics } from '@/features/leads/services/leads-analytics'

type ApiTeamMember = { id: number; nombre: string; rol: string; activo: boolean }

type DashboardSetter = {
  member_id: number
  nombre: string
  conversaciones: number
  agendas: number
  links_enviados: number
  generado: number
  comision: number
}

type DashboardCloser = {
  member_id: number
  nombre: string
  llamadas_agendadas: number
  shows: number
  cierres: number
  calificados: number
  descalificados: number
  ingreso: number
  comision: number
}

type TeamDashboardResponse = {
  month: string
  cash_total: number
  comisiones: number
  commission_pct: number
  total_conversaciones: number
  setters: DashboardSetter[]
  closers: DashboardCloser[]
}

function errMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x))).join(', ')
  }
  return 'Error en la solicitud'
}

export function TeamPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [setters, setSetters] = useState<ApiTeamMember[]>([])
  const [closers, setClosers] = useState<ApiTeamMember[]>([])
  const [dashboard, setDashboard] = useState<TeamDashboardResponse | null>(null)
  /** Misma fuente que Dashboard de Ventas: reportes closer (`ingreso`) y seguimiento (`monto`). */
  const [ventasKpis, setVentasKpis] = useState<{ facturacion: number; ingresos: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setSetters([])
      setClosers([])
      setDashboard(null)
      setVentasKpis(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [mRes, dRes, analyticsBundle] = await Promise.all([
        apiFetch('/team/members'),
        apiFetch(`/team/dashboard?month=${encodeURIComponent(month)}`),
        getLeadsAnalytics(month).catch(() => null),
      ])
      if (!mRes.ok) {
        toast(errMessage(await mRes.json().catch(() => ({}))))
        setSetters([])
        setClosers([])
        setDashboard(null)
        setVentasKpis(null)
        return
      }
      if (!dRes.ok) {
        toast(errMessage(await dRes.json().catch(() => ({}))))
        setDashboard(null)
      } else {
        setDashboard((await dRes.json()) as TeamDashboardResponse)
      }
      if (analyticsBundle) {
        const { analytics } = analyticsBundle
        setVentasKpis({ facturacion: analytics.facturacion, ingresos: analytics.ingresos })
      } else {
        setVentasKpis(null)
      }
      const mJson = (await mRes.json()) as { setters: ApiTeamMember[]; closers: ApiTeamMember[] }
      setSetters(mJson.setters ?? [])
      setClosers(mJson.closers ?? [])
    } catch {
      toast('No se pudo cargar el equipo.')
      setSetters([])
      setClosers([])
      setDashboard(null)
      setVentasKpis(null)
    } finally {
      setLoading(false)
    }
  }, [month, ready, toast, userId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    const refresh = () => {
      void fetchData()
    }
    window.addEventListener('atvmkt-team-reports-changed', refresh)
    window.addEventListener('offered-programs-updated', refresh)
    return () => {
      window.removeEventListener('atvmkt-team-reports-changed', refresh)
      window.removeEventListener('offered-programs-updated', refresh)
    }
  }, [fetchData])

  const handleRemove = async (id: number) => {
    const res = await apiFetch(`/team/members/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast(errMessage(await res.json().catch(() => ({}))))
      return
    }
    toast('Miembro eliminado')
    void fetchData()
  }

  const setterStats = (id: number): DashboardSetter | undefined =>
    dashboard?.setters.find((s) => s.member_id === id)

  const closerStats = (id: number): DashboardCloser | undefined =>
    dashboard?.closers.find((c) => c.member_id === id)

  const cashCollectedFallback = dashboard?.cash_total ?? 0
  const facturacionFallback =
    dashboard?.closers.reduce((acc, c) => acc + c.ingreso, 0) ?? 0
  const cashCollected = ventasKpis?.ingresos ?? cashCollectedFallback
  const facturacion = ventasKpis?.facturacion ?? facturacionFallback

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  if (!userId) {
    return <div className="py-12 text-center text-[var(--text3)]">Iniciá sesión para ver el equipo.</div>
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Dashboard de Equipo</h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="glass-card glass-card--performant border-l-2 border-l-[var(--green)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Cash Collected</div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-[var(--green)]">{formatCash(cashCollected)}</div>
        </div>
        <div className="glass-card glass-card--performant border-l-2 border-l-[var(--amber)] p-5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Facturación</div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-[var(--amber)]">{formatCash(facturacion)}</div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6">
        <div>
          <h3 className="mb-4 border-b border-[var(--border)] pb-3 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Setters</h3>
          {setters.length === 0 ? (
            <p className="text-[13px] text-[var(--text3)]">Sin setters</p>
          ) : (
            <div className="space-y-3">
              {setters.map((s) => {
                const st = setterStats(s.id)
                const conversaciones = st?.conversaciones ?? 0
                const agendados = st?.agendas ?? 0
                const linksEnv = st?.links_enviados ?? 0
                const tasaAgend = conversaciones > 0 ? (agendados / conversaciones) * 100 : 0
                const rend = agendados >= 4 ? 'Excelente' : agendados >= 2 ? 'En meta' : 'Regular'
                const rendColor = rend === 'Excelente' ? 'var(--green)' : rend === 'En meta' ? 'var(--amber)' : 'var(--red)'
                return (
                  <div key={s.id} className="glass-card glass-card--performant p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: 'rgba(212,168,67,0.15)', color: '#d4a843' }}>
                          Setter
                        </span>
                        <span className="text-[14px] font-semibold">{s.nombre}</span>
                      </div>
                      <button type="button" onClick={() => void handleRemove(s.id)} className="text-sm text-[var(--text3)] hover:text-[var(--red)]">
                        ×
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[9px] uppercase text-[var(--text3)]">Agendas mes</div>
                        <div className="font-mono-num text-lg font-semibold">{agendados}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase text-[var(--text3)]">Tasa agend.</div>
                        <div className="font-mono-num text-lg font-semibold">{tasaAgend.toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase text-[var(--text3)]">Rendimiento</div>
                        <div className="text-[13px] font-semibold" style={{ color: rendColor }}>
                          {rend}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-[var(--text3)]">
                      <span>
                        Conv. <span className="font-mono-num text-[var(--text)]">{conversaciones}</span>
                      </span>
                      <span>
                        Links <span className="font-mono-num text-[var(--text)]">{linksEnv}</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-4 border-b border-[var(--border)] pb-3 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Closers</h3>
          {closers.length === 0 ? (
            <p className="text-[13px] text-[var(--text3)]">Sin closers</p>
          ) : (
            <div className="space-y-3">
              {closers.map((c) => {
                const st = closerStats(c.id)
                const calls = st?.llamadas_agendadas ?? 0
                const shows = st?.shows ?? 0
                const cierres = st?.cierres ?? 0
                const ingreso = st?.ingreso ?? 0
                const calif = st?.calificados ?? 0
                const descalif = st?.descalificados ?? 0
                const closeRate = shows > 0 ? (cierres / shows) * 100 : 0
                const rend = closeRate >= 50 ? 'Excelente' : closeRate >= 25 ? 'En meta' : 'Regular'
                const rendColor = rend === 'Excelente' ? 'var(--green)' : rend === 'En meta' ? 'var(--amber)' : 'var(--red)'
                return (
                  <div key={c.id} className="glass-card glass-card--performant p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                          Closer
                        </span>
                        <span className="text-[14px] font-semibold">{c.nombre}</span>
                      </div>
                      <button type="button" onClick={() => void handleRemove(c.id)} className="text-sm text-[var(--text3)] hover:text-[var(--red)]">
                        ×
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <div className="text-[9px] uppercase text-[var(--text3)]">Calls</div>
                        <div className="font-mono-num text-lg font-semibold">{calls}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase text-[var(--text3)]">Cierres</div>
                        <div className="font-mono-num text-lg font-semibold text-[var(--green)]">{cierres}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase text-[var(--text3)]">Close %</div>
                        <div className="font-mono-num text-lg font-semibold">{closeRate.toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase text-[var(--text3)]">Rendimiento</div>
                        <div className="text-[13px] font-semibold" style={{ color: rendColor }}>
                          {rend}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-[var(--text3)]">
                      <span>
                        Ingreso{' '}
                        <span className="font-mono-num font-medium text-[var(--green)]">{formatCash(ingreso)}</span>
                      </span>
                      <span>
                        Shows <span className="font-mono-num text-[var(--text)]">{shows}</span>
                      </span>
                      <span>
                        Calif. <span className="font-mono-num text-[var(--text)]">{calif}</span> · Desc.{' '}
                        <span className="font-mono-num text-[var(--text)]">{descalif}</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
