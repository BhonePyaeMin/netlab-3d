/**
 * theme.ts — Terminal colour system.
 *
 * A single source of truth for the 16 ANSI colours, the xterm-256 cube and
 * the chrome (borders / status bar / panes) used by TerminalOverlay.
 *
 * The palette is a "phosphor" variant of the classic xterm scheme: slightly
 * desaturated darks and hot, glowing brights so that text reads correctly on
 * the near-black CRT background used by the overlay.
 */

/** The 16 base ANSI colours: 0-7 normal, 8-15 bright. */
export const ANSI_16: readonly string[] = [
  '#12161d', // 0  black
  '#ff5f56', // 1  red
  '#27c93f', // 2  green
  '#f5c542', // 3  yellow
  '#3b8eea', // 4  blue
  '#b46bff', // 5  magenta
  '#00dcff', // 6  cyan
  '#c5ccd6', // 7  white
  '#4a5568', // 8  bright black (grey)
  '#ff8a80', // 9  bright red
  '#5ef78a', // 10 bright green
  '#ffe066', // 11 bright yellow
  '#6cb6ff', // 12 bright blue
  '#d7a3ff', // 13 bright magenta
  '#7bf3ff', // 14 bright cyan
  '#ffffff', // 15 bright white
]

/** Chrome colours for the window frame, panes and status bar. */
export const CHROME = {
  /** Page-level scrim behind the terminal window. */
  scrim:        'rgba(2, 4, 8, 0.82)',
  /** Terminal background — near black with a faint blue cast. */
  bg:           '#05070b',
  /** Slightly lifted background for pane bodies. */
  bgPane:       '#070a10',
  /** Title bar / status bar background. */
  bgChrome:     '#0c1119',
  /** Default border. */
  border:       '#1b2433',
  /** Border of the focused pane. */
  borderActive: '#00dcff',
  /** Border of the hex-dump pane (matches the amber capture theme). */
  borderHex:    '#f5c542',
  /** Border of the live capture table pane. */
  borderTable:  '#27c93f',
  /** Default foreground. */
  fg:           '#c5ccd6',
  /** Dim foreground for chrome labels. */
  fgDim:        '#5b6b80',
  /** tmux-style status bar highlight. */
  statusActive: '#27c93f',
  statusBg:     '#101722',
  /** Selection highlight. */
  selection:    'rgba(0, 220, 255, 0.25)',
} as const

/** Per-protocol colours shared by the capture table and the hex dump. */
export const PROTO_COLORS: Record<string, string> = {
  ARP:  '#f5c542',
  ICMP: '#ff8a80',
  TCP:  '#5ef78a',
  UDP:  '#6cb6ff',
  DNS:  '#d7a3ff',
  DHCP: '#ffe066',
  OSPF: '#7bf3ff',
  RIP:  '#b46bff',
  CDP:  '#00dcff',
  LLDP: '#00dcff',
  STP:  '#c5ccd6',
}

export function protoColor(proto: string): string {
  return PROTO_COLORS[proto?.toUpperCase()] ?? CHROME.fg
}

/* ─── xterm-256 palette ───────────────────────────────────────────────── */

const CUBE_STEPS = [0, 95, 135, 175, 215, 255]

function hex(n: number): string {
  return n.toString(16).padStart(2, '0')
}

/**
 * Full 256-colour xterm palette: 0-15 base, 16-231 the 6×6×6 RGB cube,
 * 232-255 the 24-step greyscale ramp.
 */
export const ANSI_256: readonly string[] = (() => {
  const out: string[] = [...ANSI_16]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        out.push(`#${hex(CUBE_STEPS[r])}${hex(CUBE_STEPS[g])}${hex(CUBE_STEPS[b])}`)
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10
    out.push(`#${hex(v)}${hex(v)}${hex(v)}`)
  }
  return out
})()
