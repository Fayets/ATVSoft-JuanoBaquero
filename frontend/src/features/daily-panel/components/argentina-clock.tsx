'use client'

import { memo, useEffect, useState } from 'react'

const AR_TZ = 'America/Argentina/Buenos_Aires'

/** Reloj aislado: el tick no re-renderiza el resto del panel. */
export const ArgentinaClock = memo(function ArgentinaClock({ active }: { active: boolean }) {
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
          timeZone: AR_TZ,
        }).format(new Date()),
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])

  if (!clock) return null
  return <span className="neo-panel__clock">{clock}</span>
})
