import { NextResponse } from 'next/server'

const KNOWN_PROGRAMS = ['Mentoría', 'Mentoria', 'Advantage', 'Boost', 'Mastermind']

// GET /api/typeform?month=2026-03&programa=Mentoría
export async function GET(request: Request) {
  const token = process.env.TYPEFORM_API_KEY
  if (!token) {
    return NextResponse.json({
      total: 0,
      totalAll: 0,
      avgConviction: 0,
      programs: [],
      data: {
        tiempoDecision: [],
        problemas: [],
        comoConocio: [],
        motivacion: [],
        impedimento: [],
      },
    })
  }

  const formId = 'Xwop0t7t' // ATV Forms (Onboarding)
  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  const programaFilter = url.searchParams.get('programa') // e.g. "Mentoría"

  try {
    let apiUrl = `https://api.typeform.com/forms/${formId}/responses?page_size=200`
    if (month) {
      const [y, m] = month.split('-').map(Number)
      const since = new Date(y, m - 1, 1).toISOString()
      const until = new Date(y, m, 0, 23, 59, 59).toISOString()
      apiUrl += `&since=${since}&until=${until}`
    }

    const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return NextResponse.json({ error: 'Typeform API error' }, { status: 500 })
    const data = await res.json()

    const fieldMap: Record<string, string> = {
      'yYToXWN8fXnc': 'tiempoDecision',
      'h0AQWvLZ6RJk': 'problemas',
      '6jEkLrPR1gkc': 'comoConocio',
      'OnWWSQD925ac': 'motivacion',
      '4RCFK9h4aO35': 'impedimento',
    }

    const counts: Record<string, Record<string, number>> = {}
    for (const key of Object.values(fieldMap)) counts[key] = {}

    const convictionScores: number[] = []
    const programsFound = new Set<string>()
    let filteredTotal = 0

    for (const item of data.items || []) {
      // Detect program for this response
      let responseProgram: string | null = null
      for (const ans of item.answers || []) {
        if (ans.type === 'choice') {
          const label = ans.choice?.label || ''
          if (KNOWN_PROGRAMS.some(p => label.toLowerCase().includes(p.toLowerCase()))) {
            responseProgram = label
            programsFound.add(label)
          }
        }
      }

      // Filter by programa if specified
      if (programaFilter && responseProgram !== programaFilter) continue
      filteredTotal++

      for (const ans of item.answers || []) {
        // Conviction scale
        if (ans.field?.id === '6h3NmWdTWaKu' && ans.type === 'number') {
          convictionScores.push(Number(ans.number) || 0)
          continue
        }

        const key = fieldMap[ans.field?.id]
        if (!key) continue
        if (ans.type === 'choice') {
          const label = ans.choice?.label || ''
          if (label) counts[key][label] = (counts[key][label] || 0) + 1
        } else if (ans.type === 'choices') {
          for (const c of (ans.choices?.labels || [])) {
            if (c) counts[key][c] = (counts[key][c] || 0) + 1
          }
        }
      }
    }

    // Also detect programs even when filtering (scan all items for program discovery)
    if (programaFilter) {
      for (const item of data.items || []) {
        for (const ans of item.answers || []) {
          if (ans.type === 'choice') {
            const label = ans.choice?.label || ''
            if (KNOWN_PROGRAMS.some(p => label.toLowerCase().includes(p.toLowerCase()))) {
              programsFound.add(label)
            }
          }
        }
      }
    }

    const result: Record<string, { label: string; count: number }[]> = {}
    for (const [key, val] of Object.entries(counts)) {
      result[key] = Object.entries(val).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    }

    const avgConviction = convictionScores.length > 0
      ? Math.round((convictionScores.reduce((s, v) => s + v, 0) / convictionScores.length) * 10) / 10
      : 0

    return NextResponse.json({
      total: filteredTotal,
      totalAll: data.items?.length || 0,
      avgConviction,
      programs: Array.from(programsFound).sort(),
      data: result,
    })
  } catch (e) {
    return NextResponse.json({ error: `Typeform error: ${(e as Error).message}` }, { status: 500 })
  }
}
