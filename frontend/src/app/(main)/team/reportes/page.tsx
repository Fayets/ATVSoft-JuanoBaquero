'use client'

import { DailyReportSection } from '@/features/team/components/daily-report-form'
import { SeguimientoReportSection } from '@/features/team/components/seguimiento-report-form'

function SetterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth={1.65}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  )
}

function CloserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth={1.65}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
      />
    </svg>
  )
}

function SeguimientoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth={1.65}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  )
}

export default function ReportesPage() {
  return (
    <div className="relative flex min-h-[calc(100dvh-10rem)] flex-col pb-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-15%,rgba(230,57,70,0.14),transparent_65%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_85%_95%,rgba(139,92,246,0.09),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_35%_at_10%_75%,rgba(59,130,246,0.06),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.22] [mask-image:linear-gradient(to_bottom,black_20%,transparent_92%)]"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
      </div>

      <header className="relative mb-8 max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">Equipo</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-[26px]">
          Carga de reportes
        </h1>
      </header>

      <div className="relative w-full max-w-[90rem]">
        <div className="overflow-hidden rounded-3xl border border-[var(--border2)] bg-[var(--bg2)] shadow-[var(--shadow-lg)] ring-1 ring-[rgba(255,255,255,0.03)]">
          <div className="grid divide-[var(--border)] lg:grid-cols-3 lg:divide-x">
            <section className="p-5 sm:p-6 lg:p-7" aria-labelledby="reportes-setter-heading">
              <div className="mb-5 flex items-center gap-3 sm:gap-4">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(59,130,246,0.12)] text-[rgba(96,165,250,0.95)] ring-1 ring-[rgba(59,130,246,0.28)]"
                  aria-hidden
                >
                  <SetterIcon className="h-[22px] w-[22px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id="reportes-setter-heading"
                    className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]"
                  >
                    Setter
                  </h2>
                </div>
              </div>
              <DailyReportSection role="setter" />
            </section>

            <section className="p-5 sm:p-6 lg:p-7" aria-labelledby="reportes-closer-heading">
              <div className="mb-5 flex items-center gap-3 sm:gap-4">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(139,92,246,0.14)] text-[rgba(192,181,253,0.98)] ring-1 ring-[rgba(139,92,246,0.35)]"
                  aria-hidden
                >
                  <CloserIcon className="h-[22px] w-[22px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id="reportes-closer-heading"
                    className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]"
                  >
                    Closer
                  </h2>
                </div>
              </div>
              <DailyReportSection role="closer" />
            </section>

            <section className="p-5 sm:p-6 lg:p-7" aria-labelledby="reportes-seguimiento-heading">
              <div className="mb-5 flex items-center gap-3 sm:gap-4">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(16,185,129,0.14)] text-[rgba(52,211,153,0.98)] ring-1 ring-[rgba(16,185,129,0.38)]"
                  aria-hidden
                >
                  <SeguimientoIcon className="h-[22px] w-[22px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id="reportes-seguimiento-heading"
                    className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]"
                  >
                    Seguimiento
                  </h2>
                </div>
              </div>
              <SeguimientoReportSection />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
