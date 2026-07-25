'use client'

import { useState, useCallback, createContext, useContext } from 'react'

type ToastContextType = {
  toast: (message: string) => void
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)

  const toast = useCallback((msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {message && (
        <div className="fixed bottom-6 right-6 z-[200] glass-card px-5 py-3 text-[13px] text-[var(--text)] shadow-lg animate-[rowIn_0.2s_ease]">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
