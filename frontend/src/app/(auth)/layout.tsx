import { ThemeToggle } from '@/shared/components/theme-toggle'
import { BrandLogo } from '@/shared/components/brand-logo'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--bg)]">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md px-6">
        <div className="mb-8 flex justify-center">
          <BrandLogo className="h-20 w-auto max-w-[120px] flex-shrink-0 object-contain opacity-95" />
        </div>

        <div className="glass-card relative p-8 accent-top">
          {children}
        </div>
      </div>
    </div>
  )
}
