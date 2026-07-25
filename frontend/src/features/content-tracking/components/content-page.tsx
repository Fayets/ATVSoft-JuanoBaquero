'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { getMonthRange, formatCash } from '@/shared/lib/format-utils'

type ContentType = 'reel' | 'historia' | 'story' | 'video'

type ContentItem = {
  id: string
  title: string | null
  content_type: ContentType
  platform: string
  metrics: Record<string, number>
  classification: Record<string, string | string[]>
  cash: number
  chats: number
  published_at: string | null
  url: string | null
  notes: string | null
  manychat_tag_id: string | null
  manychat_tag_name: string | null
}

type ManyChatTag = { id: number; name: string }

type LeadAttribution = {
  agenda_point: string | null
  entry_funnel: string | null
  status: string
  payment: number
  client_name: string
}

type ContentPageProps = {
  contentType: ContentType
  platform: 'instagram' | 'youtube'
  title: string
  columns: { key: string; label: string; render?: (item: ContentItem) => React.ReactNode }[]
}

// Parse "Historia DD/MM/YY" or "Reel DD/MM/YY" into content type + date
function parseContentRef(text: string | null): { type: string; date: string } | null {
  if (!text) return null
  const m = text.match(/^(Historia|Reel)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/i)
  if (!m) return null
  const type = m[1].toLowerCase() === 'historia' ? 'historia' : 'reel'
  const day = m[2].padStart(2, '0')
  const mo = m[3].padStart(2, '0')
  const year = m[4].length === 2 ? `20${m[4]}` : m[4]
  return { type, date: `${year}-${mo}-${day}` }
}

