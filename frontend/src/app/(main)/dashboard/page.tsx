'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const DashboardPage = dynamic(() => import('./dashboard-view'), {
  loading: () => <PageLoading />,
})

export default function DashboardRoute() {
  return <DashboardPage />
}
