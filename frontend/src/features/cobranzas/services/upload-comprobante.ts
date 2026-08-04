import { apiFetch } from '@/lib/api'

export async function uploadComprobante(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch('/media/comprobantes', {
    method: 'POST',
    body: form,
  })
  const raw = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : res.statusText
    throw new Error(detail || 'Error al subir comprobante')
  }
  const url = String((raw as { url?: unknown }).url || '').trim()
  if (!url) throw new Error('Respuesta de upload sin URL')
  return url
}
