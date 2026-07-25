'use client'

import { createContext, useContext } from 'react'
import { useMonth } from '@/shared/hooks/use-month'
import { ToastProvider } from './toast'

type MonthContextType = ReturnType<typeof useMonth>

const MonthContext = createContext<MonthContextType | null>(null)

export function useMonthContext() {
  const ctx = useContext(MonthContext)
  if (!ctx) throw new Error('useMonthContext must be inside AppProviders')
  return ctx
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const monthState = useMonth()

  return (
    <MonthContext.Provider value={monthState}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </MonthContext.Provider>
  )
}
