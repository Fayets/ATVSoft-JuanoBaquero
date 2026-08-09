'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch, backendAuthHeaders, resolveBackendUserId } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

type ProgramRow = { id: number; name: string; price_usd: number; duration_months?: number | null; sort_order: number }

function formatUsd(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function ProgramasPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [programs, setPrograms] = useState<ProgramRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDuration, setEditDuration] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const fetchPrograms = useCallback(async () => {
    if (!ready) return
    if (!resolveBackendUserId()) {
      setPrograms([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/programs', { headers: backendAuthHeaders() })
      const data = (await res.json().catch(() => ({}))) as { programs?: ProgramRow[] }
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar programas: ${detail}`)
        setPrograms([])
        return
      }
      setPrograms(Array.isArray(data.programs) ? data.programs : [])
    } finally {
      setLoading(false)
    }
  }, [ready, toast])

  useEffect(() => {
    void fetchPrograms()
  }, [fetchPrograms])

  const notifyProgramsChanged = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('offered-programs-updated'))
    }
  }

  const addProgram = async () => {
    const name = newName.trim()
    const price = Number(String(newPrice).replace(',', '.'))
    const durRaw = newDuration.trim()
    const duration_months = durRaw ? Number(durRaw) : undefined
    if (!name) {
      toast('Ingresá el nombre del programa')
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      toast('Precio inválido')
      return
    }
    if (durRaw && (!Number.isFinite(duration_months!) || duration_months! < 1)) {
      toast('Duración inválida (meses)')
      return
    }
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para guardar')
      return
    }
    setAdding(true)
    try {
      const res = await apiFetch('/programs', {
        method: 'POST',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name,
          price_usd: price,
          ...(duration_months ? { duration_months } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo crear: ${detail}`)
        return
      }
      setNewName('')
      setNewPrice('')
      setNewDuration('')
      await fetchPrograms()
      notifyProgramsChanged()
      toast('Programa creado')
    } finally {
      setAdding(false)
    }
  }

  const startEdit = (p: ProgramRow) => {
    setEditingId(p.id)
    setEditName(p.name)
    setEditPrice(String(p.price_usd))
    setEditDuration(p.duration_months ? String(p.duration_months) : '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditPrice('')
    setEditDuration('')
  }

  const saveEdit = async () => {
    if (editingId == null) return
    const name = editName.trim()
    const price = Number(String(editPrice).replace(',', '.'))
    const durRaw = editDuration.trim()
    const duration_months = durRaw ? Number(durRaw) : null
    if (!name) {
      toast('El nombre no puede estar vacío')
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      toast('Precio inválido')
      return
    }
    if (durRaw && (!Number.isFinite(duration_months!) || duration_months! < 1)) {
      toast('Duración inválida (meses)')
      return
    }
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para guardar')
      return
    }
    setBusyId(editingId)
    try {
      const res = await apiFetch(`/programs/${editingId}`, {
        method: 'PATCH',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name,
          price_usd: price,
          duration_months: durRaw ? duration_months : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo guardar: ${detail}`)
        return
      }
      cancelEdit()
      await fetchPrograms()
      notifyProgramsChanged()
      toast('Cambios guardados')
    } finally {
      setBusyId(null)
    }
  }

  const removeProgram = async (id: number) => {
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para editar')
      return
    }
    setBusyId(id)
    try {
      const res = await apiFetch(`/programs/${id}`, {
        method: 'DELETE',
        headers: backendAuthHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo eliminar: ${detail}`)
        return
      }
      if (editingId === id) cancelEdit()
      await fetchPrograms()
      notifyProgramsChanged()
      toast('Programa eliminado')
    } finally {
      setBusyId(null)
    }
  }

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">Programas</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Definí cada oferta con su precio en USD. En Leads, la columna «Prog. ofrecido» usa esta lista; el panel de
          ventas usa estos importes como facturación por cierre. La duración en meses alimenta el CRM de clientes.
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]">
        <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
          Nuevo programa
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[11px] text-[var(--text3)]">Nombre</span>
            <input
              type="text"
              value={newName}
              disabled={adding}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej. Mentoria"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="flex w-[140px] flex-col gap-1">
            <span className="text-[11px] text-[var(--text3)]">Precio USD</span>
            <input
              type="text"
              inputMode="decimal"
              value={newPrice}
              disabled={adding}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="1000"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 font-mono-num text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="flex w-[100px] flex-col gap-1">
            <span className="text-[11px] text-[var(--text3)]">Meses</span>
            <input
              type="text"
              inputMode="numeric"
              value={newDuration}
              disabled={adding}
              onChange={(e) => setNewDuration(e.target.value)}
              placeholder="6"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 font-mono-num text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="button"
            disabled={adding}
            onClick={() => void addProgram()}
            className="rounded-lg bg-[var(--accent)] px-5 py-2 text-[12px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border2)] bg-[var(--bg2)]">
        <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg3)]">
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Programa</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Precio</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Meses</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)] w-[200px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {programs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--text3)]">
                  Todavía no cargaste programas. Agregá el primero arriba.
                </td>
              </tr>
            ) : (
              programs.map((p) => {
                const isEdit = editingId === p.id
                const busy = busyId === p.id
                return (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--text)]">
                      {isEdit ? (
                        <input
                          type="text"
                          value={editName}
                          disabled={busy}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full max-w-[280px] rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 text-[13px] outline-none"
                        />
                      ) : (
                        <span className="font-medium">{p.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[var(--text2)]">
                      {isEdit ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editPrice}
                          disabled={busy}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-[120px] rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 text-[13px] outline-none"
                        />
                      ) : (
                        formatUsd(p.price_usd)
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[var(--text2)]">
                      {isEdit ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editDuration}
                          disabled={busy}
                          onChange={(e) => setEditDuration(e.target.value)}
                          className="w-[72px] rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 text-[13px] outline-none"
                        />
                      ) : (
                        p.duration_months ? `${p.duration_months}` : '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEdit ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void saveEdit()}
                            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={cancelEdit}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text2)] hover:bg-[var(--bg3)]"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => startEdit(p)}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text2)] hover:bg-[var(--bg3)]"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeProgram(p.id)}
                            className="rounded-md px-3 py-1.5 text-[11px] text-[var(--red)] hover:underline"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
