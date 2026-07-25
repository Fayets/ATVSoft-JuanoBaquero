'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, backendAuthHeaders, formatApiDetail } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

type SyncSettings = {
  stories_interval_minutes: number
  reels_interval_minutes: number
  calendly_interval_minutes: number
  stories_next_sync: string | null
  reels_next_sync: string | null
  calendly_next_sync: string | null
  min_interval_minutes: number
  max_interval_minutes: number
  min_calendly_interval_minutes?: number
  max_calendly_interval_minutes?: number
}

const STORIES_PRESETS = [60, 120, 360] as const
const REELS_PRESETS = [120, 360, 1440] as const
const CALENDLY_PRESETS = [360, 720, 1440] as const

function formatIntervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes % 1440 === 0) return `${minutes / 1440} día${minutes / 1440 > 1 ? 's' : ''}`
  if (minutes % 60 === 0) return `${minutes / 60} h`
  return `${minutes} min`
}

function formatNextRun(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

type IntervalFieldProps = {
  label: string
  description: string
  value: string
  disabled: boolean
  min: number
  max: number
  nextSync: string | null
  presets?: readonly number[]
  onChange: (v: string) => void
  onPreset: (minutes: number) => void
}

function IntervalField({
  label,
  description,
  value,
  disabled,
  min,
  max,
  nextSync,
  presets = STORIES_PRESETS,
  onChange,
  onPreset,
}: IntervalFieldProps) {
  const num = Number(value)
  const valid = Number.isFinite(num) && num >= min && num <= max

  return (
    <div className="rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]">
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
        {label}
      </h3>
      <p className="mb-4 text-[12px] text-[var(--text3)]">{description}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-[160px] flex-col gap-1">
          <span className="text-[11px] text-[var(--text3)]">Intervalo (minutos)</span>
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 font-mono-num text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="pb-2 text-[12px] text-[var(--text2)]">
          {valid ? (
            <>
              ≈ <span className="font-mono-num text-[var(--text)]">{formatIntervalLabel(num)}</span>
            </>
          ) : (
            <span className="text-[var(--red)]">Entre {min} y {max.toLocaleString('es-AR')} min</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onPreset(m)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              valid && num === m
                ? 'border-[var(--accent)] bg-[rgba(220,60,70,0.15)] text-[var(--text)]'
                : 'border-[var(--border)] text-[var(--text3)] hover:border-[var(--border2)] hover:text-[var(--text2)]'
            } disabled:opacity-50`}
          >
            {formatIntervalLabel(m)}
          </button>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-[var(--text3)]">
        Próxima corrida automática:{' '}
        <span className="font-mono-num text-[var(--text2)]">{formatNextRun(nextSync)}</span>
      </p>
    </div>
  )
}

export default function TasaRefrescoPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SyncSettings | null>(null)
  const [storiesMin, setStoriesMin] = useState('5')
  const [reelsMin, setReelsMin] = useState('1440')
  const [calendlyMin, setCalendlyMin] = useState('360')

  const fetchSettings = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const res = await apiFetch('/settings/sync', { headers: backendAuthHeaders() })
      const data = (await res.json().catch(() => ({}))) as SyncSettings & { detail?: string }
      if (!res.ok) {
        toast(`Error al cargar: ${data.detail ?? res.statusText}`)
        return
      }
      setSettings(data)
      setStoriesMin(String(data.stories_interval_minutes))
      setReelsMin(String(data.reels_interval_minutes))
      setCalendlyMin(String(data.calendly_interval_minutes ?? 360))
    } finally {
      setLoading(false)
    }
  }, [ready, toast])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const save = async () => {
    if (!settings) return
    const stories = Number(storiesMin)
    const reels = Number(reelsMin)
    const calendly = Number(calendlyMin)
    const { min_interval_minutes: min, max_interval_minutes: max } = settings
    const calMin = settings.min_calendly_interval_minutes ?? 60
    const calMax = settings.max_calendly_interval_minutes ?? max
    if (
      !Number.isFinite(stories) ||
      !Number.isFinite(reels) ||
      !Number.isFinite(calendly) ||
      stories < min ||
      stories > max ||
      reels < min ||
      reels > max ||
      calendly < calMin ||
      calendly > calMax
    ) {
      toast(`Revisá los intervalos (Calendly: ${calMin}–${calMax} min)`)
      return
    }
    const storiesChanged = Math.round(stories) !== settings.stories_interval_minutes
    setSaving(true)
    try {
      const res = await apiFetch('/settings/sync', {
        method: 'PATCH',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          stories_interval_minutes: Math.round(stories),
          reels_interval_minutes: Math.round(reels),
          calendly_interval_minutes: Math.round(calendly),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as SyncSettings & { detail?: string }
      if (!res.ok) {
        toast(`No se pudo guardar: ${formatApiDetail(data.detail, res.statusText)}`)
        return
      }
      setSettings(data)
      setStoriesMin(String(data.stories_interval_minutes))
      setReelsMin(String(data.reels_interval_minutes))
      setCalendlyMin(String(data.calendly_interval_minutes ?? 360))
      if (storiesChanged) {
        window.dispatchEvent(new Event('stories-sync-settings-updated'))
        toast('Guardado. Sincronizando historias y reiniciando contador…')
      } else {
        toast('Tasa de refresco actualizada')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  const min = settings?.min_interval_minutes ?? 1
  const max = settings?.max_interval_minutes ?? 10080
  const calMin = settings?.min_calendly_interval_minutes ?? 60
  const calMax = settings?.max_calendly_interval_minutes ?? 10080

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">Tasa de refresco</h2>
        <p className="mt-1 max-w-2xl text-[12px] text-[var(--text3)]">
          Configurá cada cuánto corre cada job en segundo plano. En Calendly el intervalo es del
          check liviano: solo si hay agendas nuevas se traen los datos. Los cambios aplican al
          instante sin reiniciar el backend.
        </p>
      </div>

      <div className="mb-8 space-y-6">
        <IntervalField
          label="Historias"
          description="Sync automático con Instagram (mismo job que el contador «Próximo en» en /historias)."
          value={storiesMin}
          disabled={saving}
          min={min}
          max={max}
          nextSync={settings?.stories_next_sync ?? null}
          presets={STORIES_PRESETS}
          onChange={setStoriesMin}
          onPreset={(m) => setStoriesMin(String(m))}
        />
        <IntervalField
          label="Reels"
          description="Refresh de métricas en BD para reels ya importados (views, reach, likes, etc.)."
          value={reelsMin}
          disabled={saving}
          min={min}
          max={max}
          nextSync={settings?.reels_next_sync ?? null}
          presets={REELS_PRESETS}
          onChange={setReelsMin}
          onPreset={(m) => setReelsMin(String(m))}
        />
        <IntervalField
          label="Calendly"
          description="Check liviano periódico; solo si hay novedades sincroniza leads. El botón «Sincronizar» en Leads siempre trae los datos."
          value={calendlyMin}
          disabled={saving}
          min={calMin}
          max={calMax}
          nextSync={settings?.calendly_next_sync ?? null}
          presets={CALENDLY_PRESETS}
          onChange={setCalendlyMin}
          onPreset={(m) => setCalendlyMin(String(m))}
        />
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-[12px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  )
}
