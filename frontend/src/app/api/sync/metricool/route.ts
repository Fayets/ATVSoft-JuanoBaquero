import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/sync/metricool — Sync stories from Metricool (sin persistencia en Next)
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid
  void uid

  const body = await request.json()
  const { userToken, userId: mcUserId, blogId, startDate, endDate } = body
  if (!userToken || !mcUserId || !blogId) return NextResponse.json({ error: 'Missing Metricool credentials' }, { status: 400 })

  const headers: Record<string, string> = { 'X-Mc-Auth': userToken }
  const fromParam = `${startDate}T00:00:00`
  const toParam = `${endDate}T23:59:59`

  try {
    const storiesUrl = `https://app.metricool.com/api/v2/analytics/stories/instagram?blogId=${blogId}&userId=${mcUserId}&from=${encodeURIComponent(fromParam)}&to=${encodeURIComponent(toParam)}`
    const storiesResp = await fetch(storiesUrl, { headers })
    let storiesData: Record<string, unknown>[] = []
    if (storiesResp.ok) {
      const result = await storiesResp.json()
      storiesData = Array.isArray(result) ? result : (result.data || [])
    } else if (storiesResp.status === 401) {
      return NextResponse.json({ error: 'Metricool 401 — verifica tu User Token' }, { status: 401 })
    }

    return NextResponse.json({
      success: true,
      stories: storiesData.length,
      new: 0,
      updated: 0,
      message: 'Sincronización de escritura: usar backend FastAPI.',
    })
  } catch (e) {
    return NextResponse.json({ error: `Metricool sync failed: ${(e as Error).message}` }, { status: 500 })
  }
}
