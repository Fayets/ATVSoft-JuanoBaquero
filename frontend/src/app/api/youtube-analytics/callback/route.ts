import { NextResponse } from 'next/server'

// GET /api/youtube-analytics/callback — OAuth2 callback from Google
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  if (error || !code) {
    return NextResponse.redirect(`${siteUrl}/youtube?error=oauth_denied`)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${siteUrl}/youtube?error=missing_config`)
  }

  const redirectUri = `${siteUrl}/api/youtube-analytics/callback`

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      return NextResponse.redirect(`${siteUrl}/youtube?error=token_exchange_failed`)
    }

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return NextResponse.redirect(`${siteUrl}/youtube?error=no_access_token`)
    }
  } catch {
    return NextResponse.redirect(`${siteUrl}/youtube?error=token_fetch_error`)
  }

  return NextResponse.redirect(`${siteUrl}/youtube?analytics=connected`)
}
