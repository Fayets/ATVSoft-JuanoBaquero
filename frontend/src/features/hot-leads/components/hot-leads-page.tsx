'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { apiFetch } from '@/lib/api'
import {
  HotLead,
  HotLeadColumnDef,
  HOT_LEAD_COLUMNS,
  AVATAR_OPTIONS,
  SEGUIDORES_OPTIONS,
  CALIDAD_OPTIONS,
  STATUS_OPTIONS,
  STATUS_TABS,
} from '../types'

type SortConfig = { field: string; dir: 'asc' | 'desc' }

const LEADS_TABLE_CHECK_W = 48
const LEADS_TABLE_NUM_W = 40

function formatIsoDateToDdMmYyyy(raw: string | null | undefined): string | null {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return null
  const head = s.includes('T') ? s.split('T')[0] : s.split(' ')[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null
  const [y, mo, d] = head.split('-').map(Number)
  if (!y || !mo || !d) return null
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
}

function toHtmlDateInputValue(raw: string | null | undefined): string {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return ''
  const head = s.includes('T') ? s.split('T')[0] : s.split(' ')[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head
  return s.slice(0, 10)
}

function canonicalHotLeadStatus(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  return s || 'Prospectar'
}

function matchesStatusTab(item: HotLead, tab: string): boolean {
  const status = canonicalHotLeadStatus(item.status)
  if (tab === 'Cerrados') return status === 'Cerrado' || status === 'Seña'
  if (tab === 'Todos') return true
  return status === tab
}

function hotLeadToForm(item: HotLead | null) {
  return {
    nombre: item?.nombre ?? '',
    ig: item?.ig ?? '',
    avatar: item?.avatar ?? '',
    seguidores: item?.seguidores ?? '',
    calidad: item?.calidad ?? '',
    fecha: toHtmlDateInputValue(item?.fecha),
    status: item?.status?.trim() || 'Prospectar',
    notas: item?.notas ?? '',
  }
}

export function HotLeadsPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()

  const [items, setItems] = useState<HotLead[]>([])
  const [loading, setLoading] = useState(true)
  const [statusTab, setStatusTab] = useState('Todos')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortConfig>({ field: 'nombre', dir: 'asc' })
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  const [editOpen, setEditOpen] = useState(false)
  const [editItem, setEditItem] = useState<HotLead | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [textPreview, setTextPreview] = useState<{ title: string; text: string } | null>(null)

  const [formNombre, setFormNombre] = useState('')
  const [formIg, setFormIg] = useState('')
  const [formAvatar, setFormAvatar] = useState('')
  const [formSeguidores, setFormSeguidores] = useState('')
  const [formCalidad, setFormCalidad] = useState('')
  const [formFecha, setFormFecha] = useState('')
  const [formStatus, setFormStatus] = useState('Prospectar')
  const [formNotas, setFormNotas] = useState('')

  const fetchItems = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/hot-leads?month=${encodeURIComponent(month)}`)
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
      const list = (raw as { hot_leads?: HotLead[] }).hot_leads ?? []
      setItems(list)
    } catch (e) {
      toast(`Error al cargar: ${e instanceof Error ? e.message : 'desconocido'}`)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, month, toast])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const openCreate = useCallback(() => {
    const f = hotLeadToForm(null)
    setEditItem(null)
    setFormNombre(f.nombre)
    setFormIg(f.ig)
    setFormAvatar(f.avatar)
    setFormSeguidores(f.seguidores)
    setFormCalidad(f.calidad)
    setFormFecha(f.fecha)
    setFormStatus(f.status)
    setFormNotas(f.notas)
    setEditOpen(true)
  }, [])

  const openEdit = useCallback((item: HotLead) => {
    const f = hotLeadToForm(item)
    setEditItem(item)
    setFormNombre(f.nombre)
    setFormIg(f.ig)
    setFormAvatar(f.avatar)
    setFormSeguidores(f.seguidores)
    setFormCalidad(f.calidad)
    setFormFecha(f.fecha)
    setFormStatus(f.status)
    setFormNotas(f.notas)
    setEditOpen(true)
  }, [])

  const handleInlineUpdate = useCallback(
    async (id: string, field: string, value: string | null) => {
      if (!ready || !userId) return
      try {
        const res = await apiFetch(`/hot-leads/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        })
        const raw = await res.json().catch(() => ({}))
        if (!res.ok) {
          const detail =
            typeof raw === 'object' && raw && 'detail' in raw
              ? String((raw as { detail: unknown }).detail)
              : res.statusText
          toast(`No se guardó: ${detail}`)
          await fetchItems()
          return
        }
        const updated = raw as HotLead
        setItems((prev) => prev.map((l) => (l.id === id ? { ...l, ...updated } : l)))
      } catch (e) {
        toast(`Error al guardar: ${e instanceof Error ? e.message : 'desconocido'}`)
        await fetchItems()
      }
    },
    [ready, userId, toast, fetchItems],
  )

  const filtered = useMemo(() => {
    let result = [...items]

    if (statusTab !== 'Todos') {
      result = result.filter((item) => matchesStatusTab(item, statusTab))
    }

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(
        (item) =>
          item.nombre?.toLowerCase().includes(s) ||
          item.ig?.toLowerCase().includes(s) ||
          item.avatar?.toLowerCase().includes(s) ||
          item.status?.toLowerCase().includes(s) ||
          item.notas?.toLowerCase().includes(s) ||
          item.seguidores?.toLowerCase().includes(s) ||
          item.calidad?.toLowerCase().includes(s),
      )
    }

    result.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sort.field]
      const bv = (b as Record<string, unknown>)[sort.field]
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'es')
      return sort.dir === 'asc' ? cmp : -cmp
    })

    return result
  }, [items, statusTab, search, sort])

  const toggleSort = (field: string) => {
    if (sort.field === field) setSort({ field, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    else setSort({ field, dir: 'asc' })
  }

  const toggleSelectAll = () => {
    if (selectedRows.size === filtered.length) setSelectedRows(new Set())
    else setSelectedRows(new Set(filtered.map((l) => l.id)))
  }

  const toggleSelectRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submitForm = async () => {
    if (!ready || !userId) return
    setSaving(true)
    try {
      const payload = {
        nombre: formNombre.trim(),
        ig: formIg.trim() || null,
        avatar: formAvatar || null,
        seguidores: formSeguidores || null,
        calidad: formCalidad || null,
        fecha: formFecha || null,
        status: formStatus || 'Prospectar',
        notas: formNotas.trim() || null,
        month: month || null,
      }

      const isEdit = editItem !== null
      const res = await apiFetch(
        isEdit ? `/hot-leads/${encodeURIComponent(editItem.id)}` : '/hot-leads',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`No se guardó: ${detail}`)
        return
      }
      const saved = raw as HotLead
      if (isEdit) {
        setItems((prev) => prev.map((l) => (l.id === saved.id ? { ...l, ...saved } : l)))
        toast('Hot lead actualizado')
      } else {
        setItems((prev) => [saved, ...prev])
        toast('Hot lead agregado')
      }
      setEditOpen(false)
      setEditItem(null)
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setSaving(false)
    }
  }

  const executeDelete = async (ids: string[]) => {
    if (!ready || !userId || ids.length === 0) return
    setDeleteBusy(true)
    try {
      for (const id of ids) {
        const res = await apiFetch(`/hot-leads/${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!res.ok) {
          const raw = await res.json().catch(() => ({}))
          const detail =
            typeof raw === 'object' && raw && 'detail' in raw
              ? String((raw as { detail: unknown }).detail)
              : res.statusText
          toast(`No se eliminó: ${detail}`)
          await fetchItems()
          return
        }
      }
      setItems((prev) => prev.filter((l) => !ids.includes(l.id)))
      setSelectedRows((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      toast(ids.length === 1 ? 'Hot lead eliminado' : `${ids.length} hot leads eliminados`)
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setDeleteBusy(false)
    }
  }

  if (!ready) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div className="flex h-full flex-col">
      {/* ━━ TOOLBAR ━━ */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setStatusTab(t)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-all ${
                statusTab === t
                  ? 'bg-[var(--accent)] font-semibold text-white shadow-[0_0_12px_rgba(230,57,70,0.3)]'
                  : 'text-[var(--text3)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text2)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-5 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
              Hot Leads
            </span>
            <span className="font-mono-num font-semibold">{filtered.length}</span>
            {filtered.length !== items.length && (
              <span className="font-mono-num text-[10px] text-[var(--text3)]">/ {items.length}</span>
            )}
          </div>
        </div>
      </div>

      {/* ━━ SECONDARY TOOLBAR ━━ */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {selectedRows.size > 0 && (
            <div className="ml-0 flex items-center gap-2 border-l border-[var(--border2)] pl-2">
              <span className="text-[11px] text-[var(--text3)]">{selectedRows.size} sel.</span>
              <button
                type="button"
                onClick={() => setDeleteConfirmIds(Array.from(selectedRows))}
                className="rounded px-2 py-1 text-[11px] text-[#F87171] transition-colors hover:bg-[rgba(248,113,113,0.1)]"
              >
                Eliminar
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
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

          <MonthSelector month={month} options={options} onChange={setMonth} />

          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-opacity hover:opacity-90"
          >
            Agregar Hot Lead
          </button>
        </div>
      </div>

      {/* ━━ TABLE ━━ */}
      {loading ? (
        <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
          <HotLeadsTable
            items={filtered}
            columns={HOT_LEAD_COLUMNS}
            sort={sort}
            selectedRows={selectedRows}
            onToggleRow={toggleSelectRow}
            onToggleAll={toggleSelectAll}
            allSelected={selectedRows.size === filtered.length && filtered.length > 0}
            onToggleSort={toggleSort}
            onRowClick={openEdit}
            onDelete={(id) => setDeleteConfirmIds([id])}
            onAddRow={openCreate}
            addingRow={saving && editItem === null}
            totalItems={filtered.length}
            onPreviewText={(title, text) => setTextPreview({ title, text })}
            onInlineUpdate={handleInlineUpdate}
          />
        </div>
      )}

      {/* ━━ MODAL crear / editar ━━ */}
      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title={editItem ? 'Editar hot lead' : 'Nuevo hot lead'}
        maxWidth="480px"
        compact
      >
        <p className="mb-4 text-[12px] leading-relaxed text-[var(--text3)]">
          {editItem
            ? 'Actualizá los datos del prospecto.'
            : `Se guarda en el mes seleccionado arriba (${month || 'actual'}).`}
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Nombre
            </span>
            <input
              type="text"
              value={formNombre}
              onChange={(e) => setFormNombre(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              placeholder="Nombre del prospecto"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Instagram
            </span>
            <input
              type="text"
              value={formIg}
              onChange={(e) => setFormIg(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              placeholder="@usuario (opcional)"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
                Avatar
              </span>
              <select
                value={formAvatar}
                onChange={(e) => setFormAvatar(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              >
                {AVATAR_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o === '' ? '—' : o}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
                Seguidores
              </span>
              <select
                value={formSeguidores}
                onChange={(e) => setFormSeguidores(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              >
                {SEGUIDORES_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o === '' ? '—' : o}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
                Calidad
              </span>
              <select
                value={formCalidad}
                onChange={(e) => setFormCalidad(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              >
                {CALIDAD_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o === '' ? '—' : o}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
                Fecha
              </span>
              <input
                type="date"
                value={formFecha}
                onChange={(e) => setFormFecha(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Status
            </span>
            <select
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Notas
            </span>
            <textarea
              value={formNotas}
              onChange={(e) => setFormNotas(e.target.value)}
              disabled={saving}
              rows={3}
              className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              placeholder="Opcional"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditOpen(false)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitForm()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : editItem ? 'Guardar cambios' : 'Crear hot lead'}
          </button>
        </div>
      </Modal>

      {/* ━━ MODAL confirmar eliminación ━━ */}
      {deleteConfirmIds && deleteConfirmIds.length > 0 && (
        <Modal
          open
          onClose={() => !deleteBusy && setDeleteConfirmIds(null)}
          title="Eliminar"
          maxWidth="420px"
        >
          <p className="text-[13px] leading-relaxed text-[var(--text2)]">
            {deleteConfirmIds.length === 1 ? (
              <>
                ¿Eliminar a{' '}
                <span className="font-medium text-[var(--text)]">
                  {(() => {
                    const row = items.find((l) => l.id === deleteConfirmIds[0])
                    const label = [row?.nombre, row?.ig].filter(Boolean).join(' · ')
                    return label || 'este hot lead'
                  })()}
                </span>
                ? No se puede deshacer.
              </>
            ) : (
              <>
                ¿Eliminar{' '}
                <span className="font-mono-num font-medium text-[var(--text)]">
                  {deleteConfirmIds.length}
                </span>{' '}
                hot leads seleccionados? No se puede deshacer.
              </>
            )}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => setDeleteConfirmIds(null)}
              className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={deleteBusy}
              onClick={async () => {
                const ids = [...deleteConfirmIds]
                await executeDelete(ids)
                setDeleteConfirmIds(null)
              }}
              className="rounded-lg bg-[#F87171] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {deleteBusy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {/* ━━ MODAL (text preview) ━━ */}
      {textPreview && (
        <Modal
          open={!!textPreview}
          onClose={() => setTextPreview(null)}
          title={textPreview.title}
          maxWidth="750px"
        >
          <div className="max-h-[70vh] space-y-1 overflow-y-auto pr-2">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text2)]">
              {textPreview.text}
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}

function HotLeadsTable({
  items,
  columns,
  sort,
  selectedRows,
  onToggleRow,
  onToggleAll,
  allSelected,
  onToggleSort,
  onRowClick,
  onDelete,
  onAddRow,
  addingRow,
  totalItems,
  onPreviewText,
  onInlineUpdate,
}: {
  items: HotLead[]
  columns: HotLeadColumnDef[]
  sort: SortConfig
  selectedRows: Set<string>
  onToggleRow: (id: string) => void
  onToggleAll: () => void
  allSelected: boolean
  onToggleSort: (field: string) => void
  onRowClick: (item: HotLead) => void
  onDelete: (id: string) => void
  onAddRow: () => void
  addingRow: boolean
  totalItems: number
  onPreviewText: (title: string, text: string) => void
  onInlineUpdate: (id: string, field: string, value: string | null) => void
}) {
  const stickyName = columns.some((c) => c.key === 'nombre' && c.sticky)

  return (
    <table
      className="leads-table w-full"
      style={{
        minWidth: columns.reduce((s, c) => s + c.width, 100),
        ['--leads-check-w' as string]: `${LEADS_TABLE_CHECK_W}px`,
        ['--leads-num-w' as string]: `${LEADS_TABLE_NUM_W}px`,
      }}
    >
      <thead className="sticky top-0 z-20">
        <tr className="bg-[var(--bg3)]">
          <th
            className={`border-b border-[var(--border2)] px-2 py-2 text-center ${
              stickyName ? 'leads-table__sticky-frozen leads-table__sticky-check' : ''
            }`}
            style={{ width: LEADS_TABLE_CHECK_W, minWidth: LEADS_TABLE_CHECK_W, maxWidth: LEADS_TABLE_CHECK_W }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              className="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border2)] bg-transparent accent-[var(--accent)]"
            />
          </th>
          <th
            className={`border-b border-[var(--border2)] px-1 py-2 text-center text-[10px] font-medium text-[var(--text3)] ${
              stickyName ? 'leads-table__sticky-frozen leads-table__sticky-num' : ''
            }`}
            style={{ width: LEADS_TABLE_NUM_W, minWidth: LEADS_TABLE_NUM_W, maxWidth: LEADS_TABLE_NUM_W }}
          >
            #
          </th>
          {columns.map((col) => (
            <th
              key={col.key}
              onClick={() => onToggleSort(col.key)}
              className={`cursor-pointer select-none border-b border-[var(--border2)] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] transition-colors hover:text-[var(--text2)] whitespace-nowrap ${
                stickyName && col.key === 'nombre'
                  ? 'leads-table__sticky-frozen leads-table__sticky-name'
                  : ''
              }`}
              style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}
            >
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate">{col.label}</span>
                {sort.field === col.key && (
                  <span className="shrink-0 text-[9px] text-[var(--accent)]">
                    {sort.dir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </div>
            </th>
          ))}
          <th className="w-10 border-b border-[var(--border2)]" />
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const rowSel = selectedRows.has(item.id)
          return (
            <tr
              key={item.id}
              className={`group cursor-pointer transition-colors ${
                rowSel
                  ? 'leads-table__row--selected bg-[rgba(230,57,70,0.06)]'
                  : 'hover:bg-[rgba(255,255,255,0.02)]'
              }`}
              onClick={() => onRowClick(item)}
            >
              <td
                className={`border-b border-[var(--border)] px-2 py-1.5 text-center ${
                  stickyName ? 'leads-table__sticky-frozen leads-table__sticky-check' : ''
                }`}
                style={{ width: LEADS_TABLE_CHECK_W, minWidth: LEADS_TABLE_CHECK_W, maxWidth: LEADS_TABLE_CHECK_W }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selectedRows.has(item.id)}
                  onChange={() => onToggleRow(item.id)}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border2)] bg-transparent accent-[var(--accent)]"
                />
              </td>
              <td
                className={`border-b border-[var(--border)] px-1 py-1.5 text-center text-[11px] font-mono-num text-[var(--text3)] ${
                  stickyName ? 'leads-table__sticky-frozen leads-table__sticky-num' : ''
                }`}
                style={{ width: LEADS_TABLE_NUM_W, minWidth: LEADS_TABLE_NUM_W, maxWidth: LEADS_TABLE_NUM_W }}
              >
                {idx + 1}
              </td>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`border-b border-[var(--border)] px-3 py-1.5 align-top ${
                    stickyName && col.key === 'nombre'
                      ? 'leads-table__sticky-frozen leads-table__sticky-name'
                      : ''
                  }`}
                  style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}
                  onClick={
                    col.options
                      ? (e) => e.stopPropagation()
                      : undefined
                  }
                >
                  <div className="min-w-0 max-w-full">
                    <HotLeadTableCell
                      item={item}
                      col={col}
                      onPreviewText={onPreviewText}
                      onSave={(value) => onInlineUpdate(item.id, col.key, value)}
                    />
                  </div>
                </td>
              ))}
              <td
                className="border-b border-[var(--border)] px-2 py-1.5 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => onDelete(item.id)}
                  className="text-sm text-[var(--text3)] opacity-0 transition-all group-hover:opacity-100 hover:text-[#F87171]"
                >
                  ×
                </button>
              </td>
            </tr>
          )
        })}
        <tr>
          <td className="border-b border-[var(--border)] px-2 py-1.5" />
          <td className="border-b border-[var(--border)] px-1 py-1.5 text-center text-[11px] font-mono-num text-[var(--text3)] opacity-40">
            {totalItems + 1}
          </td>
          <td className="border-b border-[var(--border)]" colSpan={columns.length + 1} />
        </tr>
        <tr
          className={`cursor-pointer bg-[var(--bg)] transition-colors hover:bg-[rgba(255,255,255,0.02)] ${
            addingRow ? 'pointer-events-none opacity-50' : ''
          }`}
          onClick={onAddRow}
        >
          <td colSpan={columns.length + 3} className="border-b border-[var(--border)] px-3 py-2">
            <span className="text-[12px] text-[var(--text3)] transition-colors hover:text-[var(--text2)]">
              {addingRow ? 'Creando...' : '+ Nuevo hot lead'}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function HotLeadTableCell({
  item,
  col,
  onPreviewText,
  onSave,
}: {
  item: HotLead
  col: HotLeadColumnDef
  onPreviewText: (title: string, text: string) => void
  onSave: (value: string | null) => void
}) {
  const value = item[col.key]
  const strVal = value != null ? String(value) : ''
  const cellClass = 'block max-w-full truncate text-[12px]'

  if ((col.type === 'select' || col.type === 'badge') && col.options) {
    const opts = col.options
    const displayVal = col.key === 'status' ? (strVal || 'Prospectar') : strVal
    const color = col.colors?.[displayVal] || '#6B7280'
    const isStatus = col.key === 'status'

    return (
      <span
        className={`inline-flex max-w-full min-w-0 items-center overflow-hidden ${
          isStatus
            ? 'h-6 justify-center rounded-full px-2.5'
            : 'rounded-full px-2.5 py-0.5'
        }`}
        style={
          displayVal
            ? isStatus
              ? { backgroundColor: color + '20' }
              : { backgroundColor: color + '18', border: `1px solid ${color}30` }
            : undefined
        }
      >
        <select
          value={displayVal}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSave(e.target.value || null)}
          className="box-border h-full min-h-0 w-full min-w-0 max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-[11px] font-semibold leading-none outline-none"
          style={{ color: displayVal ? color : 'var(--text3)' }}
        >
          {opts.map((o) => (
            <option key={o} value={o}>
              {o === '' ? '—' : o}
            </option>
          ))}
        </select>
      </span>
    )
  }

  if (col.key === 'nombre') {
    return (
      <span className="block truncate text-[13px] font-medium text-[var(--text)]">
        {strVal || '—'}
      </span>
    )
  }

  if (col.type === 'date') {
    if (!strVal) return <span className={`${cellClass} text-[var(--text3)]`}>—</span>
    const shown = formatIsoDateToDdMmYyyy(strVal) ?? strVal
    return <span className={`${cellClass} font-mono-num text-[var(--text2)]`}>{shown}</span>
  }

  if (col.key === 'notas' && strVal) {
    const preview = strVal.length > 44 ? `${strVal.slice(0, 44)}…` : strVal
    return (
      <span
        onClick={(e) => {
          e.stopPropagation()
          onPreviewText(col.label, strVal)
        }}
        className={`${cellClass} cursor-pointer text-[var(--text2)]`}
        title={strVal}
      >
        {preview}
      </span>
    )
  }

  return (
    <span className={`${cellClass} ${strVal ? 'text-[var(--text2)]' : 'text-[var(--text3)]'}`}>
      {strVal || '—'}
    </span>
  )
}
