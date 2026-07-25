'use client'

import { useEffect } from 'react'

export function PointerTracker() {
  useEffect(() => {
    let currentCard: HTMLElement | null = null
    let rafId = 0

    const sync = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      const raw = target.closest('.glass-card') as HTMLElement | null
      const card =
        raw && !raw.classList.contains('glass-card--performant') ? raw : null

      // Clear previous card if cursor left it
      if (currentCard && currentCard !== card) {
        currentCard.style.removeProperty('--mx')
        currentCard.style.removeProperty('--my')
        currentCard.classList.remove('glass-card--hover')
        currentCard = null
      }

      // Set local coordinates on the hovered card
      if (card) {
        const rect = card.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        card.style.setProperty('--mx', `${x}px`)
        card.style.setProperty('--my', `${y}px`)
        card.classList.add('glass-card--hover')
        currentCard = card
      }
    }

    const leave = () => {
      if (currentCard) {
        currentCard.style.removeProperty('--mx')
        currentCard.style.removeProperty('--my')
        currentCard.classList.remove('glass-card--hover')
        currentCard = null
      }
    }

    const onMove = (e: PointerEvent) => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        sync(e)
      })
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', leave)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return null
}
