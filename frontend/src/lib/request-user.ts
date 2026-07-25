import { NextResponse } from 'next/server'

/** `user_id` numérico del login FastAPI, enviado como `X-User-Id` en rutas API. */
export function requireNumericUserId(request: Request): string | NextResponse {
  const raw = request.headers.get('x-user-id')?.trim()
  if (!raw || !/^\d+$/.test(raw)) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  return raw
}
