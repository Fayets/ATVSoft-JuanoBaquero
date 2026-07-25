import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/youtube-analyze — Analyze YouTube video with AI
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid

  const body = await request.json()
  const { contentItemId, manualTranscript, title = '', classification = {} } = body

  if (!contentItemId) return NextResponse.json({ error: 'Missing contentItemId' }, { status: 400 })

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

  const cls = classification as Record<string, unknown>
  const description = (cls.description as string) || ''
  const existingTranscript = manualTranscript || (cls.transcript as string) || ''

  let contextText = ''
  if (existingTranscript && existingTranscript.length > 50) {
    contextText = `TRANSCRIPT DEL VIDEO:\n${existingTranscript.substring(0, 15000)}`
  } else if (description.length > 30) {
    contextText = `TITULO: ${title}\n\nDESCRIPCION DEL VIDEO:\n${description}`
  } else {
    contextText = `TITULO: ${title}\n\n(No hay transcript ni descripcion disponible. Analiza basandote en el titulo.)`
  }

  try {
    const prompt = `Analiza este video de YouTube de un creador de contenido que vende high-ticket (coaching/mentoria).

${contextText}

Genera este JSON (sin markdown, sin backticks):
{
  "summary": "Resumen detallado del video. Basandote en ${existingTranscript.length > 50 ? 'el transcript' : 'el titulo y la descripcion'}, explica de que se trata, que puntos toca, que argumentos usa, que promesas hace, y como cierra. 3-5 parrafos.",
  "ctaTranscript": "${existingTranscript.length > 50 ? 'La parte EXACTA del transcript donde hace el call-to-action. Copia textualmente.' : 'Basandote en la descripcion, cual es el CTA principal del video (link, DM, comentario, etc).'}",
  "keyPoints": ["punto clave 1", "punto clave 2", "punto clave 3", "punto clave 4"],
  "targetAudience": "A quien le habla este video especificamente",
  "mainHook": "El hook principal que usa para captar atencion"
}

Solo JSON.`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 })

    const aiData = await aiRes.json()
    const raw = aiData.content?.map((c: { text?: string }) => c.text || '').join('').trim() || ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let analysis: Record<string, unknown>
    try {
      analysis = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    const newCls = {
      ...cls,
      summary: analysis.summary || '',
      ctaTranscript: analysis.ctaTranscript || '',
      keyPoints: analysis.keyPoints || [],
      targetAudience: analysis.targetAudience || '',
      mainHook: analysis.mainHook || '',
      ...(manualTranscript ? { transcript: manualTranscript } : {}),
    }

    return NextResponse.json({
      success: true,
      analysis,
      classification: newCls,
      contentItemId,
      userId: uid,
      source: existingTranscript.length > 50 ? 'transcript' : 'description',
    })
  } catch (e) {
    return NextResponse.json({ error: `Analysis failed: ${(e as Error).message}` }, { status: 500 })
  }
}
