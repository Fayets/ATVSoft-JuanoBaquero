'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { Modal } from '@/shared/components/modal'
import { AddMemberForm } from '@/features/team/components/add-member-form'
import { apiFetch } from '@/lib/api'

type Member = { id: number; nombre: string; rol: string; activo: boolean }

function errMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d))
      return d
        .map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x)))
        .join(', ')
  }
  return 'Error en la solicitud'
}

function mergeMembers(
  setters: Member[],
  closers: Member[],
  cashMembers: Member[],
  triajers: Member[],
): Member[] {
  const order: Record<string, number> = { setter: 0, closer: 1, triajer: 2, cash: 3 }
  return [...setters, ...closers, ...triajers, ...cashMembers].sort((a, b) => {
    const oa = order[a.rol] ?? 9
    const ob = order[b.rol] ?? 9
    if (oa !== ob) return oa - ob
    return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
  })
}

export default function TeamEquipoEditPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Member[]>([])
  const [draft, setDraft] = useState<Record<number, { nombre: string }>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addRole, setAddRole] = useState<'setter' | 'closer' | 'triajer'>('setter')
  const [confirmDeleteMember, setConfirmDeleteMember] = useState<Member | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!ready || !userId) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/team/members')
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        setMembers([])
        return
      }
      const data = (await res.json()) as {
        setters?: Member[]
        closers?: Member[]
        cash?: Member[]
        triajers?: Member[]
      }
      const list = mergeMembers(
        data.setters ?? [],
        data.closers ?? [],
        data.cash ?? [],
        data.triajers ?? [],
      )
      setMembers(list)
      const d: Record<number, { nombre: string }> = {}
      for (const m of list) {
        d[m.id] = { nombre: m.nombre }
      }
      setDraft(d)
    } catch {
      toast('No se pudo cargar el equipo.')
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, toast])

  useEffect(() => {
    void load()
  }, [load])

  const handleAdd = async (name: string, role: string) => {
    if (!userId || !name.trim()) return
    const res = await apiFetch('/team/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: name.trim(), rol: role.toLowerCase() }),
    })
    if (!res.ok) {
      toast(errMessage(await res.json().catch(() => ({}))))
      return
    }
    toast('Miembro agregado')
    setShowAdd(false)
    void load()
    window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
  }

  const saveOne = async (id: number) => {
    const row = draft[id]
    if (!row || !userId) return
    if (!row.nombre.trim()) {
      toast('El nombre no puede estar vacío.')
      return
    }
    setSavingId(id)
    try {
      const res = await apiFetch(`/team/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: row.nombre.trim() }),
      })
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        return
      }
      toast('Miembro actualizado')
      void load()
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch {
      toast('No se pudo guardar.')
    } finally {
      setSavingId(null)
    }
  }

  const performDelete = async (m: Member) => {
    if (!userId) return
    setDeletingId(m.id)
    setDeleteSubmitting(true)
    try {
      const res = await apiFetch(`/team/members/${m.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        return
      }
      toast('Miembro eliminado')
      setConfirmDeleteMember(null)
      void load()
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch {
      toast('No se pudo eliminar.')
    } finally {
      setDeletingId(null)
      setDeleteSubmitting(false)
    }
  }

  if (!ready || loading) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando…</div>
  }

  if (!userId) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Iniciá sesión para editar el equipo.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Editar equipo</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setAddRole('setter')
              setShowAdd(true)
            }}
            className="rounded-lg border border-[var(--border2)] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            + Setter
          </button>
          <button
            type="button"
            onClick={() => {
              setAddRole('closer')
              setShowAdd(true)
            }}
            className="rounded-lg border border-[var(--border2)] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            + Closer
          </button>
          <button
            type="button"
            onClick={() => {
              setAddRole('triajer')
              setShowAdd(true)
            }}
            className="rounded-lg border border-[var(--border2)] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            + Triajer
          </button>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="text-[13px] text-[var(--text3)]">
          No hay miembros. Usá + Setter, + Closer o + Triajer para agregar.
        </p>
      ) : (
        <div className="glass-card glass-card--performant overflow-x-auto p-5">
          <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                <th className="py-2 pr-4">Rol</th>
                <th className="py-2 pr-4">Nombre</th>
                <th className="py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const d = draft[m.id] ?? { nombre: m.nombre }
                const dirty = d.nombre !== m.nombre
                const isSetter = m.rol === 'setter'
                const isCash = m.rol === 'cash'
                const isTriajer = m.rol === 'triajer'
                const busy = savingId === m.id || deletingId === m.id || confirmDeleteMember?.id === m.id
                return (
                  <tr key={m.id} className="border-b border-[var(--border2)] last:border-0">
                    <td className="py-3 pr-4 align-middle">
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                        style={{
                          backgroundColor: isCash
                            ? 'rgba(34,197,94,0.12)'
                            : isSetter
                              ? 'rgba(212,168,67,0.15)'
                              : isTriajer
                                ? 'rgba(59,130,246,0.14)'
                                : 'rgba(230,57,70,0.12)',
                          color: isCash
                            ? 'var(--green)'
                            : isSetter
                              ? '#d4a843'
                              : isTriajer
                                ? '#60a5fa'
                                : 'var(--accent)',
                        }}
                      >
                        {isCash ? 'Cash' : isSetter ? 'Setter' : isTriajer ? 'Triajer' : 'Closer'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 align-middle">
                      <input
                        type="text"
                        value={d.nombre}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [m.id]: { nombre: e.target.value },
                          }))
                        }
                        disabled={busy}
                        className="w-full max-w-xs rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--text3)] disabled:opacity-50"
                      />
                    </td>
                    <td className="py-3 align-middle">
                      <div className="flex w-full flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmDeleteMember(m)}
                          className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--red)] transition-all hover:border-[var(--red)] hover:bg-[rgba(239,68,68,0.08)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {deletingId === m.id ? 'Eliminando…' : 'Eliminar'}
                        </button>
                        <button
                          type="button"
                          disabled={!dirty || busy}
                          onClick={() => void saveOne(m.id)}
                          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {savingId === m.id ? 'Guardando…' : 'Guardar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={`Agregar ${addRole === 'setter' ? 'Setter' : 'Closer'}`} maxWidth="400px">
        <AddMemberForm
          role={addRole === 'setter' ? 'Setter' : 'Closer'}
          onAdd={handleAdd}
          onCancel={() => setShowAdd(false)}
        />
      </Modal>

      <Modal
        open={confirmDeleteMember !== null}
        onClose={() => {
          if (!deleteSubmitting) setConfirmDeleteMember(null)
        }}
        title="Eliminar miembro"
        maxWidth="400px"
        compact
      >
        {confirmDeleteMember && (
          <div>
            <p className="mb-3 text-[13px] leading-snug text-[var(--text)]">
              ¿Seguro que querés eliminar a{' '}
              <span className="font-semibold">{confirmDeleteMember.nombre}</span> (
              {confirmDeleteMember.rol === 'setter'
                ? 'setter'
                : confirmDeleteMember.rol === 'cash'
                  ? 'cash'
                  : 'closer'})?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteSubmitting}
                onClick={() => setConfirmDeleteMember(null)}
                className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteSubmitting}
                onClick={() => void performDelete(confirmDeleteMember)}
                className="rounded-lg bg-[var(--red)] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-all hover:brightness-110 disabled:opacity-50"
              >
                {deleteSubmitting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
