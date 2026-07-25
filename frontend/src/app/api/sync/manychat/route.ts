import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

const MANYCHAT_API = 'https://api.manychat.com'

// GET /api/sync/manychat?action=tags — Fetch tags from ManyChat
// GET /api/sync/manychat?action=tag_contacts&tag_id=123 — Fetch contacts with a tag
export async function GET(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid
  void uid

  const apiKey = process.env.MANYCHAT_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: 'MANYCHAT_API_KEY not configured' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'tags'

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  }

  try {
    if (action === 'tags') {
      const resp = await fetch(`${MANYCHAT_API}/fb/page/getTags`, { headers })
      if (!resp.ok) {
        const err = await resp.text()
        return NextResponse.json({ error: `ManyChat API error: ${err}` }, { status: resp.status })
      }
      const data = await resp.json()
      return NextResponse.json({ tags: data.data || [] })
    }

    if (action === 'tag_contacts') {
      const tagId = searchParams.get('tag_id')
      if (!tagId) return NextResponse.json({ error: 'Missing tag_id' }, { status: 400 })

      const resp = await fetch(`${MANYCHAT_API}/fb/subscriber/getInfoByTag?tag_id=${tagId}`, { headers })
      if (!resp.ok) {
        const err = await resp.text()
        return NextResponse.json({ error: `ManyChat API error: ${err}` }, { status: resp.status })
      }
      const data = await resp.json()
      return NextResponse.json({ contacts: data.data || [] })
    }

    if (action === 'sync_content_chats') {
      const tagId = searchParams.get('tag_id')
      if (!tagId) return NextResponse.json({ error: 'Missing tag_id' }, { status: 400 })

      const resp = await fetch(`${MANYCHAT_API}/fb/subscriber/getInfoByTag?tag_id=${tagId}`, { headers })
      if (!resp.ok) {
        const err = await resp.text()
        return NextResponse.json({ error: `ManyChat API error: ${err}` }, { status: resp.status })
      }
      const data = await resp.json()
      const contacts = data.data || []
      const chatsCount = contacts.length
      return NextResponse.json({ chats: chatsCount, contacts_count: contacts.length })
    }

    if (action === 'sync_all_content_chats') {
      return NextResponse.json({ synced: 0, message: 'Listado de contenidos: usar backend FastAPI.' })
    }

    return NextResponse.json({ error: 'Unknown action. Use: tags, tag_contacts, sync_content_chats, sync_all_content_chats' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: `Request failed: ${err}` }, { status: 500 })
  }
}
