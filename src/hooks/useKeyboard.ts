/**
 * useKeyboard.ts
 *
 * Tracks which keyboard keys are currently held down.
 * Returns a stable ref (not state) so reads are free — no re-renders.
 *
 * Usage:
 *   const keys = useKeyboard()
 *   if (keys.current.has('KeyW')) { ... }
 */
import { useEffect, useRef } from 'react'

export function useKeyboard(): React.RefObject<Set<string>> {
  const keys = useRef<Set<string>>(new Set())

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Do not intercept if typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      // Prevent browser shortcuts (e.g. Space scrolling) while in game
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault()
      }
      keys.current.add(e.code)
    }

    const onUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code)
    }

    // Clear all keys when window loses focus (prevents stuck keys)
    const onBlur = () => keys.current.clear()

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    window.addEventListener('blur',    onBlur)

    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup',   onUp)
      window.removeEventListener('blur',    onBlur)
    }
  }, [])

  return keys
}
