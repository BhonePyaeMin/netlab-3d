/**
 * ansi.ts — Minimal but faithful ANSI/SGR escape-sequence parser.
 *
 * Turns a line containing CSI SGR sequences (ESC[…m) into a list of styled
 * segments the renderer can map straight onto <span> elements. Style is
 * carried across lines so a colour opened on one line stays open on the next,
 * exactly like a real terminal.
 *
 * Supported SGR parameters:
 *   0 reset · 1 bold · 2 dim · 3 italic · 4 underline · 7 reverse
 *   22/23/24/27 the matching "off" codes
 *   30-37 / 90-97   foreground (normal / bright)
 *   40-47 / 100-107 background (normal / bright)
 *   38;5;n / 48;5;n     xterm-256 indexed colour
 *   38;2;r;g;b / 48;2;… 24-bit truecolour
 *   39 / 49         default foreground / background
 *
 * Non-SGR CSI sequences (cursor moves, erases) are consumed and discarded so
 * they never leak into the visible text.
 */
import { ANSI_256 } from './theme'

export interface Style {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  reverse?: boolean
}

export interface Segment {
  text: string
  style: Style
}

export interface ParsedLine {
  segments: Segment[]
  /** Style still in effect at end of line — feed into the next line. */
  endStyle: Style
}

/** Matches any CSI sequence: ESC [ <params> <final byte> */
// eslint-disable-next-line no-control-regex
const CSI = /\x1b\[([0-9;:?]*)([@-~])/g

/** Strip every escape sequence, leaving plain text (used for copy + measuring). */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;:?]*[@-~]/g, '').replace(/\x1b[()][A-Za-z0-9]/g, '')
}

function applySgr(style: Style, params: number[]): Style {
  const next: Style = { ...style }

  for (let i = 0; i < params.length; i++) {
    const p = params[i]

    switch (true) {
      case p === 0:
        // Full reset — drop every attribute.
        for (const k of Object.keys(next)) delete (next as Record<string, unknown>)[k]
        break
      case p === 1: next.bold = true; break
      case p === 2: next.dim = true; break
      case p === 3: next.italic = true; break
      case p === 4: next.underline = true; break
      case p === 7: next.reverse = true; break
      case p === 22: delete next.bold; delete next.dim; break
      case p === 23: delete next.italic; break
      case p === 24: delete next.underline; break
      case p === 27: delete next.reverse; break

      case p >= 30 && p <= 37: next.fg = ANSI_256[p - 30]; break
      case p === 39: delete next.fg; break
      case p >= 40 && p <= 47: next.bg = ANSI_256[p - 40]; break
      case p === 49: delete next.bg; break
      case p >= 90 && p <= 97: next.fg = ANSI_256[p - 90 + 8]; break
      case p >= 100 && p <= 107: next.bg = ANSI_256[p - 100 + 8]; break

      case p === 38 || p === 48: {
        const target: 'fg' | 'bg' = p === 38 ? 'fg' : 'bg'
        const mode = params[i + 1]
        if (mode === 5) {
          const idx = params[i + 2]
          if (idx >= 0 && idx < ANSI_256.length) next[target] = ANSI_256[idx]
          i += 2
        } else if (mode === 2) {
          const [r, g, b] = [params[i + 2], params[i + 3], params[i + 4]]
          next[target] = `rgb(${r | 0}, ${g | 0}, ${b | 0})`
          i += 4
        }
        break
      }
    }
  }

  return next
}

/**
 * Parse one line of possibly-escaped text into styled segments.
 *
 * @param line    the raw line (no trailing newline)
 * @param initial style inherited from the previous line
 */
export function parseAnsi(line: string, initial: Style = {}): ParsedLine {
  const segments: Segment[] = []
  let style: Style = { ...initial }
  let cursor = 0

  CSI.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = CSI.exec(line)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: line.slice(cursor, match.index), style })
    }

    // Only SGR ('m') mutates style; every other final byte is a cursor/erase
    // command we intentionally swallow.
    if (match[2] === 'm') {
      const params = match[1] === ''
        ? [0]
        : match[1].split(/[;:]/).map(v => (v === '' ? 0 : parseInt(v, 10)))
      style = applySgr(style, params)
    }

    cursor = match.index + match[0].length
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor), style })
  }

  // An empty line still needs one segment so it renders at full line height.
  if (segments.length === 0) segments.push({ text: '', style })

  return { segments, endStyle: style }
}

/**
 * Parse a multi-line block, threading style state from line to line.
 */
export function parseAnsiBlock(lines: string[], initial: Style = {}): ParsedLine[] {
  const out: ParsedLine[] = []
  let style = initial
  for (const line of lines) {
    const parsed = parseAnsi(line, style)
    style = parsed.endStyle
    out.push(parsed)
  }
  return out
}

/* ─── Authoring helpers ───────────────────────────────────────────────── */

export const ESC = '\x1b['
export const RESET = `${ESC}0m`

/** Wrap text in an SGR sequence, e.g. `sgr('91;1', 'FAILED')`. */
export function sgr(codes: string, text: string): string {
  return `${ESC}${codes}m${text}${RESET}`
}

/** Named shorthands for the colours used throughout the CLI output. */
export const C = {
  black:   (s: string) => sgr('30', s),
  red:     (s: string) => sgr('31', s),
  green:   (s: string) => sgr('32', s),
  yellow:  (s: string) => sgr('33', s),
  blue:    (s: string) => sgr('34', s),
  magenta: (s: string) => sgr('35', s),
  cyan:    (s: string) => sgr('36', s),
  white:   (s: string) => sgr('37', s),
  grey:    (s: string) => sgr('90', s),
  bRed:    (s: string) => sgr('91', s),
  bGreen:  (s: string) => sgr('92', s),
  bYellow: (s: string) => sgr('93', s),
  bBlue:   (s: string) => sgr('94', s),
  bMag:    (s: string) => sgr('95', s),
  bCyan:   (s: string) => sgr('96', s),
  bWhite:  (s: string) => sgr('97', s),
  bold:    (s: string) => sgr('1', s),
  dim:     (s: string) => sgr('2', s),
  under:   (s: string) => sgr('4', s),
  rev:     (s: string) => sgr('7', s),
  /** Inverse-video header row, as used by top/htop/nmap table headers. */
  header:  (s: string) => sgr('30;42;1', s),
  ok:      (s: string) => sgr('92;1', s),
  warn:    (s: string) => sgr('93;1', s),
  err:     (s: string) => sgr('91;1', s),
} as const
