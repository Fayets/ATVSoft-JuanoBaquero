'use client'

import type { ReactNode } from 'react'
import type { CallReport } from '../types'
import { formatCallReportError } from '../lib/claude-status'
import { reanalyzeCallReport, sendCallReportToDiscord } from '../services/call-reports-service'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { downloadCallReport } from '../services/call-reports-service'
import { DiscordIcon } from './discord-icon'

type Props = {
  report: CallReport
  onBusy?: (busy: boolean) => void
  onError?: (msg: string) => void
  onSuccess?: (msg: string) => void
  onReanalyze?: () => void
}

const MAX_SUMMARY_BULLETS = 4
const MAX_SUMMARY_LINE_CHARS = 120

/** Vista compacta: veredicto + bullets clave, sin citas literales largas. */
function summarizeFieldForDisplay(text: string): { body: string; trimmed: boolean } {
  const lines = text.split(/\n/).map((l) => l.trimEnd())
  if (lines.length === 0) return { body: '', trimmed: false }

  const verdict = (lines[0] || '').trim()
  const rest = lines.slice(1)
  const kept: string[] = []
  let dropped = 0

  for (const line of rest) {
    const t = line.trim()
    if (!t) continue

    const isBullet = /^[-•*]\s+/.test(t)
    const bulletBody = isBullet ? t.replace(/^[-•*]\s+/, '').trim() : t

    // Citas literales de la transcripción → solo en PDF
    if (/^cita\s*:/i.test(bulletBody)) {
      dropped++
      continue
    }
    if (/^["'«].{40,}/.test(bulletBody) && !bulletBody.includes(':')) {
      dropped++
      continue
    }

    let out = bulletBody
    if (out.length > MAX_SUMMARY_LINE_CHARS) {
      out = `${out.slice(0, MAX_SUMMARY_LINE_CHARS - 1)}…`
      dropped++
    }

    if (isBullet) kept.push(`- ${out}`)
    else if (/^(superficie|real|evidencia|patrones|mejoras|lead|closer)\s*:/i.test(t)) {
      kept.push(t)
    } else {
      kept.push(out)
    }
  }

  const limited = kept.slice(0, MAX_SUMMARY_BULLETS)
  const trimmed = dropped > 0 || kept.length > MAX_SUMMARY_BULLETS

  const body = [verdict, ...(limited.length ? ['', ...limited] : [])].join('\n').trim()
  return { body, trimmed }
}

function FieldBlock({
  label,
  value,
  compact = true,
}: {
  label: string
  value: string | null | undefined
  compact?: boolean
}) {
  const raw = (value || '').trim()
  if (!raw) return null

  const { body, trimmed } = compact ? summarizeFieldForDisplay(raw) : { body: raw, trimmed: false }
  if (!body) return null

  const lines = body.split(/\n/).map((l) => l.trimEnd())
  const verdict = lines[0]?.trim() || ''
  const rest = lines.slice(1)

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg2)]/60 px-3 py-2 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">{label}</div>
      {verdict ? (
        <div className="text-[13px] font-medium leading-snug text-[var(--text)]">{verdict}</div>
      ) : null}
      {rest.length > 0 ? (
        <div className="space-y-1">
          {rest.map((line, i) => {
            if (!line.trim()) return null
            const bullet = /^[-•*]\s+/.test(line.trim())
            const sublabel = /^(superficie|real|evidencia|patrones|mejoras|lead|closer)\s*:/i.test(
              line.trim(),
            )
            if (bullet) {
              return (
                <div key={i} className="flex gap-2 text-[12px] leading-snug text-[var(--text2)]">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{line.trim().replace(/^[-•*]\s+/, '')}</span>
                </div>
              )
            }
            if (sublabel) {
              return (
                <div
                  key={i}
                  className="pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]"
                >
                  {line.trim()}
                </div>
              )
            }
            return (
              <p key={i} className="text-[12px] leading-snug text-[var(--text2)]">
                {line}
              </p>
            )
          })}
        </div>
      ) : null}
      {trimmed && compact ? (
        <p className="text-[10px] text-[var(--text3)]">Detalle completo en el PDF.</p>
      ) : null}
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="border-b border-[var(--border)] pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text)]">
      {children}
    </div>
  )
}

function HeaderItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">{label}</div>
      <div className="mt-0.5 break-words text-[13px] text-[var(--text)]">{value || '—'}</div>
    </div>
  )
}

function hasNewFormat(report: CallReport): boolean {
  return Boolean(
    (report.nivel_dolor || '').trim() ||
      (report.capacidad_decision || '').trim() ||
      (report.capacidad_economica || '').trim() ||
      (report.fit_real || '').trim() ||
      (report.objecion_diagnostico || '').trim() ||
      (report.cambio_energia || '').trim() ||
      (report.objecion_no_manejada || '').trim() ||
      (report.razon_real_no_cerrar || '').trim() ||
      (report.compromisos_prometidos || '').trim() ||
      (report.patrones_y_mejoras || '').trim(),
  )
}

