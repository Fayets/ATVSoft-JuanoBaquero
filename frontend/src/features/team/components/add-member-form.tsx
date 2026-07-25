'use client'

import { useState } from 'react'

type Props = {
  role: string
  onAdd: (name: string, role: string) => void | Promise<void>
  onCancel: () => void
}

export function AddMemberForm({ role, onAdd, onCancel }: Props) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Nombre</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        placeholder={`Nombre del ${role}`}
        className="mb-4 w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)]"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => {
            void (async () => {
              setPending(true)
              try {
                await onAdd(name, role)
              } finally {
                setPending(false)
              }
            })()
          }}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Agregar'}
        </button>
      </div>
    </div>
  )
}
