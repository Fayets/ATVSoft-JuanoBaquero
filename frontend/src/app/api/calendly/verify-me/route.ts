import { NextResponse } from 'next/server'

const CALENDLY_ME = 'https://api.calendly.com/users/me'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (b64.length % 4)) % 4
  const padded = b64 + '='.repeat(pad)
  try {
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Prueba 1: valida el PAT contra Calendly (GET /users/me).
 * Si el token solo tiene scopes de webhook, Calendly responde 403 "Insufficient scope":
 * igual demuestra que el token es auténtico (no 401 por firma inválida).
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production' && process.env.CALENDLY_VERIFY_ME_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Ruta de diagnóstico deshabilitada en producción.' },
      { status: 404 },
    )
  }

  const token = process.env.CALENDLY_PERSONAL_ACCESS_TOKEN?.trim()
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Falta CALENDLY_PERSONAL_ACCESS_TOKEN en .env.local. Pegá ahí el mismo PAT que usás en Conexiones y reiniciá npm run dev.',
      },
      { status: 400 },
    )
  }

  const jwtPayload = decodeJwtPayload(token)
  const scopes = typeof jwtPayload?.scope === 'string' ? jwtPayload.scope : undefined
  const userUuid = typeof jwtPayload?.user_uuid === 'string' ? jwtPayload.user_uuid : undefined

  const resMe = await fetch(CALENDLY_ME, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  const bodyMe = (await resMe.json().catch(() => ({}))) as Record<string, unknown>

  if (resMe.ok) {
    const resource = bodyMe.resource as Record<string, unknown> | undefined
    return NextResponse.json({
      ok: true,
      check: 'users/me',
      message: 'El Personal Access Token es válido y puede leer tu usuario.',
      scopes_from_jwt: scopes,
      user: resource
        ? {
            uri: resource.uri,
            name: resource.name,
            slug: resource.slug,
            email: resource.email,
            timezone: resource.timezone,
          }
        : null,
    })
  }

  // 401 = token inválido o revocado
  if (resMe.status === 401) {
    return NextResponse.json(
      {
        ok: false,
        status: 401,
        message: (bodyMe.message as string) || 'Calendly no aceptó el token (revisá que no esté revocado).',
        details: bodyMe,
      },
      { status: 401 },
    )
  }

  // 403 con required_scopes = token válido, sin permiso para este endpoint (típico PAT solo webhooks)
  const requiredScopes = bodyMe.required_scopes
  if (
    resMe.status === 403 &&
    Array.isArray(requiredScopes) &&
    requiredScopes.includes('users:read')
  ) {
    return NextResponse.json({
      ok: true,
      check: 'users/me (scope)',
      message:
        'Calendly acepta el token: la autenticación es correcta. No tiene scope users:read, por eso no se puede leer el perfil desde /users/me (es habitual en tokens pensados solo para webhooks).',
      scopes_from_jwt: scopes,
      user_uuid_from_jwt: userUuid,
      calendly_title: bodyMe.title,
    })
  }

  return NextResponse.json(
    {
      ok: false,
      status: resMe.status,
      message: (bodyMe.message as string) || 'Respuesta inesperada de Calendly.',
      details: bodyMe,
      scopes_from_jwt: scopes,
    },
    { status: resMe.status },
  )
}
