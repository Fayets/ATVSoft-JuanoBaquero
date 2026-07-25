import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/classify-vision — Classify content using Claude Vision on thumbnail images
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

  const { contentId, imageUrl } = await request.json()
  if (!contentId || !imageUrl) return NextResponse.json({ error: 'Missing contentId or imageUrl' }, { status: 400 })

  const ml: Record<string, string[]> = {}

  try {
    // Download image
    const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!imgRes.ok) return NextResponse.json({ error: 'Failed to fetch image' }, { status: 400 })
    const buf = Buffer.from(await imgRes.arrayBuffer())
    const base64 = buf.toString('base64')
    const mediaType = imgRes.headers.get('content-type') || 'image/jpeg'

    const listCtx: string[] = []
    if (ml.dolores?.length) listCtx.push('DOLORES: ' + ml.dolores.join(' | '))
    if (ml.angulos?.length) listCtx.push('ANGULOS: ' + ml.angulos.join(' | '))

    const prompt = `Analiza esta story de Instagram y clasifica:
${listCtx.join('\n')}

Responde SOLO JSON: {"dolor":"","angulos":[""],"cta":"","titulo":""}
- dolor: problema general que toca (usa uno de DOLORES si aplica, crea nuevo si no)
- angulos: enfoque/solucion (usa de ANGULOS si aplica)
- cta: dejalo vacio
- titulo: titulo corto de 5 palabras max`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt },
        ] }],
      }),
    })

    if (!claudeRes.ok) return NextResponse.json({ error: 'Claude API error' }, { status: 500 })

    const cData = await claudeRes.json()
    const text = cData.content?.[0]?.text || ''
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    return NextResponse.json({ success: true, classification: parsed, contentId, userId: uid })
  } catch (e) {
    return NextResponse.json({ error: `Vision classify failed: ${(e as Error).message}` }, { status: 500 })
  }
}
