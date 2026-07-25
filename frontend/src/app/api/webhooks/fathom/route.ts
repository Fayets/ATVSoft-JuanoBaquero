import { NextResponse } from 'next/server'
import {
  verifyFathomWebhook,
  isTimestampValid,
  getExternalEmail,
  getCallDate,
  getFathomTranscript,
  type FathomWebhookPayload,
} from '@/features/leads/services/fathom-service'
import { analyzeTranscript } from '@/features/leads/services/fathom-transcript-analyzer'

const FALLBACK_WEBHOOK_SECRET = 'whsec_xiN17sPevK2D7Vja6mFOx1fCamo1NZq0'
const FALLBACK_CALENDLY_TOKEN = 'cal_wh_8f3a2b9d7e1c4056a9d2e8f7b3c1a5d4'
const FALLBACK_FATHOM_API_KEY = 'ffOfFvEQn1xVH-umy__wHw.jeULAda2DYOgLgrrf-LcUYCbfgpp5DnXHRhMpzGT0WU'

function getFathomCredentials() {
  return {
    webhookSecret: process.env.FATHOM_WEBHOOK_SECRET || FALLBACK_WEBHOOK_SECRET,
    calendlyToken: process.env.CALENDLY_WEBHOOK_TOKEN || FALLBACK_CALENDLY_TOKEN,
    fathomApiKey: process.env.FATHOM_API_KEY || FALLBACK_FATHOM_API_KEY,
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const webhookId = request.headers.get('webhook-id') || ''
    const webhookTimestamp = request.headers.get('webhook-timestamp') || ''
    const webhookSignature = request.headers.get('webhook-signature') || ''

    const creds = getFathomCredentials()

    if (webhookId && webhookTimestamp && webhookSignature) {
      if (!isTimestampValid(webhookTimestamp)) {
        return NextResponse.json({ error: 'Timestamp too old' }, { status: 401 })
      }
      if (
        creds.webhookSecret &&
        !verifyFathomWebhook(rawBody, webhookId, webhookTimestamp, webhookSignature, creds.webhookSecret)
      ) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const payload: FathomWebhookPayload = JSON.parse(rawBody)

    if (!payload.url && !payload.share_url) {
      return NextResponse.json({ error: 'Invalid Fathom payload' }, { status: 400 })
    }

    const email = getExternalEmail(payload)
    const callDate = getCallDate(payload)
    const callLink = payload.share_url || payload.url

    console.log('[Fathom] email:', email, 'date:', callDate, 'link:', callLink)

    let transcript = ''
    if (payload.transcript?.length) {
      transcript = payload.transcript.map(t => `${t.speaker_name}: ${t.text}`).join('\n')
    } else {
      try {
        transcript = await getFathomTranscript(payload.url, creds.fathomApiKey)
      } catch {
        return NextResponse.json({ success: true, lead_id: null, action: 'link_updated_no_transcript' })
      }
    }

    if (transcript) {
      const analysis = await analyzeTranscript(transcript)
      console.log('[Fathom] Analysis status:', analysis.status)
    }

    return NextResponse.json({ success: true, lead_id: null, action: 'fully_analyzed' })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'fathom-webhook' })
}
