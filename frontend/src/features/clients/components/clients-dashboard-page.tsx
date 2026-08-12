'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { fetchClients, patchClientCrm } from '../services/clients-service'
import {
  CrmClient,
  DURATION_PRESETS,
  FIELD_SOURCE_LABELS,
  MISSING_FIELD_LABELS,
  SALE_STATUS_OPTIONS,
} from '../types'

function sourceLabel(key: string | undefined): string | null {
  if (!key || key === 'manual') return null
  return FIELD_SOURCE_LABELS[key] ?? key
}

function toInputDate(raw: string | null | undefined): string {
  if (!raw) return ''
  const head = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0]
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : ''
}

function winsToText(wins: string[]) {
  return wins.join('\n')
}

function textToWins(text: string) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

function formatDaysElapsed(days: number): string {
  return days === 1 ? '1 día transcurrido' : `${days} días transcurridos`
}

function ProgressBar({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-[11px] text-[var(--text3)]">Sin datos</span>
  }
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg4)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[11px] tabular-nums text-[var(--text2)]">
        {pct}%
      </span>
    </div>
  )
}

function formFromClient(item: CrmClient) {
  return {
    full_name: item.full_name,
    program_name: item.program_name,
    program_duration_months: item.program_duration_months ?? 6,
    start_date: toInputDate(item.start_date),
    sale_status: item.sale_status,
    winsText: winsToText(item.wins),
    notes: item.notes,
  }
}

