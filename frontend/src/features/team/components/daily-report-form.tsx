'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'

type TeamMemberOption = { id: number; nombre: string }

type DailyReport = {
  date: string
  memberId: number | ''
  conversaciones: number
  agendas: number
  calendly_links: number
  calls_scheduled: number
  shows: number
  cierres: number
  calificados: number
  descalificados: number
  ingreso: number
  notes: string
  sentimiento_trafico: string
  avatar_counts: Record<string, number>
  insights_marketing: string
  seguimientos: number
  outbounds: number
  dia_bueno_malo: string
}

const SETTER_AVATAR_OPTIONS = [
  'Experto en info',
  'Dueño de agencia',
  'Dueño de negocio',
  'Habilidades de alto valor',
  'Creador de contenido',
  'Creador con infoproducto',
  'Otro',
] as const

function emptyAvatarCounts(): Record<string, number> {
  return Object.fromEntries(SETTER_AVATAR_OPTIONS.map((a) => [a, 0]))
}

function serializeAvatarCounts(counts: Record<string, number>): string | null {
  const obj: Record<string, number> = {}
  for (const [k, v] of Object.entries(counts)) {
    const n = parseInt(String(v), 10) || 0
    if (n > 0) obj[k] = n
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : null
}

type Props = {
  role: 'setter' | 'closer'
}

type NumKey =
  | 'conversaciones'
  | 'agendas'
  | 'calendly_links'
  | 'seguimientos'
  | 'outbounds'
  | 'calls_scheduled'
  | 'shows'
  | 'cierres'
  | 'calificados'
  | 'descalificados'
  | 'ingreso'

function errMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d))
      return d
        .map((x) =>
          typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x),
        )
        .join(', ')
  }
  return 'Error en la solicitud'
}

