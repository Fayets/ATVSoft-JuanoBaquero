import { NextResponse } from 'next/server'

/** OAuth legacy: la app usa login JWT en FastAPI. Redirige al destino seguro. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const next = searchParams.get('next') ?? '/panel-diario'
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/panel-diario'
  return NextResponse.redirect(`${origin}${safe}`)
}
