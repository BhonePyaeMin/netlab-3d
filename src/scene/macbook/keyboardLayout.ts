/**
 * keyboardLayout.ts — physical MacBook Pro keyboard geometry + touch-typing map.
 *
 * Two jobs:
 *  1. Describe every key's real position and size on the deck, so the 3D model
 *     can build key caps and press the correct one.
 *  2. Say which finger a touch typist actually uses for a given character, so
 *     the animated hands reach with the right finger rather than teleporting a
 *     generic pointer around.
 *
 * Local space: X right, Z toward the user (front edge), origin at the centre
 * of the keyboard well. Units are metres, matching the 14" MacBook Pro.
 */

/** Key pitch (centre-to-centre) — 19 mm, as on every modern Mac keyboard. */
export const KEY_PITCH = 0.019
/** Key cap size relative to pitch; the remainder is the gap between caps. */
export const CAP_INSET = 0.0027
/** How far a key travels when pressed — Magic Keyboard scissor switches: 1 mm. */
export const KEY_TRAVEL = 0.001

export interface KeyDef {
  /** Stable id, also the lower-case character for ordinary keys. */
  id: string
  label: string
  /** Centre position on the deck, metres. */
  x: number
  z: number
  /** Cap footprint, metres. */
  w: number
  d: number
  row: number
  /** Function-row keys are half height on a real MacBook. */
  small?: boolean
}

/** Row descriptors: [id, label, width in key units]. */
type Spec = [string, string, number?]

