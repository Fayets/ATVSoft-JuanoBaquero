import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/classify-all-secuencias — Classify all unclassified secuencias using Vision
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid

  return NextResponse.json({
    classified: 0,
    total: 0,
    errors: [],
    userId: uid,
    message: 'Clasificación masiva: datos en backend FastAPI.',
  })
}