export function ContentPage({ contentType, platform, title, columns }: ContentPageProps) {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [items, setItems] = useState<ContentItem[]>([])
  const [leads, setLeads] = useState<LeadAttribution[]>([])
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState<ContentItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const fetchItems = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const { start, end } = getMonthRange(month)
    const types = contentType === 'historia' ? ['historia', 'story'] : [contentType]

    void types
    void start
    void end
    setItems([])
    setLeads([])
    setLoading(false)
  }, [month, contentType, platform, ready])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Map leads to content items by matching agenda_point type+date
  const leadsMap = useMemo(() => {
    const map = new Map<string, LeadAttribution[]>()
    items.forEach(item => {
      // Only match to aggregate 'historia' items, not individual 'story' sub-items
      if (item.content_type === 'story') return
      const itemDate = item.published_at?.split('T')[0]
      if (!itemDate) return

      const matched = leads.filter(lead => {
        const ref = parseContentRef(lead.agenda_point)
        if (!ref) return false
        const typeMatch =
          (ref.type === 'reel' && item.content_type === 'reel') ||
          (ref.type === 'historia' && item.content_type === 'historia') ||
          (ref.type === 'reel' && item.content_type === 'video')
        return typeMatch && ref.date === itemDate
      })
      if (matched.length > 0) map.set(item.id, matched)
    })
    return map
  }, [items, leads])

  const handleSave = async (formData: Record<string, string>) => {
    if (!userId) return

    const row = {
      user_id: userId,
      title: formData.title || null,
      content_type: contentType === 'historia' ? 'historia' : contentType,
      platform,
      metrics: {
        ...(contentType === 'historia'
          ? {}
          : { views: Number(formData.views) || 0 }),
        likes: Number(formData.likes) || 0,
        comments: Number(formData.comments) || 0,
        saves: Number(formData.saves) || 0,
        shares: Number(formData.shares) || 0,
        reach: Number(formData.reach) || 0,
      },
      classification: {
        dolor: formData.dolor || '',
        angulos: formData.angulos ? formData.angulos.split(',').map(s => s.trim()).filter(Boolean) : [],
        cta: formData.cta || '',
      },
      cash: Number(formData.cash) || 0,
      chats: Number(formData.chats) || 0,
      published_at: formData.fecha ? new Date(formData.fecha).toISOString() : new Date().toISOString(),
      url: formData.url || null,
      notes: formData.notes || null,
      manychat_tag_id: formData.manychat_tag_id || null,
      manychat_tag_name: formData.manychat_tag_name || null,
    }

    void row
    void editItem
    toast('Contenido: persistencia vía FastAPI pendiente.')
    setEditItem(null)
    setShowAdd(false)
    fetchItems()
  }

  const handleDelete = async (id: string) => {
    void id
    toast('Eliminación no disponible sin API.')
  }

  // Stats
  const totalCash = items.reduce((s, i) => s + (Number(i.cash) || 0), 0)
  const totalChats = items.reduce((s, i) => s + (Number(i.chats) || 0), 0)
  const cpc = totalChats > 0 ? totalCash / totalChats : 0

  // Attribution stats
  const allAttributedLeads = Array.from(leadsMap.values()).flat()
  const totalLeads = allAttributedLeads.length
  const closedLeads = allAttributedLeads.filter(l => l.status === 'Cerrado')
  const totalVentas = closedLeads.reduce((s, l) => s + (Number(l.payment) || 0), 0)

  const gridCols = `2fr ${columns.map(() => '1fr').join(' ')} 80px 80px 55px 75px 30px`

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">{items.length} piezas este mes</p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector month={month} options={options} onChange={setMonth} />
          <button
            onClick={() => { setEditItem(null); setShowAdd(true) }}
            className="rounded-lg border border-[var(--border2)] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-faint)]"
          >
            + Agregar
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-5 gap-4">
        <div className="glass-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Cash</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--green)]">{formatCash(totalCash)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Chats</div>
          <div className="font-mono-num mt-1 text-xl font-semibold">{totalChats}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Cash por chat</div>
          <div className="font-mono-num mt-1 text-xl font-semibold">{formatCash(cpc)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Leads</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--accent)]">{totalLeads}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">Ventas</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--green)]">
            {closedLeads.length > 0 ? `${closedLeads.length} · ${formatCash(totalVentas)}` : '—'}
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--text3)]">
          Sin {title.toLowerCase()} este mes. Agrega manualmente o importa desde Conexiones API.
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header */}
          <div className="grid gap-3 px-4 py-2" style={{ gridTemplateColumns: gridCols }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Titulo</div>
            {columns.map((col) => (
              <div key={col.key} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{col.label}</div>
            ))}
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Cash</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Chats</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Leads</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Ventas</div>
            <div />
          </div>
          {/* Rows */}
          {items.map((item) => {
            const itemLeads = leadsMap.get(item.id) || []
            const itemCerrados = itemLeads.filter(l => l.status === 'Cerrado')
            const itemVentas = itemCerrados.reduce((s, l) => s + (Number(l.payment) || 0), 0)

            return (
              <div
                key={item.id}
                className="glass-card grid cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:border-[var(--border2)]"
                style={{ gridTemplateColumns: gridCols }}
                onClick={() => { setEditItem(item); setShowAdd(true) }}
              >
                <div className="truncate text-[13px]">{item.title || item.notes?.substring(0, 60) || '—'}</div>
                {columns.map((col) => (
                  <div key={col.key} className="text-[12px] text-[var(--text2)]">
                    {col.render ? col.render(item) : String((item.metrics as Record<string, unknown>)[col.key] || '—')}
                  </div>
                ))}
                <div className="font-mono-num text-[13px] font-medium text-[var(--green)]">{formatCash(item.cash)}</div>
                <div className="font-mono-num text-[13px]">{item.chats}</div>
                {/* Leads count with tooltip */}
                <div className="relative group">
                  {itemLeads.length > 0 ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-[var(--accent)]20 text-[var(--accent)] border border-[var(--accent)]30 px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: 'rgba(230,57,70,0.12)', borderColor: 'rgba(230,57,70,0.25)' }}>
                      {itemLeads.length}
                    </span>
                  ) : (
                    <span className="text-[12px] text-[var(--text3)]">—</span>
                  )}
                  {itemLeads.length > 0 && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-56">
                      <div className="rounded-lg border border-[var(--border2)] bg-[var(--bg2)] p-3 shadow-xl">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">Leads vinculados</div>
                        {itemLeads.map((l, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 py-1 text-[11px]">
                            <span className="truncate text-[var(--text2)]">{l.client_name}</span>
                            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: l.status === 'Cerrado' ? '#4ADE8018' : l.status === 'Seguimiento' ? '#60A5FA18' : '#94A3B818',
                                color: l.status === 'Cerrado' ? '#4ADE80' : l.status === 'Seguimiento' ? '#60A5FA' : '#94A3B8',
                              }}>
                              {l.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Ventas */}
                <div className="font-mono-num text-[12px]">
                  {itemCerrados.length > 0 ? (
                    <span className="text-[var(--green)] font-medium">{formatCash(itemVentas)}</span>
                  ) : (
                    <span className="text-[var(--text3)]">—</span>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                  className="text-[var(--text3)] hover:text-[var(--red)] transition-colors text-sm"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <ContentFormModal
        open={showAdd}
        onClose={() => { setShowAdd(false); setEditItem(null) }}
        item={editItem}
        onSave={handleSave}
        title={editItem ? `Editar ${title.slice(0, -1)}` : `Agregar ${title.slice(0, -1)}`}
        contentType={contentType}
      />
    </div>
  )
}

// ── Form Modal ──
type ContentFormModalProps = {
  open: boolean
  onClose: () => void
  item: ContentItem | null
  onSave: (data: Record<string, string>) => void
  title: string
  contentType: ContentType
}

function ContentFormModal({ open, onClose, item, onSave, title, contentType }: ContentFormModalProps) {
  const { userId } = useAuthUser()
  const [form, setForm] = useState<Record<string, string>>({})
  const [mcTags, setMcTags] = useState<ManyChatTag[]>([])
  const [mcLoading, setMcLoading] = useState(false)
  const [mcSyncing, setMcSyncing] = useState(false)
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [tagSearch, setTagSearch] = useState('')

  useEffect(() => {
    if (item) {
      const cls = (item.classification || {}) as Record<string, unknown>
      setForm({
        title: item.title || '',
        fecha: item.published_at ? item.published_at.split('T')[0] : '',
        views: String(item.metrics?.views || 0),
        likes: String(item.metrics?.likes || 0),
        comments: String(item.metrics?.comments || 0),
        saves: String(item.metrics?.saves || 0),
        shares: String(item.metrics?.shares || 0),
        reach: String(item.metrics?.reach || 0),
        dolor: String(cls.dolor || ''),
        angulos: Array.isArray(cls.angulos) ? cls.angulos.join(', ') : String(cls.angulos || ''),
        cta: String(cls.cta || ''),
        cash: String(item.cash || 0),
        chats: String(item.chats || 0),
        url: item.url || '',
        notes: item.notes || '',
        manychat_tag_id: item.manychat_tag_id || '',
        manychat_tag_name: item.manychat_tag_name || '',
      })
    } else {
      setForm({ fecha: new Date().toISOString().split('T')[0] })
    }
    setShowTagPicker(false)
    setTagSearch('')
  }, [item, open])

  const set = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }))

  const loadTags = async () => {
    if (!userId) return
    setMcLoading(true)
    try {
      const res = await fetch('/api/sync/manychat?action=tags', { headers: { 'X-User-Id': userId } })
      const data = await res.json()
      setMcTags(data.tags || [])
      setShowTagPicker(true)
    } catch { setMcTags([]) }
    setMcLoading(false)
  }

  const selectTag = async (tag: ManyChatTag) => {
    if (!userId) return
    set('manychat_tag_id', String(tag.id))
    set('manychat_tag_name', tag.name)
    setShowTagPicker(false)
    // Auto-sync chats count
    setMcSyncing(true)
    try {
      const res = await fetch(`/api/sync/manychat?action=sync_content_chats&tag_id=${tag.id}${item ? `&content_id=${item.id}` : ''}`, { headers: { 'X-User-Id': userId } })
      const data = await res.json()
      if (data.chats !== undefined) set('chats', String(data.chats))
    } catch { /* ignore */ }
    setMcSyncing(false)
  }

  const syncChats = async () => {
    const tagId = form.manychat_tag_id
    if (!tagId || !userId) return
    setMcSyncing(true)
    try {
      const res = await fetch(`/api/sync/manychat?action=sync_content_chats&tag_id=${tagId}${item ? `&content_id=${item.id}` : ''}`, { headers: { 'X-User-Id': userId } })
      const data = await res.json()
      if (data.chats !== undefined) set('chats', String(data.chats))
    } catch { /* ignore */ }
    setMcSyncing(false)
  }

  const unlinkTag = () => {
    set('manychat_tag_id', '')
    set('manychat_tag_name', '')
  }

  const filteredTags = tagSearch
    ? mcTags.filter(t => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
    : mcTags

  const fields: { key: string; label: string; type?: string; span?: number }[] = (() => {
    const base: { key: string; label: string; type?: string; span?: number }[] = [
      { key: 'title', label: contentType === 'video' ? 'Titulo del video' : 'Hook / Titulo', span: 2 },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      { key: 'url', label: 'Link' },
    ]
    if (contentType === 'historia') {
      base.push(
        { key: 'reach', label: 'Alcance (reach)', type: 'number' },
        { key: 'likes', label: 'Likes', type: 'number' },
        { key: 'comments', label: 'Comments', type: 'number' },
        { key: 'saves', label: 'Saves', type: 'number' },
        { key: 'shares', label: 'Shares', type: 'number' },
      )
    } else {
      base.push(
        { key: 'views', label: 'Views', type: 'number' },
        { key: 'likes', label: 'Likes', type: 'number' },
        { key: 'comments', label: 'Comments', type: 'number' },
        { key: 'saves', label: 'Saves', type: 'number' },
        { key: 'shares', label: 'Shares', type: 'number' },
        { key: 'reach', label: 'Reach', type: 'number' },
      )
    }
    base.push(
      { key: 'dolor', label: 'Dolor' },
      { key: 'angulos', label: 'Angulos (separar con coma)' },
      { key: 'cta', label: 'CTA' },
      { key: 'cash', label: 'Cash $', type: 'number' },
      { key: 'notes', label: 'Notas', span: 2 },
    )
    return base
  })()

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
              {f.label}
            </label>
            {f.key === 'notes' ? (
              <textarea
                value={form[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none resize-y focus:border-[var(--text3)]"
              />
            ) : (
              <input
                type={f.type || 'text'}
                value={form[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            )}
          </div>
        ))}
      </div>

      {/* ManyChat Tag Linking */}
      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">
          ManyChat — Etiqueta vinculada
        </div>
        {form.manychat_tag_name ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-[#22C55E30] bg-[#22C55E08] px-3 py-2">
              <div className="h-2 w-2 rounded-full bg-[#22C55E]" />
              <span className="text-[12px] font-medium text-[#22C55E]">{form.manychat_tag_name}</span>
              <span className="text-[11px] text-[var(--text3)] ml-auto">{form.chats || 0} chats</span>
            </div>
            <button onClick={syncChats} disabled={mcSyncing}
              className="rounded-lg border border-[var(--border2)] px-3 py-2 text-[11px] text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all disabled:opacity-50"
              title="Sincronizar chats desde ManyChat">
              {mcSyncing ? '...' : '↻'}
            </button>
            <button onClick={unlinkTag}
              className="rounded-lg border border-[var(--border2)] px-3 py-2 text-[11px] text-[var(--text3)] hover:border-[var(--red)] hover:text-[var(--red)] transition-all"
              title="Desvincular etiqueta">
              ×
            </button>
          </div>
        ) : (
          <button onClick={loadTags} disabled={mcLoading}
            className="w-full rounded-lg border border-dashed border-[var(--border2)] bg-transparent px-4 py-2.5 text-[11px] font-medium text-[var(--text2)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-faint)] disabled:opacity-50">
            {mcLoading ? 'Cargando etiquetas...' : '+ Vincular etiqueta de ManyChat'}
          </button>
        )}

        {/* Tag picker dropdown */}
        {showTagPicker && (
          <div className="mt-2 rounded-lg border border-[var(--border2)] bg-[var(--bg2)] overflow-hidden">
            <input
              type="text"
              placeholder="Buscar etiqueta..."
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              autoFocus
              className="w-full border-b border-[var(--border)] bg-transparent px-3 py-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text3)]"
            />
            <div className="max-h-48 overflow-y-auto">
              {filteredTags.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-[var(--text3)]">
                  {mcTags.length === 0 ? 'No se encontraron etiquetas' : 'Sin resultados'}
                </div>
              ) : (
                filteredTags.map(tag => (
                  <button key={tag.id} onClick={() => selectTag(tag)}
                    className="w-full text-left px-3 py-2 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)] hover:text-[var(--text)] transition-colors border-b border-[var(--border)] last:border-0">
                    {tag.name}
                  </button>
                ))
              )}
            </div>
            <button onClick={() => setShowTagPicker(false)}
              className="w-full px-3 py-2 text-[10px] text-[var(--text3)] hover:text-[var(--text2)] bg-[var(--bg3)] transition-colors">
              Cancelar
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] transition-all hover:border-[var(--text3)]"
        >
          Cancelar
        </button>
        <button
          onClick={() => onSave(form)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-white transition-all hover:opacity-90"
        >
          Guardar
        </button>
      </div>
    </Modal>
  )
}
