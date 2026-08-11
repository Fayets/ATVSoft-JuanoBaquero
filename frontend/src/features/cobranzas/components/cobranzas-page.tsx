'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { formatCash } from '@/shared/lib/format-utils'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { CobranzaLead, debeRestante } from '../types'

export function CobranzasPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [items, setItems] = useState<CobranzaLead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchItems = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)
    try {
      const res = await apiFetch('/cobranzas')
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar: ${detail}`)
        setItems([])
        return
      }
      setItems((raw as { deudores?: CobranzaLead[] }).deudores ?? [])
    } catch (e) {
      toast(`Error al cargar: ${e instanceof Error ? e.message : 'desconocido'}`)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, toast])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const filtered = useMemo(() => {
    const withDebt = items.filter((d) => {
      const saldo = debeRestante(d)
      return saldo != null && saldo > 0
    })
    const q = search.trim().toLowerCase()
    if (!q) return withDebt
    return withDebt.filter((d) => {
      const hay = [d.nombre, d.ig, d.telefono, d.email, d.closer, d.programa_ofrecido, d.status]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [items, search])

  const totals = useMemo(() => {
    let debe = 0
    let hist = 0
    for (const d of filtered) {
      debe += debeRestante(d) ?? 0
      hist += Number(d.total_pagado_historial) || 0
    }
    return { debe, hist, count: filtered.length }
  }, [filtered])

  if (!ready) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar métricas */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12px] text-[var(--text3)]">
          Debe = deuda de Leads menos cuotas cargadas acá
        </p>
        <div className="flex items-center gap-5 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
              Deudores
            </span>
            <span className="font-mono-num font-semibold">{totals.count}</span>
            {filtered.length !== items.length && (
              <span className="font-mono-num text-[10px] text-[var(--text3)]">/ {items.length}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
              Debe
            </span>
            <span className="font-mono-num font-semibold text-[var(--amber)]">
              {formatCash(totals.debe)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
              Historial
            </span>
            <span className="font-mono-num font-semibold text-[var(--green)]">
              {formatCash(totals.hist)}
            </span>
          </div>
        </div>
      </div>

      {/* Toolbar búsqueda */}
      <div className="mb-3 flex items-center justify-end gap-3">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text3)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--text)] outline-none transition-colors focus:border-[var(--text3)]"
          />
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg3)]">
                {[
                  { label: 'Lead', align: 'left' },
                  { label: 'Programa', align: 'left' },
                  { label: 'Closer', align: 'left' },
                  { label: 'Debe', align: 'right' },
                  { label: 'Historial', align: 'right' },
                  { label: 'Pagos', align: 'center' },
                ].map((col) => (
                  <th
                    key={col.label}
                    className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] ${
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-[13px] text-[var(--text3)]">
                    {items.length === 0
                      ? 'No hay leads con deuda (Debe > 0).'
                      : 'Ningún resultado para la búsqueda.'}
                  </td>
                </tr>
              ) : (
                filtered.map((d, i) => (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/cobranzas/${d.id}`)}
                    className={`cursor-pointer border-b border-[var(--border)] transition-colors hover:bg-[rgba(255,255,255,0.03)] ${
                      i % 2 === 1 ? 'bg-[rgba(255,255,255,0.01)]' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="text-[13px] font-medium text-[var(--text)]">
                        {d.nombre || '—'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--text3)]">
                        {d.ig ? `@${d.ig.replace(/^@/, '')}` : d.telefono || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-[var(--text2)]">
                      {d.programa_ofrecido || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-[var(--text2)]">{d.closer || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-mono-num text-[13px] font-semibold text-[var(--amber)]">
                        {formatCash(debeRestante(d) ?? 0)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-mono-num text-[12px] text-[var(--text2)]">
                        {d.total_pagado_historial > 0
                          ? formatCash(d.total_pagado_historial)
                          : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-mono-num text-[12px] text-[var(--text2)]">
                        {d.cantidad_pagos}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
