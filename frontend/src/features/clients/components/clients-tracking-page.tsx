'use client'

import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { fetchClientsTracking } from '../services/clients-service'
import type { CrmClient, CrmClientTrackingGroup } from '../types'

const GROUP_COLORS: Record<string, string> = {
  venta_abierta: 'border-amber-500/40 bg-amber-500/5',
  proxima_vencer: 'border-orange-500/40 bg-orange-500/5',
  vencido: 'border-red-500/40 bg-red-500/5',
  buenas_wins: 'border-emerald-500/40 bg-emerald-500/5',
  recien_iniciado: 'border-sky-500/40 bg-sky-500/5',
  en_curso: 'border-[var(--accent)]/40 bg-[var(--accent-faint)]',
  incompleto: 'border-yellow-500/40 bg-yellow-500/5',
}

function ClientCard({ client }: { client: CrmClient }) {
  return (
    <div className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-[var(--text)]">{client.full_name}</p>
          <p className="text-[12px] text-[var(--text3)]">{client.program_name || 'Sin programa'}</p>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[var(--accent)]">
          {client.progress_percent != null ? `${client.progress_percent}%` : '—'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text2)]">
        <span>{client.program_duration_months} meses</span>
        <span>·</span>
        <span>{client.wins.length} wins</span>
        <span>·</span>
        <span>{client.sale_status === 'cerrado' ? 'Venta cerrada' : 'Venta abierta'}</span>
      </div>
      {client.wins.length > 0 && (
        <p className="mt-2 truncate text-[11px] text-[var(--text3)]">Win: {client.wins[0]}</p>
      )}
    </div>
  )
}

function GroupSection({ group }: { group: CrmClientTrackingGroup }) {
  const color = GROUP_COLORS[group.key] ?? 'border-[var(--border)] bg-[var(--bg2)]'
  return (
    <section className={`rounded-xl border p-4 ${color}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">{group.label}</h2>
          <p className="text-[12px] text-[var(--text3)]">{group.description}</p>
        </div>
        <span className="rounded-full bg-[var(--bg4)] px-2 py-0.5 font-mono text-[11px] text-[var(--text2)]">
          {group.clients.length}
        </span>
      </div>
      {group.clients.length === 0 ? (
        <p className="text-[12px] text-[var(--text3)]">Ningún cliente en esta categoría.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {group.clients.map((c) => (
            <ClientCard key={`${group.key}-${c.id}`} client={c} />
          ))}
        </div>
      )}
    </section>
  )
}

export function ClientsTrackingPage() {
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [groups, setGroups] = useState<CrmClientTrackingGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)
    const result = await fetchClientsTracking()
    if (result.error) toast(result.error)
    setGroups(result.data?.groups ?? [])
    setTotal(result.data?.total_clients ?? 0)
    setLoading(false)
  }, [ready, userId, toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--text)]">Trackeo de clientes</h1>
        <p className="mt-1 text-sm text-[var(--text3)]">
          Clasificación automática según avance del programa, wins y estado de venta.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Total clientes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
            {loading ? '…' : total}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-4 sm:col-span-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Criterios</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text2)]">
            Fuente: leads Cerrados/Seña. Próxima a vencer ≥80% · Vencido 100% · Buenas wins ≥3 · Incompleto: falta duración o inicio.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--text3)]">Cargando clasificación...</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <GroupSection key={group.key} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}
