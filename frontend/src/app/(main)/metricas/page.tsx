'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatK } from '@/shared/lib/format-utils'

export default function MetricasPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [metrics, setMetrics] = useState({ account_views: 0, followers: 0 })
  const [loading, setLoading] = useState(true)

  const fetchMetrics = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    setMetrics({ account_views: 0, followers: 0 })
    setLoading(false)
  }, [month, ready])

  useEffect(() => { fetchMetrics() }, [fetchMetrics])

  const saveMetric = async (field: string, value: number) => {
    if (!userId) return
    const updated = { ...metrics, [field]: value }
    setMetrics(updated)
    toast('Cambio local. Persistencia en backend pendiente.')
  }

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Metricas de Cuenta</h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">Views totales IG</div>
          <div className="font-mono-num mb-2 text-3xl font-bold">{formatK(metrics.account_views)}</div>
          <input
            type="number" value={metrics.account_views}
            onChange={(e) => saveMetric('account_views', Number(e.target.value))}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 font-mono-num text-[14px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
          <p className="mt-2 text-[11px] text-[var(--text3)]">Ingresa el total de views de tu cuenta de Instagram desde Metricool o Insights</p>
        </div>

        <div className="glass-card p-6">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">Followers</div>
          <div className="font-mono-num mb-2 text-3xl font-bold">{formatK(metrics.followers)}</div>
          <input
            type="number" value={metrics.followers}
            onChange={(e) => saveMetric('followers', Number(e.target.value))}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 font-mono-num text-[14px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
          <p className="mt-2 text-[11px] text-[var(--text3)]">Cantidad actual de seguidores en Instagram</p>
        </div>
      </div>
    </div>
  )
}