export function CallReportDetail({ report, onBusy, onError, onSuccess, onReanalyze }: Props) {
  if (report.estado === 'error') {
    return (
      <div className="space-y-3 rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 p-4">
        <p className="text-[13px] text-[var(--red)]">
          {formatCallReportError(report.error_msg)}
        </p>
        <button
          type="button"
          className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)]"
          onClick={() => {
            onBusy?.(true)
            void reanalyzeCallReport(report.id)
              .then(() => onReanalyze?.())
              .catch((e) =>
                onError?.(e instanceof Error ? e.message : 'No se pudo reintentar el análisis.'),
              )
              .finally(() => onBusy?.(false))
          }}
        >
          Reintentar análisis
        </button>
      </div>
    )
  }

  if (report.estado === 'pendiente' || report.estado === 'procesando') {
    return (
      <div className="py-3 text-[13px] text-[var(--text3)]">
        {report.estado === 'procesando'
          ? 'Analizando la llamada con Claude…'
          : 'En cola para análisis…'}
      </div>
    )
  }

  const legacyResumen =
    (report.resumen || '').trim() || (report.closer_report || '').trim() || null
  const useNew = hasNewFormat(report)

  async function handleDownload() {
    onBusy?.(true)
    try {
      await downloadCallReport(report.id)
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Error al descargar.')
    } finally {
      onBusy?.(false)
    }
  }

  async function handleSendDiscord() {
    onBusy?.(true)
    try {
      await sendCallReportToDiscord(report.id)
      onSuccess?.('Análisis enviado a Discord.')
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'No se pudo enviar a Discord.')
    } finally {
      onBusy?.(false)
    }
  }

  return (
    <div className="space-y-4 border-t border-[var(--border)] pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)]"
          onClick={() => void handleDownload()}
        >
          Descargar PDF
        </button>
        <button
          type="button"
          title="Enviar análisis a Discord"
          className="inline-flex items-center gap-1.5 rounded-md border border-[#5865F2]/40 bg-[#5865F2]/10 px-3 py-1.5 text-[12px] font-medium text-[#5865F2] transition-colors hover:border-[#5865F2] hover:bg-[#5865F2]/20"
          onClick={() => void handleSendDiscord()}
        >
          <DiscordIcon className="h-3.5 w-3.5" />
          Discord
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <HeaderItem label="Fecha" value={formatReportDate(report.created_at)} />
        <HeaderItem label="Lead" value={report.lead_nombre || 'Sin nombre'} />
        <HeaderItem
          label="Grabación"
          value={
            report.fathom_url ? (
              <a
                href={report.fathom_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                ↗ Fathom
              </a>
            ) : (
              '—'
            )
          }
        />
        <HeaderItem label="Participantes" value={(report.participantes || '').trim() || '—'} />
        <HeaderItem
          label="Motivo"
          value={(report.motivo_reunion || '').trim() || '—'}
        />
      </div>

      {useNew ? (
        <>
          <div className="space-y-2">
            <SectionTitle>Calificación del lead</SectionTitle>
            <div className="grid gap-2 lg:grid-cols-2">
              <FieldBlock label="Nivel de dolor" value={report.nivel_dolor} />
              <FieldBlock label="Capacidad de decisión" value={report.capacidad_decision} />
              <FieldBlock label="Capacidad económica" value={report.capacidad_economica} />
              <FieldBlock label="Fit real" value={report.fit_real} />
              <FieldBlock label="Objeción real vs superficie" value={report.objecion_diagnostico} />
            </div>
          </div>
          <div className="space-y-2">
            <SectionTitle>Coaching de la llamada</SectionTitle>
            <div className="grid gap-2 lg:grid-cols-2">
              <FieldBlock label="Cambio de energía" value={report.cambio_energia} />
              <FieldBlock label="Objeción no manejada" value={report.objecion_no_manejada} />
              <FieldBlock label="Razón real de no cerrar" value={report.razon_real_no_cerrar} />
            </div>
          </div>
          <div className="space-y-2">
            <SectionTitle>Trazabilidad y mejora</SectionTitle>
            <div className="grid gap-2 lg:grid-cols-2">
              <FieldBlock label="Compromisos prometidos" value={report.compromisos_prometidos} />
              <FieldBlock label="Patrones y mejora" value={report.patrones_y_mejoras} />
            </div>
          </div>
        </>
      ) : (
        <>
          <FieldBlock label="Resumen de la reunión" value={legacyResumen} />
          <FieldBlock label="¿Hubo objeciones en la llamada?" value={report.hubo_objeciones} />
          <FieldBlock label="¿Qué tipo de perfil tiene el lead?" value={report.tipo_perfil} />
          <FieldBlock label="Ingresos estimados del lead" value={report.ingresos_estimados} />
          <FieldBlock
            label="¿Qué situación puntual está viviendo y qué le gustaría vivir en los próximos 3 meses?"
            value={report.situacion_y_deseo}
          />
        </>
      )}
    </div>
  )
}

export function formatReportDate(iso: string | null | undefined): string {
  return formatIsoDateDdMmYyyy(iso || '') || '—'
}

/** Prefijo calendario `YYYY-MM-DD` desde `created_at` (ISO o fecha suelta). */
export function callReportDateKey(iso: string | null | undefined): string {
  const s = String(iso || '').trim()
  if (!s) return ''
  const head = s.includes('T') ? s.split('T')[0]! : s.split(' ')[0]!
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : ''
}