export function DailyReportSection({ role }: Props) {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [members, setMembers] = useState<TeamMemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [setterSavedStamp, setSetterSavedStamp] = useState<string | null>(null)
  const [closerPreviewLoading, setCloserPreviewLoading] = useState(false)
  const [closerGenerating, setCloserGenerating] = useState(false)
  const [closerGeneratedStamp, setCloserGeneratedStamp] = useState<string | null>(null)
  const [closerPreview, setCloserPreview] = useState({
    calls_scheduled: 0,
    shows: 0,
    cierres: 0,
    calificados: 0,
    descalificados: 0,
    ingreso: 0,
  })

  const today = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState<DailyReport>({
    date: today,
    memberId: '',
    conversaciones: 0,
    agendas: 0,
    calendly_links: 0,
    calls_scheduled: 0,
    shows: 0,
    cierres: 0,
    calificados: 0,
    descalificados: 0,
    ingreso: 0,
    notes: '',
    sentimiento_trafico: '',
    avatar_counts: emptyAvatarCounts(),
    insights_marketing: '',
    seguimientos: 0,
    outbounds: 0,
    dia_bueno_malo: '',
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
        toast(errMessage(await res.json().catch(() => ({}))))
        setMembers([])
        return
      }
      const data = (await res.json()) as {
        setters: { id: number; nombre: string }[]
        closers: { id: number; nombre: string }[]
      }
      const list = role === 'setter' ? data.setters ?? [] : data.closers ?? []
      setMembers(list.map((m) => ({ id: m.id, nombre: m.nombre })))
    } catch {
      toast('No se pudo cargar el equipo.')
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, role, toast])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const fetchCloserPreview = useCallback(async () => {
    if (role !== 'closer' || !userId || form.memberId === '') return
    setCloserPreviewLoading(true)
    try {
      const q = new URLSearchParams({
        member_id: String(form.memberId),
        fecha: form.date,
      })
      const res = await apiFetch(`/team/closer-reports/preview?${q}`)
      if (!res.ok) {
        setCloserPreview({
          calls_scheduled: 0,
          shows: 0,
          cierres: 0,
          calificados: 0,
          descalificados: 0,
          ingreso: 0,
        })
        return
      }
      const data = (await res.json()) as {
        llamadas_agendadas?: number
        shows?: number
        cierres?: number
        calificados?: number
        descalificados?: number
        ingreso?: number
      }
      setCloserPreview({
        calls_scheduled: Number(data.llamadas_agendadas) || 0,
        shows: Number(data.shows) || 0,
        cierres: Number(data.cierres) || 0,
        calificados: Number(data.calificados) || 0,
        descalificados: Number(data.descalificados) || 0,
        ingreso: Number(data.ingreso) || 0,
      })
    } catch {
      /* silencioso */
    } finally {
      setCloserPreviewLoading(false)
    }
  }, [role, userId, form.memberId, form.date])

  useEffect(() => {
    if (role === 'closer') void fetchCloserPreview()
  }, [role, fetchCloserPreview])

  const handleGenerateCloserReport = async () => {
    if (role !== 'closer' || !userId || form.memberId === '') {
      toast('Seleccioná un closer')
      return
    }
    if (closerPreview.calls_scheduled === 0) {
      toast('No hay llamadas en el panel para este closer en esta fecha.')
      return
    }
    setCloserGenerating(true)
    try {
      const q = new URLSearchParams({
        member_id: String(form.memberId),
        fecha: form.date,
      })
      const res = await apiFetch(`/team/closer-reports/generate?${q}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(errMessage(data))
        return
      }
      const payload = data as {
        discord_sent?: boolean
        llamadas_agendadas?: number
        shows?: number
        cierres?: number
        calificados?: number
        descalificados?: number
        ingreso?: number
      }
      setCloserPreview({
        calls_scheduled: Number(payload.llamadas_agendadas) || 0,
        shows: Number(payload.shows) || 0,
        cierres: Number(payload.cierres) || 0,
        calificados: Number(payload.calificados) || 0,
        descalificados: Number(payload.descalificados) || 0,
        ingreso: Number(payload.ingreso) || 0,
      })
      setCloserGeneratedStamp(stamp(form.memberId, form.date))
      toast(
        payload.discord_sent
          ? 'Reporte generado y enviado a Discord'
          : 'Reporte generado (Discord no configurado o desactivado)',
      )
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch {
      toast('No se pudo generar el reporte.')
    } finally {
      setCloserGenerating(false)
    }
  }

  const stamp = (mid: number | '', d: string) => `${mid}|${d}`

  const closerGeneratedThisDate =
    role === 'closer' && closerGeneratedStamp === stamp(form.memberId, form.date) && form.memberId !== ''

  const setterSavedThisDate =
    role === 'setter' && setterSavedStamp === stamp(form.memberId, form.date) && form.memberId !== ''
  const setterSavedForDate = setterSavedThisDate && form.date === today

  const numField = (
    key: NumKey,
    label: string,
    isCurrency = false,
    labelClass = 'text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]',
  ) => {
    const numVal = form[key] as number
    const displayValue = numVal === 0 ? '' : numVal
    return (
      <div>
        <label className={`mb-1.5 block leading-snug ${labelClass}`}>{label}</label>
        <input
          type="number"
          value={displayValue}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              setForm((f) => ({ ...f, [key]: 0 }))
              return
            }
            setForm((f) => ({
              ...f,
              [key]: isCurrency ? parseFloat(raw) || 0 : parseInt(raw, 10) || 0,
            }))
          }}
          placeholder="0"
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
        />
      </div>
    )
  }

  const textareaField = (
    key: 'sentimiento_trafico' | 'dia_bueno_malo' | 'insights_marketing',
    label: string,
    placeholder: string,
    rows: number,
  ) => (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium leading-snug text-[var(--text)]">{label}</label>
      <textarea
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
    </div>
  )

  const handleSave = async () => {
    if (role !== 'setter') return
    if (!userId) {
      toast('Iniciá sesión')
      return
    }
    if (form.memberId === '') {
      toast('Seleccioná un miembro')
      return
    }
    setSaving(true)
    try {
      if (role === 'setter') {
        const res = await apiFetch('/team/setter-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member_id: form.memberId,
            fecha: form.date,
            conversaciones: form.conversaciones,
            agendas: form.agendas,
            links_enviados: form.calendly_links,
            notas: null,
            sentimiento_trafico: form.sentimiento_trafico.trim() || null,
            avatar_tipo_agendas: serializeAvatarCounts(form.avatar_counts),
            insights_marketing: form.insights_marketing.trim() || null,
            seguimientos: form.seguimientos,
            outbounds: form.outbounds,
            dia_bueno_malo: form.dia_bueno_malo.trim() || null,
          }),
        })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
        toast('Reporte guardado')
        setSetterSavedStamp(stamp(form.memberId, form.date))
        setShowForm(false)
      }
      void fetchMembers()
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch {
      toast('No se pudo guardar el reporte.')
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
        Iniciá sesión para cargar reportes.
      </div>
    )
  }

  if (role === 'closer') {
    return (
      <div className="space-y-4">
        <div className="glass-card glass-card--performant p-5">
          <div className="mb-2 text-[13px] font-semibold">Reporte diario — Closer (automático)</div>
          <p className="mb-4 text-[12px] leading-relaxed text-[var(--text3)]">
            Se genera solo a las <strong className="text-[var(--text2)]">23:00 (Argentina)</strong> desde el panel
            diario. Podés forzarlo antes con el botón de abajo. Completá status, calificación, pago y closer en cada
            llamada.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Closer</label>
              <select
                value={form.memberId === '' ? '' : String(form.memberId)}
                onChange={(e) => {
                  const v = e.target.value
                  setForm((f) => ({ ...f, memberId: v ? parseInt(v, 10) : '' }))
                }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              >
                <option value="">Seleccionar…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {form.memberId === '' ? (
            <p className="text-[12px] text-[var(--text3)]">Elegí un closer para ver la vista previa del día.</p>
          ) : closerPreviewLoading ? (
            <p className="text-[12px] text-[var(--text3)]">Calculando desde panel diario…</p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ['Llamadas agendadas', closerPreview.calls_scheduled],
                  ['Shows', closerPreview.shows],
                  ['Cierres', closerPreview.cierres],
                  ['Calificados', closerPreview.calificados],
                  ['Descalificados', closerPreview.descalificados],
                  ['Ingreso', formatCash(closerPreview.ingreso)],
                ].map(([label, val]) => (
                  <div key={String(label)} className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">{label}</div>
                    <div className="mt-1 text-[15px] font-semibold text-[var(--text)]">{val}</div>
                  </div>
                ))}
              </div>
              {closerPreview.shows > 0 ? (
                <div className="mb-4 flex gap-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3 text-[11px]">
                  <div>
                    <span className="text-[var(--text3)]">Close Rate:</span>{' '}
                    <span className="font-semibold text-[var(--accent)]">
                      {((closerPreview.cierres / closerPreview.shows) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text3)]">Ticket prom:</span>{' '}
                    <span className="font-semibold text-[var(--green)]">
                      {closerPreview.cierres > 0
                        ? formatCash(closerPreview.ingreso / closerPreview.cierres)
                        : '$0'}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void handleGenerateCloserReport()}
                  disabled={
                    closerGenerating ||
                    closerPreviewLoading ||
                    closerPreview.calls_scheduled === 0
                  }
                  className="w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(230,57,70,0.45)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  {closerGenerating ? 'Generando…' : 'Generar reporte del día'}
                </button>
                {closerGeneratedThisDate && (
                  <span className="block text-center text-[11px] font-medium text-[var(--green)]">
                    ✓ Reporte generado para esta fecha
                  </span>
                )}
                {closerPreview.calls_scheduled === 0 && !closerPreviewLoading ? (
                  <p className="text-center text-[11px] text-[var(--text3)]">
                    Sin llamadas en el panel — no se puede generar.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  const openLabel = showForm
    ? 'Cerrar'
    : setterSavedThisDate
      ? setterSavedForDate
        ? 'Editar reporte de hoy'
        : 'Editar reporte'
      : '+ Cargar reporte diario'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(230,57,70,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {openLabel}
        </button>
        {setterSavedForDate && (
          <span className="block text-[11px] font-medium text-[var(--green)]">✓ Reporte de hoy cargado</span>
        )}
      </div>

      {showForm && (
        <div className="glass-card glass-card--performant p-5">
          <div className="mb-4 text-[13px] font-semibold">Reporte Diario — Setter</div>

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
                Setter (selección)
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
                    Sin miembros (setter)
                  </option>
                ) : (
                  members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {numField('conversaciones', 'Conversaciones', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
            {numField('agendas', 'Agendas', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
            {numField('calendly_links', 'Calendlys enviados', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
          </div>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {numField('seguimientos', 'Seguimientos', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
            {numField('outbounds', 'Outbounds', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
          </div>
          <div className="mb-4">
            <label className="mb-2 block text-[12px] font-medium leading-snug text-[var(--text)]">
              Avatar / Tipo de agendas generadas
            </label>
            <div className="space-y-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] p-3">
              {SETTER_AVATAR_OPTIONS.map((avatar) => (
                <div key={avatar} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--text2)]">{avatar}</span>
                  <input
                    type="number"
                    min={0}
                    value={(form.avatar_counts[avatar] ?? 0) === 0 ? '' : form.avatar_counts[avatar]}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        setForm((f) => ({
                          ...f,
                          avatar_counts: { ...f.avatar_counts, [avatar]: 0 },
                        }))
                        return
                      }
                      const n = parseInt(raw, 10) || 0
                      setForm((f) => ({
                        ...f,
                        avatar_counts: { ...f.avatar_counts, [avatar]: n },
                      }))
                    }}
                    placeholder="0"
                    className="w-20 shrink-0 rounded-lg border border-[var(--border2)] bg-[var(--bg2)] px-2 py-1.5 text-right text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="mb-4 space-y-4">
            {textareaField('sentimiento_trafico', 'Tipo de tráfico', 'Ej.: más lento de lo habitual, picos al mediodía…', 2)}
            {textareaField('dia_bueno_malo', '¿Fue un día bueno o malo?', 'Ej.: Bueno — buen volumen y calidad de leads…', 2)}
            {textareaField(
              'insights_marketing',
              'Feedback a MKT',
              'Qué viste en conversaciones que sirva para creativos, copy o segmentación…',
              4,
            )}
          </div>

          {form.conversaciones > 0 && (
            <div className="mb-4 flex gap-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
              <div className="text-[11px]">
                <span className="text-[var(--text3)]">Tasa agend.:</span>{' '}
                <span className="font-semibold text-[var(--accent)]">
                  {form.conversaciones > 0 ? ((form.agendas / form.conversaciones) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-xl bg-[var(--accent)] px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 disabled:opacity-50 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {saving ? 'Guardando...' : 'Guardar reporte'}
          </button>
        </div>
      )}
    </div>
  )
}
