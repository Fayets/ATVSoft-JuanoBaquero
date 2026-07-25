// Mapea el payload de Calendly webhook a los parámetros del RPC log_calendly_lead

type CalendlyQuestion = {
  question: string
  answer: string
}

type CalendlyPayload = {
  event: string
  payload: {
    name: string
    email: string
    created_at: string
    uri: string
    scheduled_event: {
      uri: string
      start_time: string
      end_time: string
    }
    questions_and_answers: CalendlyQuestion[]
  }
}

// Mapea preguntas de Calendly por contenido (no por índice)
function findAnswer(questions: CalendlyQuestion[], keyword: string): string | null {
  const q = questions.find(q =>
    q.question.toLowerCase().includes(keyword.toLowerCase())
  )
  return q?.answer || null
}

function parseCalendlyDate(isoString: string): string {
  // Calendly envía ISO 8601 UTC, convertimos a YYYY-MM-DD
  return isoString.split('T')[0]
}

function parseMonth(isoString: string): string {
  const date = new Date(isoString)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function mapCalendlyToLead(body: CalendlyPayload, webhookToken: string) {
  const { payload } = body
  const qa = payload.questions_and_answers || []

  return {
    p_webhook_token: webhookToken,
    p_client_name: payload.name,
    p_email: payload.email,
    p_phone: findAnswer(qa, 'telefono') || findAnswer(qa, 'phone'),
    p_ig_handle: findAnswer(qa, 'instagram'),
    p_avatar_type: findAnswer(qa, 'perfil') || findAnswer(qa, 'opciones describe'),
    p_scheduled_at: parseCalendlyDate(payload.created_at),
    p_call_at: parseCalendlyDate(payload.scheduled_event.start_time),
    p_compromiso: findAnswer(qa, 'comprometida') || findAnswer(qa, 'decision'),
    p_dolores_setting: findAnswer(qa, 'problema') || findAnswer(qa, 'cuello de botella'),
    p_urgencia: findAnswer(qa, 'pronto') || findAnswer(qa, 'resolver'),
    p_disposicion_invertir: findAnswer(qa, 'invertir') || findAnswer(qa, 'dispuesto'),
    p_calendly_event_uri: payload.scheduled_event.uri,
    p_calendly_invitee_uri: payload.uri,
    p_month: parseMonth(payload.scheduled_event.start_time),
  }
}

export function getEmailFromPayload(body: CalendlyPayload): string {
  return body.payload.email
}

export function getEventUri(body: CalendlyPayload): string {
  return body.payload.scheduled_event.uri
}

export function isCreatedEvent(body: CalendlyPayload): boolean {
  return body.event === 'invitee.created'
}

export function isCanceledEvent(body: CalendlyPayload): boolean {
  return body.event === 'invitee.canceled'
}
