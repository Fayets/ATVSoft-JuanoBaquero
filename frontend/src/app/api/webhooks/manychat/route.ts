import { NextResponse } from 'next/server'
import { getBackendInternalUrl } from '@/shared/lib/backend-internal-url'

/** POST /api/webhooks/manychat — proxy al backend FastAPI (leads, keywords, etc.). */
export async function POST(request: Request) {
  const backend = getBackendInternalUrl()
  const incoming = new URL(request.url)
  const target = `${backend}/webhooks/manychat${incoming.search}`

  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const headerToken = request.headers.get('X-Webhook-Token')
  if (headerToken) headers.set('X-Webhook-Token', headerToken)

  let body: string
  try {
    body = await request.text()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const res = await fetch(target, { method: 'POST', headers, body })
    const text = await res.text()
    const outType = res.headers.get('content-type') || 'application/json'
    return new NextResponse(text, { status: res.status, headers: { 'content-type': outType } })
  } catch {
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }
}

export async function GET() {
  const backend = getBackendInternalUrl()
  try {
    const res = await fetch(`${backend}/webhooks/manychat`, { method: 'GET' })
    const text = await res.text()
    const outType = res.headers.get('content-type') || 'application/json'
    return new NextResponse(text, { status: res.status, headers: { 'content-type': outType } })
  } catch {
    return NextResponse.json({ status: 'ok', service: 'manychat-webhook' })
  }
}
