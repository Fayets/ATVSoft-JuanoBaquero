import crypto from 'crypto'
import { NextResponse } from 'next/server'

import { verifyFathomWebhook } from '@/features/leads/services/fathom-service'

const FATHOM_MEETINGS = 'https://api.fathom.ai/external/v1/meetings'

/**
 * Diagnóstico: API key (GET meetings) + round-trip de firma de webhook (whsec_*).
 * Variables: FATHOM_API_KEY, FATHOM_WEBHOOK_SECRET en .env.local
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production' && process.env.FATHOM_VERIFY_ME_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Ruta de diagnóstico deshabilitada en producción.' },
      { status: 404 },
    )
  }

  const apiKey = process.env.FATHOM_API_KEY?.trim()
  const webhookSecret = process.env.FATHOM_WEBHOOK_SECRET?.trim()

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Falta FATHOM_API_KEY en .env.local (misma API Key que en Conexiones). Reiniciá npm run dev.',
      },
      { status: 400 },
    )
  }

  const meetingsRes = await fetch(`${FATHOM_MEETINGS}?limit=5`, {
    headers: { 'X-Api-Key': apiKey },
  })
  const meetingsBody = (await meetingsRes.json().catch(() => ({}))) as Record<string, unknown>

  let meetingsOk = meetingsRes.ok
  let meetingsSummary: Record<string, unknown> | null = null
  if (meetingsOk) {
    const items = Array.isArray(meetingsBody.items) ? meetingsBody.items : []
    meetingsSummary = { count: items.length }
  }

  let signatureRoundTrip: { ok: boolean; detail?: string } = { ok: false, detail: 'Sin FATHOM_WEBHOOK_SECRET' }
  if (webhookSecret) {
    try {
      const rawBody = '{"verify":true}'
      const webhookId = 'verify_msg_id'
      const webhookTimestamp = String(Math.floor(Date.now() / 1000))
      const secret = webhookSecret.replace(/^whsec_/i, '')
      const secretBytes = Buffer.from(secret, 'base64')
      const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`
      const hmac = crypto.createHmac('sha256', secretBytes)
      hmac.update(signedContent)
      const expectedSignature = hmac.digest('base64')
      const ok = verifyFathomWebhook(
        rawBody,
        webhookId,
        webhookTimestamp,
        expectedSignature,
        webhookSecret,
      )
      signatureRoundTrip = ok
        ? { ok: true }
        : { ok: false, detail: 'verifyFathomWebhook devolvió false (revisá el whsec_)' }
    } catch (e) {
      signatureRoundTrip = {
        ok: false,
        detail: e instanceof Error ? e.message : 'Error al probar firma',
      }
    }
  }

  if (!meetingsOk) {
    return NextResponse.json(
      {
        ok: false,
        meetings: {
          status: meetingsRes.status,
          body: meetingsBody,
        },
        webhook_signature_test: signatureRoundTrip,
      },
      { status: meetingsRes.status },
    )
  }

  return NextResponse.json({
    ok: true,
    message: 'Fathom API key válida (listado de meetings).',
    meetings: meetingsSummary,
    webhook_secret_configured: Boolean(webhookSecret),
    webhook_signature_test: signatureRoundTrip,
  })
}