const ROWS: Spec[][] = [
  // Function row — half height
  [
    ['esc', 'esc', 1.5], ['f1', 'F1'], ['f2', 'F2'], ['f3', 'F3'], ['f4', 'F4'],
    ['f5', 'F5'], ['f6', 'F6'], ['f7', 'F7'], ['f8', 'F8'], ['f9', 'F9'],
    ['f10', 'F10'], ['f11', 'F11'], ['f12', 'F12'], ['touchid', '', 1.5],
  ],
  // Number row
  [
    ['`', '`'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'],
    ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['0', '0'],
    ['-', '-'], ['=', '='], ['backspace', 'delete', 1.5],
  ],
  // Tab row
  [
    ['tab', 'tab', 1.5], ['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'],
    ['y', 'Y'], ['u', 'U'], ['i', 'I'], ['o', 'O'], ['p', 'P'],
    ['[', '['], [']', ']'], ['\\', '\\'],
  ],
  // Home row
  [
    ['capslock', 'caps', 1.75], ['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'],
    ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'], ['l', 'L'],
    [';', ';'], ["'", "'"], ['enter', 'return', 1.75],
  ],
  // Shift row
  [
    ['lshift', 'shift', 2.25], ['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'],
    ['b', 'B'], ['n', 'N'], ['m', 'M'], [',', ','], ['.', '.'], ['/', '/'],
    ['rshift', 'shift', 2.25],
  ],
  // Bottom row — arrows are half height and handled separately
  [
    ['fn', 'fn'], ['lctrl', 'ctrl'], ['lalt', 'opt'], ['lmeta', 'cmd', 1.25],
    [' ', '', 5], ['rmeta', 'cmd', 1.25], ['ralt', 'opt'],
    ['arrows', '', 3],
  ],
]

/** Total width of the widest row, in key units — used to centre every row. */
const ROW_UNITS = ROWS.map(r => r.reduce((sum, [, , w]) => sum + (w ?? 1), 0))
const MAX_UNITS = Math.max(...ROW_UNITS)

/** Keyboard well sits behind the trackpad; row 0 is farthest from the user. */
const ROW_Z_START = -0.052
const FN_ROW_DEPTH = 0.55   // function row is squat

export const KEYS: KeyDef[] = (() => {
  const out: KeyDef[] = []

  let z = ROW_Z_START
  ROWS.forEach((row, rowIndex) => {
    const small = rowIndex === 0
    const depthUnits = small ? FN_ROW_DEPTH : 1
    const rowDepth = depthUnits * KEY_PITCH

    // Centre this row horizontally within the widest row.
    let x = -(MAX_UNITS * KEY_PITCH) / 2

    for (const [id, label, widthUnits] of row) {
      const units = widthUnits ?? 1
      const w = units * KEY_PITCH - CAP_INSET

      if (id === 'arrows') {
        // Inverted-T cluster: full-height up/down stack plus left and right.
        const cx = x + (units * KEY_PITCH) / 2
        const half = (KEY_PITCH - CAP_INSET) / 2
        out.push({ id: 'arrowleft',  label: '◀', x: cx - KEY_PITCH, z, w: KEY_PITCH - CAP_INSET, d: rowDepth - CAP_INSET, row: rowIndex })
        out.push({ id: 'arrowup',    label: '▲', x: cx, z: z - half / 2, w: KEY_PITCH - CAP_INSET, d: half - CAP_INSET / 2, row: rowIndex, small: true })
        out.push({ id: 'arrowdown',  label: '▼', x: cx, z: z + half / 2, w: KEY_PITCH - CAP_INSET, d: half - CAP_INSET / 2, row: rowIndex, small: true })
        out.push({ id: 'arrowright', label: '▶', x: cx + KEY_PITCH, z, w: KEY_PITCH - CAP_INSET, d: rowDepth - CAP_INSET, row: rowIndex })
      } else {
        out.push({
          id, label,
          x: x + (units * KEY_PITCH) / 2,
          z,
          w,
          d: rowDepth - CAP_INSET,
          row: rowIndex,
          small,
        })
      }
      x += units * KEY_PITCH
    }

    z += rowDepth + 0.0013
  })

  return out
})()

/** Fast lookup by key id. */
export const KEY_BY_ID: Record<string, KeyDef> = Object.fromEntries(KEYS.map(k => [k.id, k]))

/** Depth the whole keyboard well occupies, for laying out the deck. */
export const KEYBOARD_DEPTH = (() => {
  const zs = KEYS.map(k => k.z)
  return Math.max(...zs) - Math.min(...zs) + KEY_PITCH
})()

/* ── Character → key ──────────────────────────────────────────────── */

/** Characters that require Shift, mapped to the unshifted key they live on. */
const SHIFTED: Record<string, string> = {
  '~': '`', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6',
  '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
}

export interface KeyStroke {
  /** The key cap to depress. */
  keyId: string
  /** Shift is held down as well — the off-hand pinky reaches for it. */
  shift: boolean
}

/**
 * Resolve a KeyboardEvent.key value to the physical cap(s) involved.
 * Returns null for keys with no cap on this layout.
 */
export function resolveKey(eventKey: string): KeyStroke | null {
  if (eventKey.length === 1) {
    const ch = eventKey
    if (SHIFTED[ch]) return { keyId: SHIFTED[ch], shift: true }
    const lower = ch.toLowerCase()
    if (KEY_BY_ID[lower]) return { keyId: lower, shift: ch !== lower }
    return null
  }

  const named: Record<string, string> = {
    Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'esc',
    ArrowUp: 'arrowup', ArrowDown: 'arrowdown',
    ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
    Shift: 'lshift', Control: 'lctrl', Alt: 'lalt', Meta: 'lmeta',
    CapsLock: 'capslock', ' ': ' ',
  }
  const id = named[eventKey]
  return id ? { keyId: id, shift: false } : null
}

/* ── Touch-typing fingering ───────────────────────────────────────── */

export type Hand = 'L' | 'R'
/** 0 = thumb … 4 = pinky. */
export type FingerIndex = 0 | 1 | 2 | 3 | 4

export interface Fingering { hand: Hand; finger: FingerIndex }

/** Standard QWERTY touch-typing assignment, column by column. */
const FINGERING: Record<string, Fingering> = {}

const assign = (hand: Hand, finger: FingerIndex, ids: string[]) => {
  for (const id of ids) FINGERING[id] = { hand, finger }
}

assign('L', 4, ['esc', '`', '1', 'q', 'a', 'z', 'tab', 'capslock', 'lshift', 'fn', 'lctrl'])
assign('L', 3, ['2', 'w', 's', 'x', 'lalt'])
assign('L', 2, ['3', 'e', 'd', 'c', 'lmeta'])
assign('L', 1, ['4', '5', 'r', 't', 'f', 'g', 'v', 'b'])
assign('L', 0, [' '])
assign('R', 1, ['6', '7', 'y', 'u', 'h', 'j', 'n', 'm'])
assign('R', 2, ['8', 'i', 'k', ',', 'rmeta'])
assign('R', 3, ['9', 'o', 'l', '.', 'ralt'])
assign('R', 4, [
  '0', '-', '=', 'p', '[', ']', '\\', ';', "'", '/',
  'enter', 'backspace', 'rshift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
])
// Function row: split down the middle, reached by the nearest index finger.
for (let i = 1; i <= 12; i++) {
  FINGERING[`f${i}`] = i <= 6 ? { hand: 'L', finger: 1 } : { hand: 'R', finger: 1 }
}
FINGERING['touchid'] = { hand: 'R', finger: 4 }

/** Which finger types this key. Falls back to the right index finger. */
export function fingerFor(keyId: string): Fingering {
  return FINGERING[keyId] ?? { hand: 'R', finger: 1 }
}

/* ── Home-row rest positions ──────────────────────────────────────── */

/** Where each finger sits when idle: ASDF / JKL; with thumbs on the space bar. */
export const HOME_KEYS: Record<string, string> = {
  L4: 'a', L3: 's', L2: 'd', L1: 'f', L0: ' ',
  R1: 'j', R2: 'k', R3: 'l', R4: ';', R0: ' ',
}

export function homeKey(hand: Hand, finger: FingerIndex): KeyDef {
  return KEY_BY_ID[HOME_KEYS[`${hand}${finger}`]] ?? KEY_BY_ID['j']
}
