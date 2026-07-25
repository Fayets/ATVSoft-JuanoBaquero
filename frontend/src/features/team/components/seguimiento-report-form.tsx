'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { apiFetch } from '@/lib/api'

type Miembro = { id: number; nombre: string; rol: string }

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

function rolLabel(rol: string): string {
  if (rol === 'setter') return 'Setter'
  if (rol === 'closer') return 'Closer'
  if (rol === 'cash') return 'Cash'
  return rol
}

export function SeguimientoReportSection() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [members, setMembers] = useState<Miembro[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    date: today,
    memberId: '' as number | '',
    nombreLead: '',
    monto: '' as string | number,
  })

  const fetchMembers = useCallback(async () => {
    if (!ready || !userId) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/team/members')
      if (!res.ok) {
        setMembers([])
        return
      }
      const data = (await res.json()) as {
        setters?: { id: number; nombre: string; rol?: string }[]
        closers?: { id: number; nombre: string; rol?: string }[]
        cash?: { id: number; nombre: string; rol?: string }[]
      }
      const merged: Miembro[] = [
        ...(data.setters ?? []).map((m) => ({ id: m.id, nombre: m.nombre, rol: m.rol ?? 'setter' })),
        ...(data.closers ?? []).map((m) => ({ id: m.id, nombre: m.nombre, rol: m.rol ?? 'closer' })),
        ...(data.cash ?? []).map((m) => ({ id: m.id, nombre: m.nombre, rol: m.rol ?? 'cash' })),
      ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
      setMembers(merged)
    } catch {
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  useEffect(() => {
    const onChange = () => {
      void fetchMembers()
    }
    window.addEventListener('atvmkt-team-reports-changed', onChange)
    return () => window.removeEventListener('atvmkt-team-reports-changed', onChange)
  }, [fetchMembers])

  const handleSave = async () => {
    if (!userId || form.memberId === '') {
      toast('Seleccioná quién completa el reporte.')
      return
    }
    const nombre = form.nombreLead.trim()
    if (!nombre) {
      toast('Indicá el nombre del lead.')
      return
    }
    const montoNum = typeof form.monto === 'string' ? parseFloat(form.monto.replace(',', '.')) : Number(form.monto)
    if (!Number.isFinite(montoNum) || montoNum < 0) {
      toast('Indicá un monto válido.')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/team/seguimiento-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: form.memberId,
          fecha: form.date,
          nombre_lead: nombre,
          monto: montoNum,
        }),
      })
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        return
      }
      toast('Seguimiento guardado')
      setShowForm(false)
      setForm((f) => ({ ...f, nombreLead: '', monto: '' }))
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch {
      toast('No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  if (!ready || loading) {
    return (
      <div className="flex min-h-[100px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg3)] px-4 py-8 text-[13px] text-[var(--text3)]">
        <span
          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]"
          aria-hidden
        />
        <span className="mt-3">Cargando equipo…</span>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg3)] px-4 py-8 text-center text-[13px] text-[var(--text3)]">
        Iniciá sesión para cargar el formulario.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(230,57,70,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {showForm ? 'Cerrar' : '+ FORMULARIO'}
        </button>
      </div>

      {showForm && (
        <div className="glass-card glass-card--performant p-5">
          <div className="mb-4 text-[13px] font-semibold">Seguimiento — cobranza</div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                Quién completa el reporte
              </label>
              <select
                value={form.memberId === '' ? '' : String(form.memberId)}
                onChange={(e) => {
                  const v = e.target.value
                  setForm((f) => ({ ...f, memberId: v ? parseInt(v, 10) : '' }))
                }}
                className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              >
                <option value="">Seleccionar…</option>
                {members.length === 0 ? (
                  <option value="" disabled>
                    Sin miembros — cargá setters, closers o cash en Equipo
                  </option>
                ) : (
                  members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({rolLabel(m.rol)})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                Nombre del lead
              </label>
              <input
                type="text"
                value={form.nombreLead}
                onChange={(e) => setForm((f) => ({ ...f, nombreLead: e.target.value }))}
                placeholder="Nombre del lead"
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">Monto ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={form.monto === '' ? '' : form.monto}
                onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-[var(--border2)] px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] transition-all hover:bg-[var(--bg3)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded-xl bg-[var(--accent)] px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 disabled:opacity-50 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
