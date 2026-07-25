import { MainLayoutShell } from '@/shared/components/main-layout-shell'
import { AppProviders } from '@/shared/components/app-providers'
import { AuthGuard } from '@/shared/components/auth-guard'
import { PointerTracker } from '@/shared/components/pointer-tracker'

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AppProviders>
      <AuthGuard>
        <div className="relative min-h-screen">
          <PointerTracker />
          <div aria-hidden="true" className="app-dots-bg" />
          <div className="relative z-[1]">
            <MainLayoutShell>{children}</MainLayoutShell>
          </div>
        </div>
      </AuthGuard>
    </AppProviders>
  )
}
