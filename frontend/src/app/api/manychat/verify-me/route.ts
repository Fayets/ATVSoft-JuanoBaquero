import { NextResponse } from 'next/server'

const MANYCHAT_PAGE_TAGS = 'https://api.manychat.com/fb/page/getTags'

/**
 * Diagnóstico: API key ManyChat (formato page_id:secret) contra GET /fb/page/getTags.
 * Variable: MANYCHAT_API_KEY en .env.local
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production' && process.env.MANYCHAT_VERIFY_ME_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Ruta de diagnóstico deshabilitada en producción.' },
      { status: 404 },
    )
  }

  const apiKey = process.env.MANYCHAT_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Falta MANYCHAT_API_KEY en .env.local (formato page_id:api_key desde ManyChat → Settings → API). Reiniciá npm run dev.',
      },
      { status: 400 },
    )
  }

  const res = await fetch(MANYCHAT_PAGE_TAGS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: res.status,
        message: (body.message as string) || 'ManyChat rechazó la petición.',
        body,
      },
      { status: res.status },
    )
  }

  const status = body.status as string | undefined
  const data = body.data
  const tags = Array.isArray(data) ? data : []

  if (status !== 'success') {
    return NextResponse.json(
      {
        ok: false,
        message: 'Respuesta ManyChat sin status success.',
        body,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    message: 'La API key de ManyChat es válida.',
    tags_count: tags.length,
  })
}
