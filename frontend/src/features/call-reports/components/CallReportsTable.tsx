'use client'

import { useEffect, useRef, useMemo, useState } from 'react'
import type { CallReport } from '../types'
import { sendCallReportToDiscord } from '../services/call-reports-service'
import { CallReportDetail, formatReportDate } from './CallReportDetail'
import { DiscordIcon } from './discord-icon'

type Props = {
  items: CallReport[]
  totalCount?: number
  dateFilterActive?: boolean
  loading: boolean
  selectedIds: Set<string>
  onToggleRow: (id: string) => void
  onToggleAll: () => void
  onError?: (msg: string) => void
  onSuccess?: (msg: string) => void
  onRefresh?: () => void
}

const COLS = 'grid-cols-[36px_1.2fr_0.85fr_1.6fr_36px_36px]'

export function CallReportsTable({
  items,
  totalCount = items.length,
  dateFilterActive = false,
  loading,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onError,
  onSuccess,
  onRefresh,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [discordSendingId, setDiscordSendingId] = useState<string | null>(null)
  const expandedRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!expandedId) return
    const onPointerDown = (e: MouseEvent) => {
      const el = expandedRowRef.current
      if (el && !el.contains(e.target as Node)) {
        setExpandedId(null)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [expandedId])

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [items],
  )

  const allSelected = sorted.length > 0 && sorted.every((r) => selectedIds.has(r.id))

  async function handleSendDiscord(row: CallReport) {
    if (row.estado !== 'listo' || discordSendingId === row.id) return
    setDiscordSendingId(row.id)
    try {
      await sendCallReportToDiscord(row.id)
      onSuccess?.('Análisis enviado a Discord.')
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'No se pudo enviar a Discord.')
    } finally {
      setDiscordSendingId(null)
    }
  }

  if (loading && sorted.length === 0) {
    return <div className="py-12 text-center text-[13px] text-[var(--text3)]">Cargando reportes…</div>
  }

  if (sorted.length === 0) {
    return (
      <div className="glass-card py-12 text-center text-[13px] text-[var(--text3)]">
        {dateFilterActive && totalCount > 0
          ? 'No hay reportes en este rango de fechas.'
          : 'No hay reportes todavía. Pegá un link de Fathom en la columna "Link de llamada" de un lead.'}
      </div>
    )
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="w-full text-[13px]">
        <div
          className={`grid ${COLS} items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]`}
        >
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              aria-label="Seleccionar todos"
            />
          </div>
          <div className="text-left">Lead</div>
          <div className="text-center">Fecha</div>
          <div className="text-left">Link Fathom</div>
          <div />
          <div />
        </div>

        {sorted.map((row) => {
          const open = expandedId === row.id
          const discordReady = row.estado === 'listo'
          const discordBusy = discordSendingId === row.id
          return (
            <div
              key={row.id}
              ref={open ? expandedRowRef : undefined}
              className={`border-b border-[var(--border)]/60 ${open ? 'bg-[var(--bg3)]/25' : ''}`}
            >
              <div
                className={`grid ${COLS} w-full items-center gap-2 px-4 py-3 hover:bg-[var(--bg3)]/40`}
              >
                <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => onToggleRow(row.id)}
                    aria-label={`Seleccionar reporte ${row.id}`}
                  />
                </div>
                <button
                  type="button"
                  className="min-w-0 truncate text-left font-medium text-[var(--text)]"
                  onClick={() => setExpandedId(open ? null : row.id)}
                >
                  {row.lead_nombre || 'Sin nombre'}
                </button>
                <button
                  type="button"
                  className="text-center font-mono-num text-[var(--text2)]"
                  onClick={() => setExpandedId(open ? null : row.id)}
                >
                  {formatReportDate(row.created_at)}
                </button>
                <a
                  href={row.fathom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-left text-[var(--accent)] hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.fathom_url}
                </a>
                <button
                  type="button"
                  title={
                    discordReady
                      ? 'Enviar análisis a Discord'
                      : 'Disponible cuando el análisis esté listo'
                  }
                  disabled={!discordReady || discordBusy}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleSendDiscord(row)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[#5865F2]/40 bg-[#5865F2]/10 text-[#5865F2] transition-colors hover:border-[#5865F2] hover:bg-[#5865F2]/20 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Enviar análisis a Discord"
                >
                  <DiscordIcon className={`h-4 w-4 ${discordBusy ? 'animate-pulse' : ''}`} />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border2)] text-[14px] text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  onClick={() => setExpandedId(open ? null : row.id)}
                  aria-label={open ? 'Cerrar detalle' : 'Ver detalle'}
                  aria-expanded={open}
                >
                  {open ? '▾' : '▸'}
                </button>
              </div>
              {open && (
                <div className="border-t border-[var(--border)]/80 px-4 pb-4 pt-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)]">
                      Detalle del reporte
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="rounded-md border border-[var(--border2)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] font-medium text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--text)]"
                    >
                      Cerrar
                    </button>
                  </div>
                  <CallReportDetail
                    report={row}
                    onError={onError}
                    onSuccess={onSuccess}
                    onReanalyze={onRefresh}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
