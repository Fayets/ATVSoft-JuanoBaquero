'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useMonthContext } from '@/shared/components/app-providers'
import { getLeadsAnalytics, type LeadRow, type LeadsAnalytics } from '../services/leads-analytics'

export function useLeadsAnalytics() {
  const { month } = useMonthContext()
  const { ready, userId } = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [analytics, setAnalytics] = useState<LeadsAnalytics | null>(null)
  const [prevAnalytics, setPrevAnalytics] = useState<LeadsAnalytics | null>(null)

  const fetch = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)

    const [y, m] = month.split('-').map(Number)
    const prevMonth = `${new Date(y, m - 2, 1).getFullYear()}-${String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0')}`

    const [curr, prev] = await Promise.all([getLeadsAnalytics(month), getLeadsAnalytics(prevMonth)])

    setLeads(curr.leads)
    setAnalytics(curr.analytics)
    setPrevAnalytics(prev.analytics)
    setLoading(false)
  }, [month, ready, userId])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { loading, leads, analytics, prevAnalytics, refetch: fetch }
}
