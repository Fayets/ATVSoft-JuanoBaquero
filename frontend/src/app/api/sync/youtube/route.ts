import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/sync/youtube — Sync YouTube videos via YouTube Data API v3 (sin persistencia en Next)
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid
  void uid

  const body = await request.json()
  const { apiKey, channelId } = body

  if (!apiKey || !channelId) {
    return NextResponse.json({ error: 'Missing apiKey or channelId' }, { status: 400 })
  }

  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=50&key=${encodeURIComponent(apiKey)}`
    const searchResp = await fetch(searchUrl)
    if (!searchResp.ok) {
      const errText = await searchResp.text()
      return NextResponse.json({ error: `YouTube API error (${searchResp.status}): ${errText.substring(0, 200)}` }, { status: 500 })
    }
    const searchData = await searchResp.json()
    const searchItems = searchData.items || []
    return NextResponse.json({
      success: true,
      total: searchItems.length,
      new: 0,
      updated: 0,
      message: 'Sincronización de escritura: usar backend FastAPI.',
    })
  } catch (e) {
    return NextResponse.json({ error: `YouTube sync failed: ${(e as Error).message}` }, { status: 500 })
  }
}
