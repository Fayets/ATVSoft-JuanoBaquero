'use client'

import { useEffect, useRef } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  maxWidth?: string
  /** Menos padding y menos aire bajo el título (confirmaciones cortas). */
  compact?: boolean
}

export function Modal({ open, onClose, title, children, maxWidth = '620px', compact = false }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/70 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className={`modal-panel relative w-full max-h-[min(90vh,860px)] overflow-y-auto overflow-x-hidden accent-top ${
          compact ? 'p-4 sm:p-5' : 'p-6 sm:p-8'
        }`}
        style={{ maxWidth: `min(${maxWidth}, calc(100vw - 2rem))` }}
      >
        <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-6'}`}>
          <h3 className="text-[11px] font-medium uppercase tracking-widest text-[var(--accent)] opacity-85">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(255,255,255,0.06)] text-[var(--text3)] transition-all hover:bg-[rgba(230,57,70,0.2)] hover:text-[var(--accent)]"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
