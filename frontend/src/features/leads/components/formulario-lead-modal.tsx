'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/shared/components/modal'
import {
  FORMULARIO_KEYS,
  FORMULARIO_LABELS,
  type Lead,
  type LeadFormulario,
  normalizeFormulario,
} from '../types'

type Props = {
  open: boolean
  lead: Lead | null
  readOnly?: boolean
  saving?: boolean
  onClose: () => void
  onSave: (formulario: LeadFormulario) => Promise<void>
}

export function FormularioLeadModal({
  open,
  lead,
  readOnly,
  saving,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<LeadFormulario>(normalizeFormulario(null))

  useEffect(() => {
    if (open && lead) {
      setDraft(normalizeFormulario(lead.formulario))
    }
  }, [open, lead])

  if (!lead) return null

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose()
      }}
      title={`Formulario — ${(lead.client_name || 'Lead').toUpperCase()}`}
      maxWidth="560px"
      compact
    >
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
        {FORMULARIO_KEYS.map((key) => (
          <label key={key} className="block">
            <span className="mb-1 block text-[11px] font-medium leading-snug text-[var(--text2)]">
              {FORMULARIO_LABELS[key]}
            </span>
            {readOnly ? (
              <p className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-2 text-[13px] text-[var(--text)]">
                {draft[key] || '—'}
              </p>
            ) : (
              <textarea
                value={draft[key]}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                }
                rows={2}
                className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            )}
          </label>
        ))}
      </div>
      {!readOnly && (
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-[var(--text2)] hover:bg-[var(--bg2)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSave(draft)}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}
    </Modal>
  )
}
