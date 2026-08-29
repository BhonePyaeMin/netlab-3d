/**
 * TerminalOverlay — full console emulator for device access.
 *
 * Replaces the previous plain-text box with something that behaves like an
 * attached serial console inside a tmux session:
 *
 *   ┌ console ────────────────┬ live capture ─────┐
 *   │ boot POST + device card │ protocol table    │
 *   │ ANSI-coloured scrollback├───────────────────┤
 *   │ prompt ▉                │ tcpdump -X hexdump│
 *   └─────────────────────────┴───────────────────┘
 *   [netlab] 0:console* 1:capture      priv | 12:04:31
 *
 * Output still comes from the unchanged CLIEngine/GNS3Connector; this module
 * adds the presentation layer — ANSI parsing, semantic colour, streamed
 * rendering, the side panes and the CRT treatment.
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { simulationEngine } from '../network/engine/globalEngine'
import { gns3Connector }    from '../network/engine/GNS3Connector'
import { useNetworkStore }  from '../network/useNetworkStore'
import { parseAnsi }        from '../terminal/ansi'
import type { Style }       from '../terminal/ansi'
import { C }                from '../terminal/ansi'
import { highlight, highlightPrompt } from '../terminal/highlight'
import { bootSequence, deviceCard, motd } from '../terminal/banner'
import { dumpPacket }       from '../terminal/hexdump'
import { CHROME, protoColor } from '../terminal/theme'
import type { CapturedPacket } from '../network/types'

/** Hard cap on scrollback so a chatty session can't grow the DOM without end. */
const MAX_SCROLLBACK = 2000
/** Lines revealed per animation frame while output streams in. */
const LINES_PER_FRAME = 3

