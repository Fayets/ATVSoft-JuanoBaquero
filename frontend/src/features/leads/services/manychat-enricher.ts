const MANYCHAT_BASE_URL = 'https://api.manychat.com/fb'

async function getManychatApiKey(): Promise<string> {
  return process.env.MANYCHAT_API_KEY?.trim() || ''
}

type ManychatTag = { id: number; name: string }
type ManychatSubscriber = {
  id: string
  ig_username: string | null
  subscribed: string
  tags: ManychatTag[]
  name: string
}

export type EnrichmentResult = {
  entry_funnel: string | null
  agenda_point: string | null
}

function extractIgUsername(igHandle: string): string {
  if (!igHandle) return ''
  const match = igHandle.match(/instagram\.com\/([^/?]+)/)
  if (match) return match[1].toLowerCase().replace(/\/$/, '')
  return igHandle.toLowerCase().replace('@', '')
}

function isCtaTag(tagName: string): boolean {
  const upper = tagName.toUpperCase()
  return upper.includes('CTA') ||
    upper.includes('HISTORIA') ||
    upper.includes('REEL') ||
    upper.includes('VSL') ||
    upper.includes('CARRUSEL') ||
    upper.includes('RESPONDIERON')
}

async function findSubscriber(name: string, igUsername: string, email?: string | null): Promise<ManychatSubscriber | null> {
  const apiKey = await getManychatApiKey()
  if (!apiKey) return null
  const target = igUsername.toLowerCase()
  const headers = { 'Authorization': `Bearer ${apiKey}` }

  // Estrategia 1: buscar por email
  if (email) {
    const res = await fetch(`${MANYCHAT_BASE_URL}/subscriber/findBySystemField?email=${encodeURIComponent(email)}`, { headers })
    if (res.ok) {
      const data = await res.json()
      if (data.status === 'success' && data.data?.ig_username?.toLowerCase() === target) return data.data
    }
  }

  // Estrategia 2: buscar por nombre
  if (name) {
    const terms = [...new Set([name.split(' ')[0], name].filter(Boolean))]
    for (const term of terms) {
      const res = await fetch(`${MANYCHAT_BASE_URL}/subscriber/findByName?name=${encodeURIComponent(term)}`, { headers })
      if (!res.ok) continue
      const data = await res.json()
      if (data.status !== 'success' || !data.data) continue
      const match = data.data.find((s: ManychatSubscriber) => s.ig_username?.toLowerCase() === target)
      if (match) return match
    }
  }

  return null
}

export async function enrichLeadFromManychat(
  clientName: string,
  igHandle: string | null,
  email?: string | null
): Promise<EnrichmentResult> {
  const empty: EnrichmentResult = { entry_funnel: null, agenda_point: null }

  if (!igHandle) return empty

  try {
    const igUsername = extractIgUsername(igHandle)
    if (!igUsername) return empty

    const subscriber = await findSubscriber(clientName || '', igUsername, email)
    if (!subscriber) return empty

    const ctaTags = subscriber.tags.filter(t => isCtaTag(t.name))
    if (ctaTags.length === 0) return empty

    return {
      entry_funnel: ctaTags[ctaTags.length - 1].name.trim(),
      agenda_point: ctaTags[0].name.trim(),
    }
  } catch {
    return empty
  }
}
