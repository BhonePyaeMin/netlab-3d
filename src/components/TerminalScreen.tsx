/**
 * TerminalScreen — the console UI itself, independent of how it is framed.
 *
 * Rendered in two places against the same live TerminalSession:
 *   · TerminalOverlay — as a floating 2D window
 *   · ConsoleStation  — projected onto the MacBook's display in the 3D scene
 *
 * Layout is the tmux-style split:
 *
 *   ┌ console ────────────────┬ live capture ─────┐
 *   │ boot POST + device card │ protocol table    │
 *   │ ANSI-coloured scrollback├───────────────────┤
 *   │ prompt ▉                │ tcpdump -X hexdump│
 *   └─────────────────────────┴───────────────────┘
 *   [netlab] 0:console* 1:split      priv | 12:04:31
 */
import { useEffect, useRef, useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { TerminalSession }  from '../terminal/TerminalSession'
import { useNetworkStore }  from '../network/useNetworkStore'
import { parseAnsi }        from '../terminal/ansi'
import type { Style }       from '../terminal/ansi'
import { C }                from '../terminal/ansi'
import { highlightPrompt }  from '../terminal/highlight'
import { handleTerminalKey } from '../terminal/keyHandler'
import { dumpPacket }       from '../terminal/hexdump'
import { CHROME, protoColor } from '../terminal/theme'
import type { CapturedPacket } from '../network/types'

export function useTerminalSession() {
  return useSyncExternalStore(
    TerminalSession.subscribe,
    TerminalSession.getSnapshot,
    TerminalSession.getSnapshot,
  )
}

interface Props {
  /** 'window' floats in 2D; 'screen' fills a fixed-size 3D display panel. */
  variant: 'window' | 'screen'
  onClose: () => void
  /** Hide the side panes (narrow displays, or the console-only tab). */
  showPanes: boolean
  onTogglePanes: (v: boolean) => void
  /** Extra control rendered into the title bar (e.g. the 2D/3D switch). */
  titleBarExtra?: React.ReactNode
  /** Autofocus the input on mount — off for the 3D screen until it is framed. */
  autoFocus?: boolean
}

export default function TerminalScreen({
  variant, onClose, showPanes, onTogglePanes, titleBarExtra, autoFocus = true,
}: Props) {
  const session = useTerminalSession()
  const { capturedPackets, capturingCableId } = useNetworkStore()
  const [clock, setClock] = useState(() => new Date())

  const inputRef  = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { deviceId, lines, input, prompt, busy, terminalType } = session

  /* Autoscroll as output arrives. */
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  /* Keep focus on the input — the whole surface behaves like a terminal. */
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus, deviceId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleTerminalKey(e, {
      onClose,
      onTogglePanes: () => onTogglePanes(!showPanes),
    })
  }

  const recentPackets = useMemo(
    () => capturedPackets.slice(-14).reverse(),
    [capturedPackets],
  )

  const hexLines = useMemo(() => {
    const last = capturedPackets[capturedPackets.length - 1] as CapturedPacket | undefined
    return last
      ? dumpPacket(last, 10)
      : [
          C.grey('No frame selected.'), '',
          C.grey('Attach the sniffer to a link (K) to'),
          C.grey('populate this pane with live bytes.'),
        ]
  }, [capturedPackets])

  if (!deviceId) return null

  const mode = /\(config/.test(prompt) ? 'config' : prompt.endsWith('#') ? 'priv' : 'user'

  return (
    <div className={`nl-term-window nl-term-${variant}`}>
      {/* ── Title bar ─────────────────────────────────────────── */}
      <div className="nl-term-titlebar">
        <div className="nl-term-lights">
          <span style={{ background: '#ff5f56' }} onClick={onClose} title="Close (Esc)" />
          <span style={{ background: '#ffbd2e' }}
                onClick={(e) => { e.stopPropagation(); onTogglePanes(!showPanes) }}
                title="Toggle panes (F2)" />
          <span style={{ background: '#27c93f' }} />
        </div>

        <div className="nl-term-title">
          <span className="nl-term-title-dim">console —</span>&nbsp;
          <span className="nl-term-title-host">{deviceId}</span>
          <span className="nl-term-title-dim">&nbsp;· {terminalType.replace('_', ' ')}</span>
        </div>

        <div className="nl-term-tabs">
          {titleBarExtra}
          <span className={`nl-tab${showPanes ? '' : ' nl-tab-on'}`}
                onClick={(e) => { e.stopPropagation(); onTogglePanes(false) }}>0:console</span>
          <span className={`nl-tab${showPanes ? ' nl-tab-on' : ''}`}
                onClick={(e) => { e.stopPropagation(); onTogglePanes(true) }}>1:split</span>
        </div>
      </div>

      {/* ── Panes ─────────────────────────────────────────────── */}
      <div className="nl-term-body">
        <section className="nl-pane nl-pane-main">
          <header className="nl-pane-head" style={{ color: CHROME.borderActive }}>
            ▍console<span className="nl-pane-head-dim"> · {lines.length} lines</span>
          </header>

          <div className="nl-term-scroll" ref={scrollRef}
               onClick={() => inputRef.current?.focus()}>
            {lines.map((line, i) => <AnsiLine key={i} line={line} />)}

            <div className="nl-term-inputrow">
              <AnsiLine line={highlightPrompt(prompt)} inline />
              <span className="nl-term-inputwrap">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => TerminalSession.setInput(e.target.value)}
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
                    <tr><th>NO</th><th>PROTO</th><th>SOURCE</th><th>DEST</th><th>LEN</th></tr>
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
export function AnsiLine({ line, inline = false }: { line: string; inline?: boolean }) {
  const { segments } = parseAnsi(line)
  const content = segments.map((seg, i) => (
    <span key={i} style={styleToCss(seg.style)}>{seg.text}</span>
  ))
  return inline
    ? <span className="nl-term-line-inline">{content}</span>
    : <div className="nl-term-line">{content}</div>
}
