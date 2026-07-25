'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import {
  bulkDeleteCallReports,
  bulkDownloadCallReports,
  getCallReports,
} from '../services/call-reports-service'
import type { CallReport } from '../types'
import { CallReportsTable } from './CallReportsTable'
import { callReportDateKey } from './CallReportDetail'

const POLL_MS = 5000

function hasPending(items: CallReport[]): boolean {
  return items.some((r) => r.estado === 'pendiente' || r.estado === 'procesando')
}

export function CallReportsPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [items, setItems] = useState<CallReport[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchReports = useCallback(async (silent = false) => {
    if (!ready || !userId) {
      setItems([])
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const rows = await getCallReports()
      setItems(rows)
      setSelectedIds((prev) => {
        const next = new Set<string>()
        const ids = new Set(rows.map((r) => r.id))
        for (const id of prev) {
          if (ids.has(id)) next.add(id)
        }
        return next
      })
    } catch (e) {
      if (!silent) {
        toast(e instanceof Error ? e.message : 'Error al cargar reportes.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [ready, userId, toast])

  useEffect(() => {
    void fetchReports()
  }, [fetchReports])

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!ready || !userId) return undefined
    if (!hasPending(items)) return undefined

    pollRef.current = setInterval(() => {
      void fetchReports(true)
    }, POLL_MS)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [items, ready, userId, fetchReports])

  const dateFilterActive = Boolean(desde || hasta)

  const filteredItems = useMemo(() => {
    let rows = items
    if (desde) {
      rows = rows.filter((r) => {
        const d = callReportDateKey(r.created_at)
        return d && d >= desde
      })
    }
    if (hasta) {
      rows = rows.filter((r) => {
        const d = callReportDateKey(r.created_at)
        return d && d <= hasta
      })
    }
    return rows
  }, [items, desde, hasta])

  const selectedList = useMemo(() => Array.from(selectedIds), [selectedIds])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (filteredItems.length > 0 && filteredItems.every((r) => prev.has(r.id))) {
        return new Set()
      }
      return new Set(filteredItems.map((r) => r.id))
    })
  }, [filteredItems])

  const runBulkDownload = useCallback(async () => {
    if (selectedList.length === 0) return
    setBusy(true)
    try {
      await bulkDownloadCallReports(selectedList)
      toast(`Descarga PDF lista (${selectedList.length}).`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al descargar.')
    } finally {
      setBusy(false)
    }
  }, [selectedList, toast])

  const runBulkDelete = useCallback(async () => {
    if (selectedList.length === 0) return
    const ok = window.confirm(
      selectedList.length === 1
        ? '¿Eliminar el reporte seleccionado?'
        : `¿Eliminar ${selectedList.length} reportes?`,
    )
    if (!ok) return
    setBusy(true)
    try {
      const deleted = await bulkDeleteCallReports(selectedList)
      toast(`Eliminados: ${deleted}.`)
      setSelectedIds(new Set())
      await fetchReports(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al eliminar.')
    } finally {
      setBusy(false)
    }
  }, [selectedList, toast, fetchReports])

  if (!ready) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando sesión…</div>
  }

  if (!userId) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Iniciá sesión para ver los reportes.</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Reporte calls</h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">
            Análisis automático al pegar el link de Fathom en Leads.
          </p>
        </div>
        {selectedList.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[var(--text3)]">{selectedList.length} seleccionados</span>
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)] disabled:opacity-50"
              onClick={() => void runBulkDownload()}
            >
              Descargar PDF
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-1.5 text-[12px] text-[var(--red)] hover:bg-[var(--red)]/20 disabled:opacity-50"
              onClick={() => void runBulkDelete()}
            >
              Eliminar
            </button>
          </div>
        )}
      </div>

      <div className="glass-card mb-4 flex flex-wrap items-end gap-4 p-4 sm:p-5">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        {dateFilterActive ? (
          <>
            <span className="pb-2 text-[12px] text-[var(--text3)]">
              {filteredItems.length} de {items.length} reportes
            </span>
            <button
              type="button"
              onClick={() => {
                setDesde('')
                setHasta('')
              }}
              className="rounded-lg border border-[var(--border2)] px-3 py-2 text-[11px] font-semibold text-[var(--text2)] hover:border-[var(--text3)]"
            >
              Limpiar fechas
            </button>
          </>
        ) : null}
      </div>

      <CallReportsTable
        items={filteredItems}
        totalCount={items.length}
        dateFilterActive={dateFilterActive}
        loading={loading}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        onError={(msg) => toast(msg)}
        onSuccess={(msg) => toast(msg)}
        onRefresh={() => void fetchReports(true)}
      />
    </div>
  )
}
