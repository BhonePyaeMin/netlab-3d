/**
 * usePointerLock.ts
 *
 * Manages the browser Pointer Lock API.
 *
 * Returns:
 *   isLocked  — reactive boolean (React state) — true when mouse is captured
 *   request() — call from a click handler to request pointer lock
 *   exit()    — call to release pointer lock programmatically
 *
 * Ctrl key toggles "free mouse" mode — pointer lock exits,
 * cursor becomes visible, camera stops moving.
 * Press Ctrl again or click to re-lock.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export function usePointerLock(targetRef: React.RefObject<HTMLCanvasElement | null>) {
  const [isLocked, setIsLocked] = useState(false)
  const cliOpenRef   = useRef(false)
  const freeMouseRef = useRef(false)

  /* ── Request pointer lock (guards: not in CLI, not in free-mouse) ── */
  const request = useCallback(() => {
    const el = targetRef.current ?? document.querySelector('canvas')
    if (el && !document.pointerLockElement && !cliOpenRef.current && !freeMouseRef.current) {
      el.requestPointerLock()
    }
  }, [targetRef])

  const exit = useCallback(() => {
    if (document.pointerLockElement) document.exitPointerLock()
  }, [])

  useEffect(() => {
    const canvas = targetRef.current ?? document.querySelector('canvas') as HTMLCanvasElement | null

    /* ── Pointer lock state change ──────────────────────────── */
    const onChange = () => {
      const el = targetRef.current ?? document.querySelector('canvas')
      setIsLocked(document.pointerLockElement === el)
    }
    const onError = () => setIsLocked(false)

    /* ── CLI open/close tracking ────────────────────────────── */
    const onCliOpen  = () => { cliOpenRef.current = true }
    const onCliClose = () => { cliOpenRef.current = false }

    /* ── Free-mouse tracking (from netlab:freemouse events) ─── */
    const onFreeMouse = (e: Event) => {
      freeMouseRef.current = (e as CustomEvent).detail.active
    }

    /* ── Ctrl key → toggle free-mouse mode ─────────────────── */
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        e.preventDefault()
        if (cliOpenRef.current) return  // CLI is open, ignore Ctrl

        if (!freeMouseRef.current) {
          // → Enter free-mouse: exit lock, show cursor
          freeMouseRef.current = true
          document.exitPointerLock()
          if (canvas) canvas.style.cursor = 'default'
          document.body.style.cursor = 'default'
          window.dispatchEvent(new CustomEvent('netlab:freemouse', { detail: { active: true } }))
        } else {
          // → Exit free-mouse: re-lock, hide cursor
          freeMouseRef.current = false
          if (canvas) canvas.style.cursor = ''
          document.body.style.cursor = ''
          window.dispatchEvent(new CustomEvent('netlab:freemouse', { detail: { active: false } }))
          const el = canvas ?? document.querySelector('canvas')
          if (el) el.requestPointerLock()
        }
      }
    }

    /* ── Click → request lock (with all guards) ─────────────── */
    // Use native listener with capture:false so React stopPropagation works
    const onClickNative = () => {
      if (!document.pointerLockElement && !cliOpenRef.current && !freeMouseRef.current) {
        const el = canvas ?? document.querySelector('canvas')
        if (el) el.requestPointerLock()
      }
    }

    document.addEventListener('pointerlockchange', onChange)
    document.addEventListener('pointerlockerror',  onError)
    document.addEventListener('click', onClickNative)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('netlab:openCLI',   onCliOpen)
    window.addEventListener('netlab:closeCLI',  onCliClose)
    window.addEventListener('netlab:freemouse', onFreeMouse)

    return () => {
      document.removeEventListener('pointerlockchange', onChange)
      document.removeEventListener('pointerlockerror',  onError)
      document.removeEventListener('click', onClickNative)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('netlab:openCLI',   onCliOpen)
      window.removeEventListener('netlab:closeCLI',  onCliClose)
      window.removeEventListener('netlab:freemouse', onFreeMouse)
    }
  }, [request, targetRef])

  return { isLocked, request, exit }
}
