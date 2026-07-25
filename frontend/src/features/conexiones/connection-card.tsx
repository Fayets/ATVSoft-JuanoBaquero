'use client'

import Link from 'next/link'
import { memo, useCallback, useEffect, useState } from 'react'
import { apiFetch, backendAuthHeaders } from '@/lib/api'
import { MonthSelector } from '@/shared/components/month-selector'
import { useMonth } from '@/shared/hooks/use-month'
import type { ConnectionPlatform } from './connection-platforms'
import { ClaudeSaldoHint } from './claude-saldo-hint'

export type ConnectionRow = {
  platform: string
  credentials: Record<string, string>
  last_sync_at: string | null
}

const WEBHOOK_PLATFORMS = ['manychat', 'calendly'] as const
const CALENDLY_CREDENTIAL_KEYS = ['api_key', 'signing_key'] as const

function calendlyCredentialsOnly(creds: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of CALENDLY_CREDENTIAL_KEYS) {
    out[key] = creds[key] ?? ''
  }
  return out
}

const PANEL = 'glass-card'
const PANEL_SETUP = 'glass-card flex min-h-[260px] flex-col p-5'
const BTN_PRIMARY =
  'rounded-lg bg-[var(--accent)] px-5 py-2 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-50'
const BTN_SECONDARY =
  'rounded-lg border border-[var(--border2)] bg-[var(--bg4)] px-5 py-2 text-[11px] font-semibold uppercase text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50'

type ManychatWebhookInfo = {
  webhook_url: string
  webhook_token: string
}

type CalendlyWebhookInfo = {
  webhook_url: string
}

