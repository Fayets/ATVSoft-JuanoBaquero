import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/fix-thumbnails — (legacy) thumbnails se gestionan desde el backend
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid
  void uid
  return NextResponse.json({ message: 'No hay proceso local', fixed: 0, skipped: 0, failed: 0, total: 0 })
}
