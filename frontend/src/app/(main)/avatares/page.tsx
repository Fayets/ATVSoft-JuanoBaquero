'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch, backendAuthHeaders, resolveBackendUserId } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

type AvatarRow = { id: number; nombre: string; color: string; activo: boolean; sort_order: number }

function isValidHexColor(s: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(s.trim())
}

export default function AvataresPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [avatars, setAvatars] = useState<AvatarRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6B7280')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#6B7280')
  const [busyId, setBusyId] = useState<number | null>(null)

  const fetchAvatars = useCallback(async () => {
    if (!ready) return
    if (!resolveBackendUserId()) {
      setAvatars([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/avatars', { headers: backendAuthHeaders() })
      const data = (await res.json().catch(() => ({}))) as { avatars?: AvatarRow[] }
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar avatares: ${detail}`)
        setAvatars([])
        return
      }
      setAvatars(Array.isArray(data.avatars) ? data.avatars : [])
    } finally {
      setLoading(false)
    }
  }, [ready, toast])

  useEffect(() => {
    void fetchAvatars()
  }, [fetchAvatars])

  const notifyAvatarsChanged = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('avatar-types-updated'))
    }
  }

  const addAvatar = async () => {
    const nombre = newName.trim()
    const color = newColor.trim()
    if (!nombre) {
      toast('Ingresá el nombre del avatar')
      return
    }
    if (!isValidHexColor(color)) {
      toast('Color inválido (usá formato #RRGGBB)')
      return
    }
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para guardar')
      return
    }
    setAdding(true)
    try {
      const res = await apiFetch('/avatars', {
        method: 'POST',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ nombre, color, activo: true }),
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
      setNewColor('#6B7280')
      await fetchAvatars()
      notifyAvatarsChanged()
      toast('Avatar creado')
    } finally {
      setAdding(false)
    }
  }

  const startEdit = (a: AvatarRow) => {
    setEditingId(a.id)
    setEditName(a.nombre)
    setEditColor(a.color || '#6B7280')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditColor('#6B7280')
  }

  const saveEdit = async () => {
    if (editingId == null) return
    const nombre = editName.trim()
    const color = editColor.trim()
    if (!nombre) {
      toast('El nombre no puede estar vacío')
      return
    }
    if (!isValidHexColor(color)) {
      toast('Color inválido (usá formato #RRGGBB)')
      return
    }
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para guardar')
      return
    }
    setBusyId(editingId)
    try {
      const res = await apiFetch(`/avatars/${editingId}`, {
        method: 'PATCH',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ nombre, color }),
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
      await fetchAvatars()
      notifyAvatarsChanged()
      toast('Cambios guardados')
    } finally {
      setBusyId(null)
    }
  }

  const toggleActivo = async (a: AvatarRow) => {
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para editar')
      return
    }
    setBusyId(a.id)
    try {
      const res = await apiFetch(`/avatars/${a.id}`, {
        method: 'PATCH',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ activo: !a.activo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo actualizar: ${detail}`)
        return
      }
      await fetchAvatars()
      notifyAvatarsChanged()
    } finally {
      setBusyId(null)
    }
  }

  const removeAvatar = async (id: number) => {
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para editar')
      return
    }
    setBusyId(id)
    try {
      const res = await apiFetch(`/avatars/${id}`, {
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
      await fetchAvatars()
      notifyAvatarsChanged()
      toast('Avatar eliminado')
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
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">Avatares</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Definí los perfiles de lead y su color en la grilla. Al entrar por primera vez se cargan los avatares
          estándar del sistema; podés editarlos, desactivarlos o eliminarlos, y agregar los tuyos.
          En Leads, la columna «Avatar» usa esta lista. Los inactivos no aparecen al asignar nuevos leads,
          pero se mantienen en filas que ya los tienen.
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]">
        <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
          Nuevo avatar
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[11px] text-[var(--text3)]">Nombre</span>
            <input
              type="text"
              value={newName}
              disabled={adding}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej. Creador de contenido"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="flex w-[160px] flex-col gap-1">
            <span className="text-[11px] text-[var(--text3)]">Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                disabled={adding}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-9 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
              />
              <input
                type="text"
                value={newColor}
                disabled={adding}
                onChange={(e) => setNewColor(e.target.value)}
                placeholder="#6B7280"
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-2 py-2 font-mono-num text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </label>
          <button
            type="button"
            disabled={adding}
            onClick={() => void addAvatar()}
            className="rounded-lg bg-[var(--auth-cta-bg)] px-5 py-2 text-[12px] font-semibold text-[var(--auth-cta-text)] hover:opacity-95 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border2)] bg-[var(--bg2)]">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg3)]">
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Avatar</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Color</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Activo</th>
              <th className="w-[220px] px-4 py-3 font-semibold text-[var(--text2)]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {avatars.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--text3)]">
                  Todavía no cargaste avatares. Agregá el primero arriba.
                </td>
              </tr>
            ) : (
              avatars.map((a) => {
                const isEdit = editingId === a.id
                const busy = busyId === a.id
                const swatchColor = isEdit ? editColor : a.color
                return (
                  <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
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
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: `${a.color}18`,
                            color: a.color,
                            border: `1px solid ${a.color}30`,
                          }}
                        >
                          {a.nombre}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEdit ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editColor}
                            disabled={busy}
                            onChange={(e) => setEditColor(e.target.value)}
                            className="h-8 w-9 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
                          />
                          <input
                            type="text"
                            value={editColor}
                            disabled={busy}
                            onChange={(e) => setEditColor(e.target.value)}
                            className="w-[100px] rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 font-mono-num text-[12px] outline-none"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-5 w-5 rounded-full border border-[var(--border)]"
                            style={{ backgroundColor: swatchColor }}
                          />
                          <span className="font-mono-num text-[12px] text-[var(--text2)]">{a.color}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={busy || isEdit}
                        onClick={() => void toggleActivo(a)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                          a.activo ? 'bg-[var(--green)]' : 'bg-[var(--border2)]'
                        }`}
                        aria-pressed={a.activo}
                        title={a.activo ? 'Activo' : 'Inactivo'}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            a.activo ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {isEdit ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void saveEdit()}
                            className="rounded-md bg-[var(--auth-cta-bg)] px-3 py-1.5 text-[11px] font-semibold text-[var(--auth-cta-text)] disabled:opacity-50"
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
                            onClick={() => startEdit(a)}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text2)] hover:bg-[var(--bg3)]"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeAvatar(a.id)}
                            className="rounded-md px-3 py-1.5 text-[11px] text-[var(--text2)] hover:underline"
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
