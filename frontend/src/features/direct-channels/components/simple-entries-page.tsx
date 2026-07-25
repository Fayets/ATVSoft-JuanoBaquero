'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'

type FieldDef = { key: string; label: string; type?: string }

type SimpleEntriesPageProps = {
  table: 'bio_entries' | 'referral_entries' | 'deferred_entries'
  title: string
  fields: FieldDef[]
  columns: { key: string; label: string }[]
}

export function SimpleEntriesPage({ table, title, fields, columns }: SimpleEntriesPageProps) {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null)

  const fetchItems = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    void table
    void month
    setItems([])
    setLoading(false)
  }, [month, table, ready])

  useEffect(() => { fetchItems() }, [fetchItems])

  const handleSave = async (form: Record<string, string>) => {
    if (!userId) return

    const row: Record<string, unknown> = { user_id: userId, month }
    fields.forEach((f) => {
      if (f.type === 'number') row[f.key] = Number(form[f.key]) || 0
      else if (f.type === 'date') row[f.key] = form[f.key] || null
      else row[f.key] = form[f.key] || null
    })

    void row
    void editItem
    toast('Esta vista requiere endpoint en FastAPI para ' + table)
    setShowModal(false)
    setEditItem(null)
    fetchItems()
  }

  const handleDelete = async (id: string) => {
    void id
    toast('Eliminación no disponible sin API.')
  }

  const totalCash = items.reduce((s, i) => s + (Number(i.cash) || 0), 0)
  const totalChats = items.reduce((s, i) => s + (Number(i.chats) || 0), 0)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">{items.length} entradas</p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector month={month} options={options} onChange={setMonth} />
          <button
            onClick={() => { setEditItem(null); setShowModal(true) }}
            className="rounded-lg border border-[var(--border2)] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-faint)]"
          >
            + Agregar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="glass-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Cash Total</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--green)]">{formatCash(totalCash)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Chats Total</div>
          <div className="font-mono-num mt-1 text-xl font-semibold">{totalChats}</div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--text3)]">Sin entradas este mes</div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-3 px-4 py-2" style={{ gridTemplateColumns: columns.map(() => '1fr').join(' ') + ' 30px' }}>
            {columns.map((c) => (
              <div key={c.key} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{c.label}</div>
            ))}
            <div />
          </div>
          {items.map((item) => (
            <div
              key={item.id as string}
              className="glass-card grid cursor-pointer items-center gap-3 px-4 py-3 hover:border-[var(--border2)]"
              style={{ gridTemplateColumns: columns.map(() => '1fr').join(' ') + ' 30px' }}
              onClick={() => { setEditItem(item); setShowModal(true) }}
            >
              {columns.map((c) => (
                <div key={c.key} className={`text-[13px] truncate ${c.key === 'cash' ? 'font-mono-num text-[var(--green)] font-medium' : c.key === 'chats' ? 'font-mono-num' : ''}`}>
                  {c.key === 'cash' ? formatCash(Number(item[c.key]) || 0) : String(item[c.key] ?? '—')}
                </div>
              ))}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id as string) }}
                className="text-[var(--text3)] hover:text-[var(--red)] transition-colors text-sm"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditItem(null) }}
        title={editItem ? 'Editar entrada' : 'Nueva entrada'}
        maxWidth="500px"
      >
        <SimpleEntryForm
          fields={fields}
          initialData={editItem}
          onSave={handleSave}
          onCancel={() => { setShowModal(false); setEditItem(null) }}
        />
      </Modal>
    </div>
  )
}

function SimpleEntryForm({
  fields,
  initialData,
  onSave,
  onCancel,
}: {
  fields: FieldDef[]
  initialData: Record<string, unknown> | null
  onSave: (data: Record<string, string>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (initialData) {
      const f: Record<string, string> = {}
      fields.forEach((fd) => { f[fd.key] = String(initialData[fd.key] ?? '') })
      setForm(f)
    } else {
      setForm({ date: new Date().toISOString().split('T')[0] })
    }
  }, [initialData, fields])

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{f.label}</label>
          <input
            type={f.type || 'text'}
            value={form[f.key] || ''}
            onChange={(e) => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
      ))}
      <div className="flex justify-end gap-3 pt-3">
        <button onClick={onCancel} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)]">Cancelar</button>
        <button onClick={() => onSave(form)} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white">Guardar</button>
      </div>
    </div>
  )
}
