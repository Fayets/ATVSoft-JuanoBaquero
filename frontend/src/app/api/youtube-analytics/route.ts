import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/youtube-analytics — Analytics desde YouTube API (tokens vía backend)
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid
  void uid

  return NextResponse.json({
    error: 'YouTube Analytics: conectar y persistir tokens vía backend FastAPI.',
    needsReconnect: true,
  }, { status: 501 })
}
