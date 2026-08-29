/**
 * TerminalOverlay — the flat 2D framing of a console session.
 *
 * Owns the `netlab:openCLI` / `netlab:closeCLI` bridge for the whole app, but
 * only *renders* when the session is in 2D mode; in 3D mode ConsoleStation
 * draws the same live session onto the MacBook's display instead.
 *
 * All console behaviour lives in TerminalSession, and all console UI lives in
 * TerminalScreen — this file is just the scrim and the window box.
 */
import { useEffect, useRef, useState } from 'react'
import TerminalScreen, { useTerminalSession } from './TerminalScreen'
import { TerminalSession } from '../terminal/TerminalSession'
import { handleTerminalKey } from '../terminal/keyHandler'
import '../terminal/terminal.css'

export default function TerminalOverlay() {
  const session = useTerminalSession()
  const [showPanes, setShowPanes] = useState(true)
  const [maximized, setMaximized] = useState(false)
  /** Captures typing while the console lives on the 3D display. */
  const hiddenInput = useRef<HTMLInputElement>(null)

  /* ── Session bridge — one listener for both presentations ─────── */
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { deviceId } = (e as CustomEvent).detail as { deviceId: string }
      void TerminalSession.open(deviceId)
      // Typing needs the cursor back.
      if (document.pointerLockElement) document.exitPointerLock()
    }
    window.addEventListener('netlab:openCLI', onOpen)
    return () => window.removeEventListener('netlab:openCLI', onOpen)
  }, [])

  const close = () => {
    TerminalSession.close()
    setTimeout(() => window.dispatchEvent(new CustomEvent('netlab:closeCLI')), 50)
  }

  // Escape closes from the 3D view too, where focus may be outside the input.
  useEffect(() => {
    if (!session.deviceId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.deviceId])

  if (!session.deviceId) return null

  /* ── 3D mode ────────────────────────────────────────────────────
   * The console is painted onto the laptop's panel by ConsoleStation, so all
   * this needs to contribute is a real focused input — the browser will not
   * deliver keystrokes to a canvas texture — plus a way back to the 2D window.
   */
  if (session.view === '3d') {
    return (
      <>
        <input
          ref={hiddenInput}
          className="nl-term-capture"
          value={session.input}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          aria-label={`Console input for ${session.deviceId}`}
          onChange={e => TerminalSession.setInput(e.target.value)}
          onKeyDown={e => handleTerminalKey(e, { onClose: close })}
          onBlur={() => {
            // Losing focus would silently stop the console accepting input.
            requestAnimationFrame(() => hiddenInput.current?.focus())
          }}
        />
        <div className="nl-term-3dbar">
          <span className="nl-term-3dbar-host">{session.deviceId}</span>
          <span className="nl-term-3dbar-hint">F4 camera · Esc close</span>
          <button className="nl-term-3dbar-btn"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => window.dispatchEvent(new CustomEvent('netlab:cycleShot'))}>
            camera
          </button>
          <button className="nl-term-3dbar-btn"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => TerminalSession.setView('2d')}>
            2D console
          </button>
        </div>
      </>
    )
  }

  return (
    <div
      className="nl-term-scrim"
      onClick={(e) => {
        e.nativeEvent.stopImmediatePropagation()
        e.stopPropagation()
        close()
      }}
    >
      <div
        style={{
          width: maximized ? '98%' : '88%',
          maxWidth: 1500,
          height: maximized ? '95%' : '78%',
          display: 'flex',
          cursor: 'default',
        }}
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
        }}
        onDoubleClick={() => setMaximized(v => !v)}
      >
        <TerminalScreen
          variant="window"
          showPanes={showPanes}
          onTogglePanes={setShowPanes}
          onClose={close}
          titleBarExtra={
            <span
              className="nl-tab nl-tab-alt"
              onClick={(e) => { e.stopPropagation(); TerminalSession.setView('3d') }}
              title="Return to the 3D console"
            >
              3D
            </span>
          }
        />
      </div>
    </div>
  )
}
