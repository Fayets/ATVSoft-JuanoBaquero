/** URL del backend para SSR, rewrites y fetches server-side (red Docker / localhost). */
export function getBackendInternalUrl(): string {
  const base =
    process.env.BACKEND_INTERNAL_URL ||
    process.env.BACKEND_URL ||
    'http://127.0.0.1:8000'
  return base.trim().replace(/\/$/, '')
}
