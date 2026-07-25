'use client'

import dynamic from 'next/dynamic'
import { PageLoading } from '@/shared/components/page-loading'

const SalesDashboardPage = dynamic(
  () =>
    import('@/features/sales-dashboard/components/sales-dashboard-page').then((m) => ({
      default: m.SalesDashboardPage,
    })),
  { loading: () => <PageLoading /> },
)

export default function SalesDashRoute() {
  return <SalesDashboardPage />
}