function resolveBackendBase(apiBase: string): string {
  const base = apiBase.replace(/\/$/, '')
  if (base.startsWith('http')) return base
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${base}`
}

type Props = {
  platform: ConnectionPlatform
  connection?: ConnectionRow
  cardLayout?: 'default' | 'setup'
  apiBase: string
  onSave: (credentials: Record<string, string>) => void | Promise<void>
  onSyncComplete?: () => void | Promise<void>
}

function ConnectionCardInner({
  platform,
  connection,
  cardLayout = 'default',
  apiBase,
  onSave,
  onSyncComplete,
}: Props) {
  const isSetup = cardLayout === 'setup'
  const [form, setForm] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [manychatWebhookInfo, setManychatWebhookInfo] = useState<ManychatWebhookInfo | null>(null)
  const [calendlyWebhookInfo, setCalendlyWebhookInfo] = useState<CalendlyWebhookInfo | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [claudeStatusRefresh, setClaudeStatusRefresh] = useState(0)
  const [autoSyncInfo, setAutoSyncInfo] = useState<{
    interval_hours: number
    interval_minutes?: number
    last_sync_at: string | null
    last_check_at: string | null
    last_check_has_pending: boolean
    next_run_at: string | null
    enabled: boolean
  } | null>(null)
  const {
    month: calendlySyncMonth,
    setMonth: setCalendlySyncMonth,
    options: calendlySyncMonthOptions,
    label: calendlySyncMonthLabel,
  } = useMonth()
  const {
    month: ghlSyncMonth,
    setMonth: setGhlSyncMonth,
    options: ghlSyncMonthOptions,
    label: ghlSyncMonthLabel,
  } = useMonth()

  const isConnected =
    !platform.infoOnly && connection && Object.values(connection.credentials).some((v) => v?.trim())

  useEffect(() => {
    if (!connection?.credentials) return
    setForm(platform.key === 'calendly' ? calendlyCredentialsOnly(connection.credentials) : connection.credentials)
  }, [connection, platform.key])

  useEffect(() => {
    const infoPath =
      platform.key === 'manychat'
        ? 'manychat-webhook-info'
        : platform.key === 'calendly'
          ? 'calendly-webhook-info'
          : null
    if (!infoPath) return

    const url = `${resolveBackendBase(apiBase)}/conexiones/${infoPath}`
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(url, { headers: backendAuthHeaders() })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as ManychatWebhookInfo | CalendlyWebhookInfo
        if (cancelled || !data.webhook_url) return
        if (platform.key === 'manychat' && 'webhook_token' in data && data.webhook_token) {
          setManychatWebhookInfo(data as ManychatWebhookInfo)
        }
        if (platform.key === 'calendly') {
          setCalendlyWebhookInfo({ webhook_url: data.webhook_url })
        }
      } catch {
        /* sin sesión (setup) o servidor sin URL configurada */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBase, platform.key])

  const webhookUrl = useCallback(() => {
    if (platform.key === 'manychat' && manychatWebhookInfo?.webhook_url) {
      return manychatWebhookInfo.webhook_url
    }
    if (platform.key === 'calendly' && calendlyWebhookInfo?.webhook_url) {
      return calendlyWebhookInfo.webhook_url
    }
    if (typeof window === 'undefined') return ''
    const origin = window.location.origin
    return `${origin}/api/webhooks/${platform.key}`
  }, [apiBase, manychatWebhookInfo, calendlyWebhookInfo, platform.key])

  const save = useCallback(
    async (creds: Record<string, string>) => {
      setStatus('loading')
      setErrorMsg('')
      let payload =
        platform.key === 'calendly' ? calendlyCredentialsOnly(creds) : { ...creds }
      if (platform.key === 'instagram' && connection?.credentials) {
        const prev = connection.credentials
        if (!String(payload.access_token || '').trim() && prev.access_token?.trim()) {
          payload = { ...payload, access_token: prev.access_token }
        }
      }
      try {
        await onSave(payload)
        setStatus('success')
        if (platform.key === 'claude') {
          setClaudeStatusRefresh((n) => n + 1)
        }
        setTimeout(() => setStatus('idle'), 2000)
      } catch (e) {
        setStatus('error')
        setErrorMsg(e instanceof Error ? e.message : 'Error al guardar')
      }
    },
    [onSave, platform.key, connection?.credentials],
  )

  const refreshCalendlyAutoStatus = useCallback(async () => {
    if (platform.key !== 'calendly') return
    try {
      const res = await fetch(`${resolveBackendBase(apiBase)}/calendly/auto-sync-status`, {
        headers: backendAuthHeaders(),
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        interval_hours?: number
        interval_minutes?: number
        last_sync_at?: string | null
        last_check_at?: string | null
        last_check_has_pending?: boolean
        next_run_at?: string | null
        enabled?: boolean
      }
      setAutoSyncInfo({
        interval_hours: data.interval_hours ?? 6,
        interval_minutes: data.interval_minutes,
        last_sync_at: data.last_sync_at ?? null,
        last_check_at: data.last_check_at ?? null,
        last_check_has_pending: Boolean(data.last_check_has_pending),
        next_run_at: data.next_run_at ?? null,
        enabled: Boolean(data.enabled),
      })
    } catch {
      /* sin sesión o backend caído */
    }
  }, [apiBase, platform.key])

  useEffect(() => {
    if (platform.key !== 'calendly' || !isConnected) return
    void refreshCalendlyAutoStatus()
  }, [platform.key, isConnected, refreshCalendlyAutoStatus, connection?.last_sync_at])

  const syncCalendly = useCallback(async () => {
    if (platform.key !== 'calendly') return
    const apiKey = (form.api_key || connection?.credentials?.api_key || '').trim()
    if (!apiKey) {
      setSyncStatus('Guardá el Personal Access Token antes de sincronizar.')
      return
    }
    setSyncing(true)
    setSyncStatus('Sincronizando…')
    try {
      const res = await fetch(`${resolveBackendBase(apiBase)}/calendly/sync`, {
        method: 'POST',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ month: calendlySyncMonth }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[]
        error?: string
        synced?: number
        created?: number
        updated?: number
        month?: string | null
      }
      if (!res.ok) {
        const d = data.error ?? data.detail
        const msg =
          typeof d === 'string' ? d : Array.isArray(d) ? JSON.stringify(d) : 'Error al sincronizar'
        setSyncStatus(`Error: ${msg}`)
        return
      }
      const monthLabel =
        data.month && typeof data.month === 'string'
          ? calendlySyncMonthOptions.find((o) => o.value === data.month)?.label ?? calendlySyncMonthLabel
          : calendlySyncMonthLabel
      setSyncStatus(
        `${monthLabel}: ${data.created ?? 0} leads creados, ${data.updated ?? 0} actualizados.`,
      )
      await refreshCalendlyAutoStatus()
      await onSyncComplete?.()
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : 'Error al sincronizar')
    } finally {
      setSyncing(false)
    }
  }, [
    apiBase,
    calendlySyncMonth,
    calendlySyncMonthLabel,
    calendlySyncMonthOptions,
    connection?.credentials?.api_key,
    form.api_key,
    onSyncComplete,
    platform.key,
    refreshCalendlyAutoStatus,
  ])

  const syncGhl = useCallback(async () => {
    if (platform.key !== 'ghl') return
    const token = (form.access_token || connection?.credentials?.access_token || '').trim()
    if (!token) {
      setSyncStatus('Guardá el Private Integration Token antes de sincronizar.')
      return
    }
    setSyncing(true)
    setSyncStatus('Sincronizando…')
    try {
      const url = `${resolveBackendBase(apiBase)}/ghl/sync?month=${encodeURIComponent(ghlSyncMonth)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[]
        error?: string
        synced?: number
        created?: number
        updated?: number
        month?: string | null
      }
      if (!res.ok) {
        const d = data.error ?? data.detail
        const msg =
          typeof d === 'string' ? d : Array.isArray(d) ? JSON.stringify(d) : 'Error al sincronizar'
        setSyncStatus(`Error: ${msg}`)
        return
      }
      const monthLabel =
        data.month && typeof data.month === 'string'
          ? ghlSyncMonthOptions.find((o) => o.value === data.month)?.label ?? ghlSyncMonthLabel
          : ghlSyncMonthLabel
      setSyncStatus(
        `${monthLabel}: ${data.created ?? 0} leads creados, ${data.updated ?? 0} actualizados.`,
      )
      await onSyncComplete?.()
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : 'Error al sincronizar')
    } finally {
      setSyncing(false)
    }
  }, [
    apiBase,
    ghlSyncMonth,
    ghlSyncMonthLabel,
    ghlSyncMonthOptions,
    connection?.credentials?.access_token,
    form.access_token,
    onSyncComplete,
    platform.key,
  ])

  const testInstagramConnection = useCallback(async () => {
    if (platform.key !== 'instagram') return
    setSyncing(true)
    setSyncStatus('Probando conexión…')
    try {
      const res = await apiFetch('/stories/connection-test', { headers: backendAuthHeaders() })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        detail?: string | { msg?: string }[]
        steps?: { step: string; ok: boolean; detail: string }[]
      }
      if (!res.ok) {
        const d = data.detail
        const msg =
          typeof d === 'string' ? d : Array.isArray(d) ? JSON.stringify(d) : 'Error al probar conexión'
        setSyncStatus(`Error: ${msg}`)
        return
      }
      if (data.ok) {
        const lines = (data.steps ?? []).map((s) => `${s.ok ? '✓' : '✗'} ${s.step}: ${s.detail}`)
        setSyncStatus(lines.join('\n') || 'Conexión OK — podés sincronizar historias.')
      } else {
        const lines = (data.steps ?? []).map((s) => `${s.ok ? '✓' : '✗'} ${s.step}: ${s.detail}`)
        setSyncStatus(lines.join('\n') || `Error: ${data.steps?.find((s) => !s.ok)?.detail || 'No se pudo acceder a historias.'}`)
      }
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : 'Error al probar conexión')
    } finally {
      setSyncing(false)
    }
  }, [apiBase, platform.key])

  const instagramTestBlock =
    platform.key === 'instagram' && !isSetup ? (
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Probar acceso a historias
        </div>
        <button
          type="button"
          disabled={syncing}
          onClick={() => void testInstagramConnection()}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg4)] px-5 py-2 text-[11px] font-semibold uppercase text-[var(--text)] disabled:opacity-50"
        >
          {syncing ? 'Probando…' : 'Probar conexión'}
        </button>
        {syncStatus ? (
          <p className="mt-3 whitespace-pre-line text-[12px] leading-snug text-[var(--text2)]">{syncStatus}</p>
        ) : null}
      </div>
    ) : null

  const calendlySyncBlock =
    platform.key === 'calendly' ? (
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Sincronizar leads
        </div>
        <p className="mb-3 text-[12px] leading-snug text-[var(--text2)]">
          {autoSyncInfo?.interval_minutes === 0 ? (
            <>
              Auto-sync <span className="font-semibold text-[var(--text)]">desactivado</span>. El
              botón <span className="font-semibold text-[var(--text)]">Sincronizar</span> sigue
              trayendo leads. Activá el intervalo en Ajustes → Tasa de refresco.
            </>
          ) : (
            <>
              Auto cada{' '}
              {autoSyncInfo?.interval_minutes
                ? autoSyncInfo.interval_minutes % 1440 === 0
                  ? `${autoSyncInfo.interval_minutes / 1440} día`
                  : autoSyncInfo.interval_minutes % 60 === 0
                    ? `${autoSyncInfo.interval_minutes / 60} h`
                    : `${autoSyncInfo.interval_minutes} min`
                : `${autoSyncInfo?.interval_hours ?? 6} h`}
              : el servidor revisa si hay agendas nuevas y solo entonces trae datos. El botón{' '}
              <span className="font-semibold text-[var(--text)]">Sincronizar</span> siempre descarga
              leads. Intervalo en Ajustes → Tasa de refresco.
            </>
          )}
        </p>
        {autoSyncInfo ? (
          <ul className="mb-3 space-y-1 text-[11px] text-[var(--text3)]">
            <li>
              Última sync:{' '}
              {autoSyncInfo.last_sync_at
                ? new Date(autoSyncInfo.last_sync_at).toLocaleString('es-AR')
                : 'nunca'}
            </li>
            <li>
              Último auto-check:{' '}
              {autoSyncInfo.last_check_at
                ? new Date(autoSyncInfo.last_check_at).toLocaleString('es-AR')
                : '—'}
              {autoSyncInfo.last_check_at
                ? autoSyncInfo.last_check_has_pending
                  ? ' (había novedades)'
                  : ' (al día)'
                : null}
            </li>
            <li>
              Próximo auto-check:{' '}
              {autoSyncInfo.interval_minutes === 0
                ? 'desactivado'
                : autoSyncInfo.next_run_at
                  ? new Date(autoSyncInfo.next_run_at).toLocaleString('es-AR')
                  : '—'}
            </li>
          </ul>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:w-auto sm:min-w-[200px]">
            <MonthSelector
              month={calendlySyncMonth}
              options={calendlySyncMonthOptions}
              onChange={setCalendlySyncMonth}
              label="Mes"
            />
          </div>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void syncCalendly()}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg4)] px-5 py-2 text-[11px] font-semibold uppercase text-[var(--text)] disabled:opacity-50 sm:mb-0.5"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
        {syncStatus ? <p className="mt-3 text-[12px] text-[var(--text2)]">{syncStatus}</p> : null}
      </div>
    ) : null

  const ghlSyncBlock =
    platform.key === 'ghl' ? (
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Sincronizar leads
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:w-auto sm:min-w-[200px]">
            <MonthSelector
              month={ghlSyncMonth}
              options={ghlSyncMonthOptions}
              onChange={setGhlSyncMonth}
              label="Mes"
            />
          </div>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void syncGhl()}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg4)] px-5 py-2 text-[11px] font-semibold uppercase text-[var(--text)] disabled:opacity-50 sm:mb-0.5"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
        {syncStatus ? <p className="mt-3 text-[12px] text-[var(--text2)]">{syncStatus}</p> : null}
      </div>
    ) : null

  const guideBlock = (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
      <h4 className="mb-2 text-[12px] font-semibold text-[var(--accent)]">{platform.guide.title}</h4>
      <ol className={isSetup ? 'list-decimal space-y-2 pl-4 text-[12px] text-[var(--text2)]' : 'space-y-2.5'}>
        {platform.guide.steps.map((step, i) =>
          isSetup ? (
            <li key={i}>{step}</li>
          ) : (
            <li key={i} className="flex gap-3 text-[12px] leading-relaxed text-[var(--text2)]">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ),
        )}
      </ol>
    </div>
  )

  const fieldsBlock = (
    <div className={isSetup ? 'space-y-3' : 'grid grid-cols-1 gap-3 md:grid-cols-2'}>
      {platform.fields.map((f) => (
        <div key={f.key} className={!isSetup && f.span === 2 ? 'md:col-span-2' : undefined}>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            {f.label}
          </label>
          <input
            type={f.type || 'text'}
            value={form[f.key] || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text3)] focus:border-[var(--text3)]"
          />
          {!isSetup && platform.key === 'instagram' && f.key === 'access_token' && (
            <Link
              href="/configuracion/instagram-token-guide"
              className="mt-2 inline-block text-[11px] text-[var(--accent)] hover:underline"
            >
              Cómo generar tu token de Instagram →
            </Link>
          )}
        </div>
      ))}
    </div>
  )

  const showWebhookBlock =
    platform.key === 'manychat'
      ? Boolean(manychatWebhookInfo)
      : platform.key === 'calendly'
        ? true
        : false

  const webhookTokenDisplay = manychatWebhookInfo?.webhook_token ?? connection?.credentials?.webhook_token

  const webhookBlock = showWebhookBlock ? (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">URL del Webhook</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-[var(--bg4)] px-3 py-2 text-[12px] text-[var(--accent)]">
          {webhookUrl()}
        </code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(webhookUrl())}
            className="rounded-lg border border-[var(--border2)] px-3 py-2 text-[11px] text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Copiar
        </button>
      </div>
      {platform.key === 'manychat' && webhookTokenDisplay ? (
        <>
          <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Token</div>
          <code className="block break-all rounded bg-[var(--bg4)] px-3 py-2 text-[12px] text-[var(--text2)]">
            {webhookTokenDisplay}
          </code>
        </>
      ) : null}
    </div>
  ) : null

  if (isSetup) {
    return (
      <div className={PANEL_SETUP}>
        <div className="mb-4">
          <h3 className="text-[15px] font-semibold">{platform.label}</h3>
          <p className="mt-1 text-[12px] text-[var(--text3)]">{platform.subtitle}</p>
          {isConnected && (
            <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-[var(--green)]">Conectado</p>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <button type="button" disabled className="cursor-not-allowed rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text3)] opacity-50">
            Video
          </button>
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)]"
          >
            Guía
          </button>
          {!platform.infoOnly && (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className={`${BTN_PRIMARY} px-4`}
            >
              Conectar
            </button>
          )}
        </div>
        {showGuide && <div className="mt-4">{guideBlock}</div>}
        {showForm && !platform.infoOnly && (
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            {fieldsBlock}
            <button
              type="button"
              disabled={status === 'loading'}
              onClick={() => save(form)}
              className={`w-full py-3 text-sm font-semibold uppercase ${BTN_PRIMARY}`}
            >
              {status === 'loading' ? 'Guardando…' : 'Guardar conexión'}
            </button>
            {status === 'success' && <p className="text-sm text-[var(--green)]">Guardado.</p>}
            {status === 'error' && <p className="text-sm text-[var(--text2)]">{errorMsg}</p>}
            {calendlySyncBlock}
            {ghlSyncBlock}
            {instagramTestBlock}
            {webhookBlock}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`${PANEL} p-5`}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-4 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--bg4)] text-lg">
          {platform.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">{platform.label}</div>
          <div className="text-[12px] text-[var(--text3)]">{platform.subtitle}</div>
          {platform.key === 'claude' && isConnected ? (
            <ClaudeSaldoHint refreshKey={claudeStatusRefresh} />
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {platform.infoOnly ? (
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">Guía</span>
          ) : (
            <>
              <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[var(--green)]' : 'bg-[var(--text3)]'}`} />
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">
                {isConnected ? 'Conectado' : 'Desconectado'}
              </span>
            </>
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="mb-4 flex w-full items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2.5 text-left text-[12px] text-[var(--text2)]"
          >
            <span>{showGuide ? '▾' : '▸'}</span>
            <span className="font-medium">Cómo configurar {platform.label}</span>
          </button>
          {showGuide && <div className="mb-5">{guideBlock}</div>}
          {platform.fields.length > 0 && fieldsBlock}
          {!platform.infoOnly && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => save(form)}
                className={BTN_PRIMARY}
              >
                {WEBHOOK_PLATFORMS.includes(platform.key as (typeof WEBHOOK_PLATFORMS)[number]) && !isConnected
                  ? `Conectar ${platform.label}`
                  : 'Guardar'}
              </button>
              {connection?.last_sync_at && (
                <span className="text-[11px] text-[var(--text3)]">
                  Última sync: {new Date(connection.last_sync_at).toLocaleString('es-AR')}
                </span>
              )}
            </div>
          )}
          {calendlySyncBlock}
          {ghlSyncBlock}
          {instagramTestBlock}
          {webhookBlock}
        </div>
      )}
    </div>
  )
}

export const ConnectionCard = memo(ConnectionCardInner)
