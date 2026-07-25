import { NextResponse } from 'next/server'

const APIFY_ME = 'https://api.apify.com/v2/users/me'

/**
 * Diagnóstico Apify: valida APIFY_API_TOKEN.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production' && process.env.APIFY_VERIFY_ME_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Ruta de diagnóstico deshabilitada en producción.' }, { status: 404 })
  }

  const token = process.env.APIFY_API_TOKEN?.trim()
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Falta APIFY_API_TOKEN en .env.local. Reiniciá npm run dev.',
      },
      { status: 400 },
    )
  }

  const res = await fetch(`${APIFY_ME}?token=${encodeURIComponent(token)}`)
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: res.status,
        message: (body.error as Record<string, unknown> | undefined)?.message || 'Apify rechazó el token.',
        body,
      },
      { status: res.status },
    )
  }

  const data = body.data as Record<string, unknown> | undefined
  return NextResponse.json({
    ok: true,
    message: 'El token de Apify es válido.',
    user: data
      ? {
          username: data.username,
          email: data.email,
          id: data.id,
        }
      : null,
  })
}