export function ClientsDashboardPage() {
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [clients, setClients] = useState<CrmClient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'incomplete'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<CrmClient | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(formFromClient({
    id: '0',
    lead_id: '0',
    full_name: '',
    program_name: '',
    program_duration_months: 6,
    start_date: null,
    sale_status: 'cerrado',
    lead_status: '',
    wins: [],
    notes: '',
    progress_percent: null,
    end_date: null,
    days_elapsed: null,
    tags: [],
    is_complete: false,
    missing_fields: [],
    created_at: '',
    updated_at: null,
  }))

  const load = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)
    const result = await fetchClients()
    if (result.error) toast(result.error)
    setClients(result.clients)
    setLoading(false)
  }, [ready, userId, toast])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    let rows = clients
    if (filter === 'incomplete') {
      rows = rows.filter((c) => !c.is_complete)
    }
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.program_name.toLowerCase().includes(q) ||
        c.lead_status.toLowerCase().includes(q),
    )
  }, [clients, search, filter])

  const incompleteCount = useMemo(
    () => clients.filter((c) => !c.is_complete).length,
    [clients],
  )

  const openEdit = (item: CrmClient) => {
    setEditItem(item)
    setForm(formFromClient(item))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditItem(null)
  }

  const onSave = async () => {
    if (!editItem) return
    const payload = {
      full_name: form.full_name.trim(),
      program_name: form.program_name.trim(),
      program_duration_months: Number(form.program_duration_months),
      start_date: form.start_date || null,
      sale_status: form.sale_status,
      wins: textToWins(form.winsText),
      notes: form.notes.trim(),
    }
    if (!payload.full_name) {
      toast('Nombre requerido')
      return
    }
    if (!payload.start_date) {
      toast('Fecha de inicio requerida')
      return
    }
    setSaving(true)
    const result = await patchClientCrm(editItem.lead_id, payload)
    setSaving(false)
    if (result.error) {
      toast(result.error)
      return
    }
    toast('Datos CRM guardados')
    closeModal()
    void load()
  }

  const markClosed = async (item: CrmClient) => {
    const result = await patchClientCrm(item.lead_id, { sale_status: 'cerrado' })
    if (result.error) {
      toast(result.error)
      return
    }
    toast('Venta marcada como cerrada')
    void load()
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--text)]">Dashboard clientes</h1>
        <p className="mt-1 text-sm text-[var(--text3)]">
          Clientes desde Leads. Nombre, programa y wins se sincronizan con Leads al guardar.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, programa o status..."
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex rounded-lg border border-[var(--border2)] p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-3 py-1.5 ${filter === 'all' ? 'bg-[var(--accent-faint)] text-[var(--text)]' : 'text-[var(--text3)]'}`}
          >
            Todos ({clients.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('incomplete')}
            className={`rounded-md px-3 py-1.5 ${filter === 'incomplete' ? 'bg-[var(--accent-faint)] text-[var(--text)]' : 'text-[var(--text3)]'}`}
          >
            Incompletos ({incompleteCount})
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg2)]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text3)]">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Programa</th>
              <th className="px-4 py-3">Status lead</th>
              <th className="px-4 py-3">Duración</th>
              <th className="px-4 py-3">Avance</th>
              <th className="px-4 py-3">Estado venta</th>
              <th className="px-4 py-3">Wins</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--text3)]">
                  Cargando clientes desde leads...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--text3)]">
                  No hay leads Cerrados/Seña con pago. Actualizá el status en{' '}
                  <Link href="/leads" className="text-[var(--accent)] underline">
                    Leads
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.lead_id} className="border-t border-[var(--border)] hover:bg-[var(--nav-hover)]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text)]">{item.full_name || '—'}</div>
                    {!item.is_complete && (
                      <div className="mt-1 text-[10px] text-amber-400">
                        Falta: {item.missing_fields.map((f) => MISSING_FIELD_LABELS[f] ?? f).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--text2)]">
                    {item.program_name || '—'}
                    {sourceLabel(item.field_sources?.program_name) && (
                      <div className="text-[10px] text-[var(--text3)]">
                        {sourceLabel(item.field_sources.program_name)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--text2)]">{item.lead_status}</td>
                  <td className="px-4 py-3 text-[var(--text2)]">
                    {item.program_duration_months ? `${item.program_duration_months} meses` : '—'}
                    {sourceLabel(item.field_sources?.program_duration_months) && (
                      <div className="text-[10px] text-[var(--text3)]">
                        {sourceLabel(item.field_sources.program_duration_months)}
                      </div>
                    )}
                    {item.days_elapsed != null && (
                      <div className="text-[11px] text-[var(--text3)]">
                        {formatDaysElapsed(item.days_elapsed)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ProgressBar value={item.progress_percent} />
                    {sourceLabel(item.field_sources?.start_date) && (
                      <div className="mt-0.5 text-[10px] text-[var(--text3)]">
                        Inicio: {sourceLabel(item.field_sources.start_date)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        item.sale_status === 'cerrado'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {item.sale_status === 'cerrado' ? 'Cerrado' : 'Abierto'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[var(--text2)]">{item.wins.length}</span>
                    {item.wins.length > 0 && (
                      <div className="max-w-[160px] truncate text-[10px] text-[var(--text3)]" title={item.wins.join(' · ')}>
                        {item.wins[0]}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {item.sale_status !== 'cerrado' && (
                        <button
                          type="button"
                          onClick={() => void markClosed(item)}
                          className="rounded border border-emerald-500/30 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/10"
                        >
                          Cerrar venta
                        </button>
                      )}
                      <Link
                        href="/leads"
                        className="rounded border border-[var(--border2)] px-2 py-1 text-[11px] text-[var(--text2)] hover:bg-[var(--bg4)]"
                      >
                        Leads
                      </Link>
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="rounded border border-[var(--border2)] px-2 py-1 text-[11px] text-[var(--text2)] hover:bg-[var(--bg4)]"
                      >
                        {item.is_complete ? 'Editar CRM' : 'Completar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editItem?.is_complete ? 'Editar datos CRM' : 'Completar datos CRM'}
      >
        {editItem && (
          <div className="space-y-4">
            <p className="text-[11px] text-[var(--text3)]">
              Lead #{editItem.lead_id} · Los cambios en nombre, programa y wins se reflejan en Leads.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text3)]">Nombre</span>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text3)]">Programa</span>
                <input
                  type="text"
                  value={form.program_name}
                  onChange={(e) => setForm((f) => ({ ...f, program_name: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)]"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text3)]">Duración (meses)</span>
                <select
                  value={form.program_duration_months}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, program_duration_months: Number(e.target.value) }))
                  }
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)]"
                >
                  {DURATION_PRESETS.map((m) => (
                    <option key={m} value={m}>
                      {m} meses
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text3)]">Inicio del programa</span>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)]"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text3)]">Estado de venta (CRM)</span>
              <select
                value={form.sale_status}
                onChange={(e) => setForm((f) => ({ ...f, sale_status: e.target.value as 'abierto' | 'cerrado' }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)]"
              >
                {SALE_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text3)]">Wins del cliente (una por línea)</span>
              <textarea
                value={form.winsText}
                onChange={(e) => setForm((f) => ({ ...f, winsText: e.target.value }))}
                rows={4}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)]"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text3)]">Notas CRM</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)]"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-[var(--border2)] px-4 py-2 text-sm text-[var(--text2)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onSave()}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