export default function TerminalOverlay() {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [lines, setLines]       = useState<string[]>([])
  const [input, setInput]       = useState('')
  const [prompt, setPrompt]     = useState('')
  const [busy, setBusy]         = useState(false)
  const [showPanes, setShowPanes] = useState(true)
  const [maximized, setMaximized]  = useState(false)
  const [clock, setClock]       = useState(() => new Date())

  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex]     = useState(-1)
  const [terminalType, setTerminalType]     = useState('cisco_ios')

  const inputRef   = useRef<HTMLInputElement>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const queueRef   = useRef<string[]>([])
  const rafRef     = useRef<number | null>(null)

  const { capturedPackets, capturingCableId } = useNetworkStore()

  /* ─── Streamed output ───────────────────────────────────────────────
   * Lines are queued and revealed a few per frame. A real console never
   * paints a 60-line `show run` in a single tick, and the stagger is what
   * sells it. Flush is idempotent and cancels cleanly on unmount.
   */
  const pump = useCallback(() => {
    if (queueRef.current.length === 0) {
      rafRef.current = null
      setBusy(false)
      return
    }
    const chunk = queueRef.current.splice(0, LINES_PER_FRAME)
    setLines(prev => {
      const next = prev.concat(chunk)
      return next.length > MAX_SCROLLBACK ? next.slice(next.length - MAX_SCROLLBACK) : next
    })
    rafRef.current = requestAnimationFrame(pump)
  }, [])

  const emit = useCallback((newLines: string[], stream = true) => {
    if (newLines.length === 0) return
    if (!stream) {
      setLines(prev => {
        const next = prev.concat(newLines)
        return next.length > MAX_SCROLLBACK ? next.slice(next.length - MAX_SCROLLBACK) : next
      })
      return
    }
    queueRef.current.push(...newLines)
    setBusy(true)
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(pump)
  }, [pump])

  /** Reveal everything still queued — used by Ctrl+C / Enter-to-skip. */
  const flushQueue = useCallback(() => {
    if (queueRef.current.length === 0) return
    const rest = queueRef.current
    queueRef.current = []
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setLines(prev => {
      const next = prev.concat(rest)
      return next.length > MAX_SCROLLBACK ? next.slice(next.length - MAX_SCROLLBACK) : next
    })
    setBusy(false)
  }, [])

  useEffect(() => () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      // Must null the handle too: `emit` treats a non-null ref as "a pump is
      // already scheduled", so a stale id would stop output forever.
      rafRef.current = null
    }
  }, [])

  /* ─── Session open ──────────────────────────────────────────────── */
  useEffect(() => {
    const onOpen = async (e: Event) => {
      const { deviceId: id } = (e as CustomEvent).detail as { deviceId: string }
      const device = simulationEngine.getDevice(id)

      setDeviceId(id)
      setTerminalType(device?.capabilities?.terminal_type || 'cisco_ios')
      setInput('')
      setCommandHistory([])
      setHistoryIndex(-1)
      setPrompt(simulationEngine.getPrompt(id))

      queueRef.current = []
      setLines([])
      emit([
        C.grey(`Trying ${id} … `) + C.ok('Open'),
        '',
        ...bootSequence(id, device),
        ...deviceCard(id, device),
        ...motd(id),
      ])

      if (document.pointerLockElement) document.exitPointerLock()

      // The GNS3 bridge is optional; when it is absent we stay on the local
      // simulation engine and say so rather than failing silently.
      const conn = await gns3Connector.connectToConsole(id)
      emit([
        conn.success
          ? C.ok('[gns3] ') + C.grey(conn.message)
          : C.grey('[local] ') + C.grey('GNS3 bridge unavailable — using built-in simulation engine.'),
        '',
      ])
    }

    window.addEventListener('netlab:openCLI', onOpen)
    return () => window.removeEventListener('netlab:openCLI', onOpen)
  }, [emit])

  /* ─── Autoscroll + clock ────────────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  useEffect(() => {
    if (!deviceId) return
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [deviceId])

  const closeTerminal = useCallback(() => {
    setDeviceId(null)
    queueRef.current = []
    setTimeout(() => window.dispatchEvent(new CustomEvent('netlab:closeCLI')), 50)
  }, [])

  /* ─── Local (client-side) commands ──────────────────────────────── */
  const runLocal = useCallback((cmd: string): boolean => {
    const c = cmd.toLowerCase()
    if (c === 'clear' || c === 'cls') {
      setLines([])
      return true
    }
    if (c === 'neofetch' || c === 'banner') {
      emit(deviceCard(deviceId!, simulationEngine.getDevice(deviceId!)))
      return true
    }
    if (c === 'logout' || c === 'quit') {
      closeTerminal()
      return true
    }
    return false
  }, [deviceId, emit, closeTerminal])

  /* ─── Key handling ──────────────────────────────────────────────── */
  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!deviceId) return

    // Ctrl+L clears, Ctrl+C aborts the current line / flushes output.
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault(); setLines([]); return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      flushQueue()
      emit([`${highlightPrompt(prompt)} ${input}${C.bRed('^C')}`], false)
      setInput('')
      return
    }
    if (e.key === 'F2') {
      e.preventDefault(); setShowPanes(v => !v); return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const completed = simulationEngine.autoComplete(deviceId, input)
      if (completed !== input) setInput(completed)
      return
    }

    if (e.key === '?') {
      e.preventDefault()
      const help = simulationEngine.getHelp(deviceId, input)
      emit([`${highlightPrompt(prompt)} ${input}?`, ...highlight(help)])
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
        const next = historyIndex + 1
        setHistoryIndex(next)
        setInput(commandHistory[commandHistory.length - 1 - next])
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const next = historyIndex - 1
        setHistoryIndex(next)
        setInput(commandHistory[commandHistory.length - 1 - next])
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setInput('')
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault(); closeTerminal(); return
    }

    if (e.key === 'Enter') {
      // Enter during a long stream skips to the end, as in a real pager.
      // Gate on the queue ref, not the `busy` state: state is stale inside this
      // closure, and a stuck flag would swallow every command.
      if (queueRef.current.length > 0) { flushQueue(); return }

      const cmd = input.trim()
      emit([`${highlightPrompt(prompt)} ${C.bWhite(cmd)}`], false)
      setInput('')
      setHistoryIndex(-1)

      if (!cmd) {
        setPrompt(simulationEngine.getPrompt(deviceId))
        return
      }

      setCommandHistory(prev => [...prev, cmd])
      if (runLocal(cmd)) {
        setPrompt(simulationEngine.getPrompt(deviceId))
        return
      }

      setBusy(true)
      const output = await gns3Connector.executeCommand(deviceId, cmd, terminalType)
      emit(highlight(output))
      setPrompt(simulationEngine.getPrompt(deviceId))
    }
  }

  /* ─── Derived pane data ─────────────────────────────────────────── */
  const recentPackets = useMemo(
    () => capturedPackets.slice(-14).reverse(),
    [capturedPackets],
  )
  const hexLines = useMemo(() => {
    const last = capturedPackets[capturedPackets.length - 1] as CapturedPacket | undefined
    return last
      ? dumpPacket(last, 10)
      : [C.grey('No frame selected.'), '', C.grey('Attach the sniffer to a link (K) to')
        , C.grey('populate this pane with live bytes.')]
  }, [capturedPackets])

  if (!deviceId) return null

  const mode = /\(config/.test(prompt) ? 'config' : prompt.endsWith('#') ? 'priv' : 'user'
  const winW = maximized ? '98%' : '88%'
  const winH = maximized ? '95%' : '78%'

  return (
    <div
      className="nl-term-scrim"
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: CHROME.scrim, backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'auto', cursor: 'pointer',
      }}
      onClick={(e) => {
        e.nativeEvent.stopImmediatePropagation()
        e.stopPropagation()
        closeTerminal()
      }}
    >
      <style>{TERMINAL_CSS}</style>

      <div
        className="nl-term-window"
        style={{ width: winW, maxWidth: 1500, height: winH, cursor: 'default' }}
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          inputRef.current?.focus()
        }}
      >
        {/* ── Title bar ─────────────────────────────────────────── */}
        <div className="nl-term-titlebar">
          <div className="nl-term-lights">
            <span style={{ background: '#ff5f56' }} onClick={closeTerminal} title="Close (Esc)" />
            <span style={{ background: '#ffbd2e' }} onClick={(e) => { e.stopPropagation(); setShowPanes(v => !v) }} title="Toggle panes (F2)" />
            <span style={{ background: '#27c93f' }} onClick={(e) => { e.stopPropagation(); setMaximized(v => !v) }} title="Maximize" />
          </div>

          <div className="nl-term-title">
            <span className="nl-term-title-dim">console —</span>&nbsp;
            <span className="nl-term-title-host">{deviceId}</span>
            <span className="nl-term-title-dim">&nbsp;· {terminalType.replace('_', ' ')}</span>
          </div>

          <div className="nl-term-tabs">
            <span className={`nl-tab${showPanes ? '' : ' nl-tab-on'}`}
                  onClick={(e) => { e.stopPropagation(); setShowPanes(false) }}>0:console</span>
            <span className={`nl-tab${showPanes ? ' nl-tab-on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowPanes(true) }}>1:split</span>
          </div>
        </div>

        {/* ── Panes ─────────────────────────────────────────────── */}
        <div className="nl-term-body">
          {/* Main console */}
          <section className="nl-pane nl-pane-main">
            <header className="nl-pane-head" style={{ color: CHROME.borderActive }}>
              ▍console<span className="nl-pane-head-dim"> · {lines.length} lines</span>
            </header>

            <div className="nl-term-scroll" ref={scrollRef}>
              {lines.map((line, i) => <AnsiLine key={i} line={line} />)}

              <div className="nl-term-inputrow">
                <AnsiLine line={highlightPrompt(prompt)} inline />
                <span className="nl-term-inputwrap">
                  <input
                    ref={inputRef}
                    autoFocus
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                    autoComplete="off"
                    className="nl-term-input"
                    aria-label={`Console input for ${deviceId}`}
                  />
                  <span className="nl-term-cursor" style={{ left: `${input.length}ch` }} />
                </span>
              </div>
              <div style={{ height: 4 }} />
            </div>
          </section>

          {/* Side panes */}
          {showPanes && (
            <div className="nl-side">
              <section className="nl-pane nl-pane-capture">
                <header className="nl-pane-head" style={{ color: CHROME.borderTable }}>
                  ▍live capture
                  <span className="nl-pane-head-dim">
                    {capturingCableId ? ` · ${capturedPackets.length} frames` : ' · idle'}
                  </span>
                </header>
                <div className="nl-term-scroll nl-capture">
                  <table className="nl-cap-table">
                    <thead>
                      <tr>
                        <th>NO</th><th>PROTO</th><th>SOURCE</th><th>DEST</th><th>LEN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPackets.map(p => (
                        <tr key={p.id}>
                          <td className="nl-dim">{p.id}</td>
                          <td style={{ color: protoColor(p.protocol), fontWeight: 700 }}>{p.protocol}</td>
                          <td>{p.srcIp || p.srcMac}</td>
                          <td>{p.dstIp || p.dstMac}</td>
                          <td className="nl-dim">{p.size}</td>
                        </tr>
                      ))}
                      {recentPackets.length === 0 && (
                        <tr><td colSpan={5} className="nl-empty">waiting for frames…</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="nl-pane nl-pane-hex">
                <header className="nl-pane-head" style={{ color: CHROME.borderHex }}>
                  ▍hexdump<span className="nl-pane-head-dim"> · tcpdump -X</span>
                </header>
                <div className="nl-term-scroll nl-hex">
                  {hexLines.map((line, i) => <AnsiLine key={i} line={line} />)}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* ── tmux-style status bar ─────────────────────────────── */}
        <div className="nl-term-status">
          <span className="nl-status-tag">netlab</span>
          <span className="nl-status-seg">{deviceId}</span>
          <span className={`nl-status-mode nl-mode-${mode}`}>{mode}</span>
          {busy && <span className="nl-status-busy">▶ streaming</span>}
          <span className="nl-status-spacer" />
          <span className="nl-status-hint">Tab complete · ? help · ^L clear · F2 panes · Esc close</span>
          <span className="nl-status-clock">{clock.toLocaleTimeString([], { hour12: false })}</span>
        </div>
      </div>
    </div>
  )
}

/* ─── ANSI line renderer ────────────────────────────────────────────── */

function styleToCss(s: Style): React.CSSProperties {
  const fg = s.reverse ? (s.bg ?? CHROME.bg) : s.fg
  const bg = s.reverse ? (s.fg ?? CHROME.fg) : s.bg
  return {
    color: fg,
    background: bg,
    fontWeight: s.bold ? 700 : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: s.underline ? 'underline' : undefined,
    opacity: s.dim ? 0.6 : undefined,
  }
}

/** Renders one escape-coded line as styled spans. */
function AnsiLine({ line, inline = false }: { line: string; inline?: boolean }) {
  const { segments } = parseAnsi(line)
  const content = segments.map((seg, i) => (
    <span key={i} style={styleToCss(seg.style)}>{seg.text}</span>
  ))
  return inline
    ? <span className="nl-term-line-inline">{content}</span>
    : <div className="nl-term-line">{content}</div>
}

/* ─── Styles ────────────────────────────────────────────────────────── */

const TERMINAL_CSS = `
.nl-term-window {
  display: flex;
  flex-direction: column;
  background: ${CHROME.bg};
  border: 1px solid ${CHROME.border};
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,0.75), 0 0 0 1px rgba(0,220,255,0.06),
              0 0 60px rgba(0,220,255,0.05);
  position: relative;
  font-family: var(--font-mono), 'JetBrains Mono', 'Courier New', monospace;
}
/* CRT treatment: scanlines + vignette, purely decorative and click-through. */
.nl-term-window::after {
  content: '';
  position: absolute; inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(to bottom,
      rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px,
      transparent 1px, transparent 3px),
    radial-gradient(ellipse at center,
      transparent 55%, rgba(0,0,0,0.35) 100%);
  z-index: 5;
}

