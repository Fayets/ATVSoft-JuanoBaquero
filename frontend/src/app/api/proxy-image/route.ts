import { NextResponse } from 'next/server'

function isAllowedImageUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const h = u.hostname.toLowerCase()
  return (
    h.endsWith('cdninstagram.com') ||
    h.endsWith('instagram.com') ||
    h.endsWith('fbcdn.net') ||
    h.endsWith('fbsbx.com') ||
    h.endsWith('ytimg.com') ||
    h.endsWith('googleusercontent.com') ||
    h.endsWith('ggpht.com')
  )
}

/**
 * Sirve miniaturas (Instagram/Apify/YouTube) evitando bloqueos de hotlink en el navegador.
 * Solo permite hosts conocidos para no abrir un proxy SSRF genérico.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const target = searchParams.get('url')
  if (!target || !isAllowedImageUrl(target)) {
    return new NextResponse('URL no permitida o inválida.', { status: 400 })
  }

  const upstream = await fetch(target, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Referer: 'https://www.instagram.com/',
    },
    next: { revalidate: 3600 },
  })

  if (!upstream.ok) {
    return new NextResponse(`Error al obtener imagen: ${upstream.status}`, { status: upstream.status })
  }

  const contentType = upstream.headers.get('content-type') || 'image/jpeg'
  const buf = await upstream.arrayBuffer()

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
