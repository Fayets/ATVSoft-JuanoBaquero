import { NextResponse } from 'next/server'
import {
  mapCalendlyToLead,
  getEmailFromPayload,
  isCreatedEvent,
  isCanceledEvent,
} from '@/features/leads/services/calendly-mapper'
import { enrichLeadFromManychat } from '@/features/leads/services/manychat-enricher'

async function getCalendlyToken() {
  return process.env.CALENDLY_WEBHOOK_TOKEN || 'cal_wh_8f3a2b9d7e1c4056a9d2e8f7b3c1a5d4'
}

// POST /api/webhooks/calendly — Recibe eventos de Calendly (persistencia en backend FastAPI)
export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!body.event || !body.payload) {
      return NextResponse.json({ error: 'Invalid Calendly payload' }, { status: 400 })
    }

    const webhookToken = await getCalendlyToken()

    if (isCreatedEvent(body)) {
      const params = mapCalendlyToLead(body, webhookToken)
      try {
        await enrichLeadFromManychat(params.p_client_name, params.p_ig_handle, params.p_email)
      } catch {
        /* ManyChat opcional */
      }
      return NextResponse.json({ success: true, lead_id: null })
    }

    if (isCanceledEvent(body)) {
      return NextResponse.json({ success: true, action: 'canceled' })
    }

    return NextResponse.json({ success: true, action: 'ignored' })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'calendly-webhook' })
}
