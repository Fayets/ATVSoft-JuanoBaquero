'use client'

import { memo, useEffect, useState } from 'react'
import { useTimezone } from '@/shared/hooks/use-timezone'

/** Reloj del panel: usa la timezone del tenant (header). */
export const ArgentinaClock = memo(function ArgentinaClock({ active }: { active: boolean }) {
  const { timeZone, option } = useTimezone()
  const [clock, setClock] = useState('')

  useEffect(() => {
    if (!active) {
      setClock('')
      return undefined
    }
    const tick = () => {
      setClock(
        new Intl.DateTimeFormat('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZone,
        }).format(new Date()),
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active, timeZone])

  if (!clock) return null
  return (
    <span className="neo-panel__clock" title={`${option.label} (${timeZone})`}>
      {clock}
    </span>
  )
})
