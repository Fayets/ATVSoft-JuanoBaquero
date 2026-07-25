'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch, backendAuthHeaders, resolveBackendUserId } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

const CATEGORIES = [
  { key: 'dolores', label: 'Dolores' },
  { key: 'angulos', label: 'Angulos' },
  { key: 'ctas', label: 'CTAs' },
] as const

export default function ListasMaestrasPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [lists, setLists] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)

  const fetchLists = useCallback(async () => {
    if (!ready) return
    if (!resolveBackendUserId()) {
      setLists({ dolores: [], angulos: [], ctas: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/master-lists', {
        headers: backendAuthHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof data === 'object' && data && 'detail' in data ? String((data as { detail: unknown }).detail) : res.statusText
        toast(`Error al cargar listas: ${detail}`)
      } else {
        const norm = (v: unknown): string[] => {
          if (!Array.isArray(v)) return []
          return v.map((x) => String(x ?? '').trim()).filter(Boolean)
        }
        setLists({
          dolores: norm(data.dolores),
          angulos: norm(data.angulos),
          ctas: norm(data.ctas),
        })
      }
    } finally {
      setLoading(false)
    }
  }, [ready, toast])

  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  const applyListsResponse = (data: Record<string, unknown>) => {
    const norm = (v: unknown): string[] => {
      if (!Array.isArray(v)) return []
      return v.map((x) => String(x ?? '').trim()).filter(Boolean)
    }
    setLists({
      dolores: norm(data.dolores),
      angulos: norm(data.angulos),
      ctas: norm(data.ctas),
    })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('master-lists-updated'))
    }
  }

  const addItem = async (category: string, value: string) => {
    const clean = value.trim()
    if (!clean) return
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para guardar listas')
      return
    }
    const current = lists[category] || []
    if (current.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      toast('Ya existe')
      return
    }
    const res = await apiFetch(`/master-lists/${encodeURIComponent(category)}`, {
      method: 'POST',
      headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ item: clean }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof data === 'object' && data && 'detail' in data ? String((data as { detail: unknown }).detail) : res.statusText
      toast(`Error al agregar: ${detail}`)
      return
    }
    applyListsResponse(data as Record<string, unknown>)
    toast('Guardado')
  }

  const removeItem = async (category: string, value: string) => {
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para editar listas')
      return
    }
    const res = await apiFetch(
      `/master-lists/${encodeURIComponent(category)}/${encodeURIComponent(value)}`,
      { method: 'DELETE', headers: backendAuthHeaders() },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof data === 'object' && data && 'detail' in data ? String((data as { detail: unknown }).detail) : res.statusText
      toast(`Error al eliminar: ${detail}`)
      return
    }
    applyListsResponse(data as Record<string, unknown>)
  }

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">Listas Maestras</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Dolores, ángulos y CTAs para clasificar contenido. Se guardan al instante.
        </p>
      </div>

      <div className="space-y-6">
        {CATEGORIES.map((cat) => {
          const items = lists[cat.key] || []
          return (
            <div
              key={cat.key}
              className="rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]"
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
                  {cat.label}
                </h3>
                <span
                  className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-[var(--bg4)] px-2 font-mono-num text-[11px] font-medium text-[var(--text3)]"
                  aria-label={`${items.length} items`}
                >
                  {items.length}
                </span>
              </div>

              <div className="mb-5 flex flex-wrap gap-2">
                {items.map((item, idx) => (
                  <span
                    key={`${cat.key}-${idx}-${item}`}
                    className="inline-flex max-w-full items-center gap-2 rounded-xl bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)]"
                  >
                    <span className="min-w-0 truncate">{item}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(cat.key, item)}
                      className="shrink-0 text-[14px] leading-none text-[var(--text3)] hover:text-[var(--red)]"
                      aria-label={`Quitar ${item}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <AddItemInput onAdd={(val) => addItem(cat.key, val)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AddItemInput({ onAdd }: { onAdd: (val: string) => void | Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const v = value.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      await onAdd(v)
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full gap-2">
      <input
        type="text"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="Agregar nuevo..."
        className="min-w-0 flex-1 rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-[13px] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text3)] focus:border-[var(--accent)]/60 focus:ring-1 focus:ring-[var(--accent)]/20 disabled:opacity-50"
      />
      <button
        type="button"
        disabled={busy || !value.trim()}
        onClick={() => void submit()}
        className="shrink-0 rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text)] transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:pointer-events-none disabled:opacity-40"
      >
        Agregar
      </button>
    </div>
  )
}
