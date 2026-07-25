'use client'

import { useEffect, useRef, useState } from 'react'
import { useTimezone } from '@/shared/hooks/use-timezone'
import { TIMEZONE_OPTIONS } from '@/shared/lib/timezone'

export function TimezoneSelector() {
  const { option, timeZone, saving, setTimezone } = useTimezone()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={saving}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2.5 text-[15px] leading-none text-[var(--text)] transition-colors hover:border-[var(--border)] hover:bg-[var(--nav-hover)] disabled:opacity-50"
        aria-label={`Timezone: ${option.label}`}
        aria-expanded={open}
        title={`${option.label} (${option.timeZone})`}
      >
        <span aria-hidden="true">{option.flag}</span>
        <span className="hidden text-[11px] font-medium text-[var(--text2)] sm:inline">
          {option.label}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-[var(--text3)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[240px] overflow-hidden rounded-xl border border-[var(--border2)] bg-[var(--bg2)] py-1 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.55)]"
        >
          {TIMEZONE_OPTIONS.map((opt) => {
            const active = opt.timeZone === timeZone
            return (
              <button
                key={opt.timeZone}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  void setTimezone(opt.timeZone)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors ${
                  active
                    ? 'bg-[rgba(220,60,70,0.12)] text-[var(--text)]'
                    : 'text-[var(--text2)] hover:bg-[var(--nav-hover)] hover:text-[var(--text)]'
                }`}
              >
                <span className="text-[16px] leading-none" aria-hidden>
                  {opt.flag}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-[var(--text)]">{opt.label}</span>
                  <span className="truncate font-mono-num text-[10px] text-[var(--text3)]">
                    {opt.timeZone}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
