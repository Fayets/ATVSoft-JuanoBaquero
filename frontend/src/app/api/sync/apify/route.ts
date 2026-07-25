import { requireNumericUserId } from '@/lib/request-user'
import { NextResponse } from 'next/server'

// POST /api/sync/apify — Sync Instagram Reels via Apify (sin persistencia en Next)
export async function POST(request: Request) {
  const uid = requireNumericUserId(request)
  if (uid instanceof NextResponse) return uid
  void uid

  const body = await request.json()
  const { apiToken, igHandle, limit = 20 } = body

  if (!apiToken || !igHandle) {
    return NextResponse.json({ error: 'Missing apiToken or igHandle' }, { status: 400 })
  }

  try {
    const actorUrl = `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/runs?token=${encodeURIComponent(apiToken)}`
    const igUrl = `https://www.instagram.com/${igHandle.replace('@', '')}/`

    const startResp = await fetch(actorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: [igUrl],
        resultsLimit: Math.min(limit, 100),
        includeTranscript: true,
        skipPinnedPosts: false,
      }),
    })

    if (!startResp.ok) {
      const errText = await startResp.text()
      return NextResponse.json({ error: `Apify start failed (${startResp.status}): ${errText.substring(0, 200)}` }, { status: 500 })
    }

    const runInfo = await startResp.json()
    const runId = runInfo.data?.id
    const datasetId = runInfo.data?.defaultDatasetId
    if (!runId) return NextResponse.json({ error: 'Apify did not return a run ID' }, { status: 500 })

    const maxWait = 300000
    let waited = 0
    const pollInterval = 5000
    let runStatus = 'RUNNING'

    while (runStatus === 'RUNNING' || runStatus === 'READY') {
      if (waited >= maxWait) return NextResponse.json({ error: 'Timeout: scraper took more than 5 min' }, { status: 504 })
      await new Promise(r => setTimeout(r, pollInterval))
      waited += pollInterval

      const pollResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(apiToken)}`)
      if (pollResp.ok) {
        const pollData = await pollResp.json()
        runStatus = pollData.data?.status || 'FAILED'
      }
    }

    if (runStatus !== 'SUCCEEDED') {
      return NextResponse.json({ error: `Scraper finished with status: ${runStatus}` }, { status: 500 })
    }

    const dsResp = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(apiToken)}&limit=100`)
    if (!dsResp.ok) return NextResponse.json({ error: `Failed to fetch dataset (${dsResp.status})` }, { status: 500 })
    const posts = await dsResp.json()

    if (!posts || !posts.length) {
      return NextResponse.json({ error: `No results for @${igHandle}` }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      total: posts.length,
      new: 0,
      updated: 0,
      message: 'Sincronización de escritura: usar backend FastAPI.',
    })
  } catch (e) {
    return NextResponse.json({ error: `Sync failed: ${(e as Error).message}` }, { status: 500 })
  }
}