/* — title bar — */
.nl-term-titlebar {
  display: flex; align-items: center; gap: 14px;
  padding: 8px 14px;
  background: ${CHROME.bgChrome};
  border-bottom: 1px solid ${CHROME.border};
  flex: 0 0 auto;
}
.nl-term-lights { display: flex; gap: 7px; }
.nl-term-lights span {
  width: 11px; height: 11px; border-radius: 50%;
  display: inline-block; cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35);
}
.nl-term-title { font-size: 12px; letter-spacing: 0.4px; color: ${CHROME.fg}; }
.nl-term-title-dim  { color: ${CHROME.fgDim}; }
.nl-term-title-host { color: #00dcff; font-weight: 700; }
.nl-term-tabs { margin-left: auto; display: flex; gap: 4px; }
.nl-tab {
  font-size: 11px; padding: 2px 9px; border-radius: 3px; cursor: pointer;
  color: ${CHROME.fgDim}; background: rgba(255,255,255,0.03);
}
.nl-tab-on { color: #05070b; background: ${CHROME.statusActive}; font-weight: 700; }

/* — panes — */
.nl-term-body { flex: 1; display: flex; min-height: 0; gap: 1px; background: ${CHROME.border}; }
.nl-pane {
  display: flex; flex-direction: column; min-height: 0; min-width: 0;
  background: ${CHROME.bgPane};
}
.nl-pane-main { flex: 1.7 1 0; }
.nl-side { flex: 1 1 0; display: flex; flex-direction: column; gap: 1px;
           min-width: 300px; max-width: 480px; background: ${CHROME.border}; }
.nl-pane-capture { flex: 1.15 1 0; }
.nl-pane-hex     { flex: 1 1 0; }

.nl-pane-head {
  font-size: 10.5px; letter-spacing: 1.4px; text-transform: uppercase;
  padding: 5px 12px; background: rgba(255,255,255,0.025);
  border-bottom: 1px solid ${CHROME.border}; flex: 0 0 auto; font-weight: 700;
}
.nl-pane-head-dim { color: ${CHROME.fgDim}; font-weight: 400; letter-spacing: 0.6px; }

.nl-term-scroll {
  flex: 1; overflow-y: auto; overflow-x: auto;
  padding: 10px 14px;
  font-size: 13px; line-height: 1.45;
  color: ${CHROME.fg};
  user-select: text; cursor: text;
  scrollbar-width: thin;
}
.nl-term-line, .nl-term-line-inline { white-space: pre; min-height: 1.45em; }
.nl-term-line-inline { display: inline; }

/* — input line — */
.nl-term-inputrow { display: flex; align-items: baseline; white-space: pre; }
.nl-term-inputwrap { position: relative; flex: 1; display: inline-block; margin-left: 1ch; }
.nl-term-input {
  width: 100%; background: transparent; border: none; outline: none;
  color: #ffffff; font: inherit; caret-color: transparent; padding: 0;
}
.nl-term-cursor {
  position: absolute; top: 0.12em; width: 0.62ch; height: 1.15em;
  background: #00dcff; box-shadow: 0 0 8px rgba(0,220,255,0.8);
  animation: nl-blink 1.05s steps(1) infinite; pointer-events: none;
}
@keyframes nl-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }

/* — capture table — */
.nl-capture { padding: 0; }
.nl-cap-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.nl-cap-table thead th {
  position: sticky; top: 0; z-index: 1;
  background: ${CHROME.borderTable}; color: #05070b;
  font-weight: 700; letter-spacing: 0.8px;
  text-align: left; padding: 4px 8px;
}
.nl-cap-table td {
  padding: 2px 8px; border-bottom: 1px solid rgba(255,255,255,0.04);
  white-space: nowrap; color: ${CHROME.fg};
}
.nl-cap-table tbody tr:nth-child(odd) td { background: rgba(255,255,255,0.018); }
.nl-dim   { color: ${CHROME.fgDim}; }
.nl-empty { color: ${CHROME.fgDim}; text-align: center; padding: 18px 0; }

.nl-hex { font-size: 11.5px; line-height: 1.5; }

/* — status bar — */
.nl-term-status {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 12px; font-size: 11px;
  background: ${CHROME.statusBg};
  border-top: 1px solid ${CHROME.border};
  color: ${CHROME.fgDim}; flex: 0 0 auto;
}
.nl-status-tag {
  background: ${CHROME.statusActive}; color: #05070b;
  padding: 1px 8px; border-radius: 2px; font-weight: 700; letter-spacing: 0.5px;
}
.nl-status-seg  { color: #00dcff; font-weight: 600; }
.nl-status-mode { padding: 1px 7px; border-radius: 2px; font-weight: 700; letter-spacing: 0.6px; }
.nl-mode-user   { background: rgba(107,182,255,0.16); color: #6cb6ff; }
.nl-mode-priv   { background: rgba(255,138,128,0.16); color: #ff8a80; }
.nl-mode-config { background: rgba(215,163,255,0.16); color: #d7a3ff; }
.nl-status-busy { color: ${CHROME.statusActive}; animation: nl-pulse 1s ease-in-out infinite; }
@keyframes nl-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
.nl-status-spacer { flex: 1; }
.nl-status-hint  { color: ${CHROME.fgDim}; }
.nl-status-clock { color: ${CHROME.fg}; font-variant-numeric: tabular-nums; }

/* Below this width the side panes would squeeze the console to nothing. */
@media (max-width: 1100px) {
  .nl-side { display: none; }
}

/* Narrow viewports: keep the chrome on one line and drop what is optional
   rather than letting the title and status hints wrap into stacked text. */
@media (max-width: 760px) {
  .nl-term-titlebar { gap: 9px; padding: 7px 10px; }
  .nl-term-title    { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nl-term-title-dim, .nl-term-tabs { display: none; }
  .nl-term-status   { gap: 7px; white-space: nowrap; overflow: hidden; }
  .nl-status-hint   { display: none; }
  .nl-term-scroll   { font-size: 11.5px; padding: 8px 10px; }
}
`
