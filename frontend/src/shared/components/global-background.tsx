'use client'

import { EtheralShadow } from '@/components/ui/etheral-shadow'

export function GlobalBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <EtheralShadow
        color="rgba(230, 57, 70, 0.5)"
        animation={{ scale: 30, speed: 8 }}
        noise={{ opacity: 0.3, scale: 1 }}
        sizing="fill"
        className="w-full h-full"
      />
    </div>
  )
}
