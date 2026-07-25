'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionCard } from '@/features/conexiones/connection-card'
import { platformsForApp } from '@/features/conexiones/connection-platforms'
import { backendAuthHeaders } from '@/lib/api'
import { API_BASE } from '@/shared/lib/backend-public-url'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

type Connection = {
  id?: string
  platform: string
  credentials: Record<string, string>
  last_sync_at: string | null
}

const PLATFORMS = platformsForApp()

export default function ConexionesPage() {
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [connections, setConnections] = useState<Record<string, Connection>>({})
  const [loading, setLoading] = useState(true)

  const fetchConnections = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setConnections({})
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/conexiones`, { headers: backendAuthHeaders() })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar conexiones: ${detail}`)
        setConnections({})
        return
      }
      if (!Array.isArray(raw)) {
        toast('Error al cargar conexiones: respuesta inválida del servidor.')
        setConnections({})
        return
      }
      const rows = raw as Array<{
        id: string
        platform: string
        credentials: Record<string, unknown>
        last_sync_at: string | null
      }>
      const map: Record<string, Connection> = {}
      rows.forEach((row) => {
        const creds: Record<string, string> = {}
        Object.entries(row.credentials || {}).forEach(([k, v]) => {
          creds[k] = v == null ? '' : String(v)
        })
        map[row.platform] = {
          id: row.id,
          platform: row.platform,
          credentials: creds,
          last_sync_at: row.last_sync_at,
        }
      })
      setConnections(map)
    } finally {
      setLoading(false)
    }
  }, [ready, userId, toast])

  useEffect(() => {
    void fetchConnections()
  }, [fetchConnections])

  const saveConnection = useCallback(
    async (platform: string, credentials: Record<string, string>) => {
      if (!userId) {
        toast('Iniciá sesión para guardar conexiones.')
        return
      }
      const res = await fetch(`${API_BASE}/conexiones/${encodeURIComponent(platform)}`, {
        method: 'PUT',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ credentials }),
      })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        throw new Error(detail)
      }
      toast(`${platform} guardado ✓`)
      await fetchConnections()
    },
    [userId, toast, fetchConnections],
  )

  const savers = useMemo(() => {
    const map: Record<string, (creds: Record<string, string>) => Promise<void>> = {}
    for (const p of PLATFORMS) {
      map[p.key] = (creds) => saveConnection(p.key, creds)
    }
    return map
  }, [saveConnection])

  if (loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando…</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Conexiones API</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Conectá tus cuentas para importar contenido. Las credenciales se guardan en tu instancia.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {PLATFORMS.map((p) => (
          <ConnectionCard
            key={p.key}
            platform={p}
            connection={connections[p.key]}
            apiBase={API_BASE}
            onSave={savers[p.key]}
            onSyncComplete={fetchConnections}
          />
        ))}
      </div>
    </div>
  )
}
