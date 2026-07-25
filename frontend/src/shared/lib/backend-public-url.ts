import { getBackendInternalUrl } from './backend-internal-url'

const PUBLIC_BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '')

/** Base para llamadas API (puede terminar en `/api` detrás de Nginx). */
export const API_BASE = PUBLIC_BACKEND || '/api-backend'

/** Base para assets estáticos (`/media/...`); sin el sufijo `/api` de API_BASE. */
export const MEDIA_BASE = PUBLIC_BACKEND ? stripApiSuffix(PUBLIC_BACKEND) : ''

function stripApiSuffix(url: string): string {
  return url.replace(/\/api\/?$/, '')
}

function normalizeMediaPath(path: string | null | undefined): string {
  const p = (path || '').trim()
  if (!p) return ''
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  return p.startsWith('/') ? p : `/${p}`
}

/**
 * URL pública para `src` de imágenes en HTML (browser / metadata).
 * Nunca usa hostnames internos de Docker.
 */
export function resolveMediaUrl(path: string | null | undefined): string {
  const normalized = normalizeMediaPath(path)
  if (!normalized) return ''
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized

  if (MEDIA_BASE) {
    return `${MEDIA_BASE}${normalized}`
  }

  return normalized
}

/**
 * URL alcanzable desde el servidor Next (fetch SSR, optimización de imágenes).
 * Solo para consumo interno — no embedear en HTML enviado al browser.
 */
export function resolveMediaUrlForFetch(path: string | null | undefined): string {
  const normalized = normalizeMediaPath(path)
  if (!normalized) return ''
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized
  return `${getBackendInternalUrl()}${normalized}`
}
