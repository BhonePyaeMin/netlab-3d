/**
 * ScreenTexture.ts — draws the live console onto a canvas for the 3D display.
 *
 * The obvious approach (drei's <Html transform>) puts real DOM in a CSS3D
 * layer floating above the WebGL canvas. That layer cannot be occluded by the
 * lid, does not receive the scene's lighting, and its pixel-to-world scaling is
 * awkward to pin down. Painting the terminal into a texture instead makes the
 * display an ordinary emissive surface: correct depth, correct occlusion, and
 * exact control over the pixel grid.
 *
 * The canvas is only repainted when the session actually changes, so a static
 * console costs nothing per frame.
 */
import * as THREE from 'three'
import { parseAnsi } from '../../terminal/ansi'
import { highlightPrompt } from '../../terminal/highlight'
import { dumpPacket } from '../../terminal/hexdump'
import { CHROME, protoColor } from '../../terminal/theme'
import type { TerminalSessionState } from '../../terminal/TerminalSession'
import type { CapturedPacket } from '../../network/types'

/** Backing-store size. 3024×1964 would be wasteful; this keeps text crisp. */
const W = 2048
const H = Math.round(W * (1964 / 3024))   // 1330

const FONT = '500 21px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'
const FONT_BOLD = '700 21px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'
const UI_FONT = '600 19px "Space Grotesk", "SF Pro Text", system-ui, sans-serif'
const SMALL_FONT = '600 16px "Space Grotesk", "SF Pro Text", system-ui, sans-serif'

const LINE_H = 28
const CHAR_W = 12.62          // advance width of the 21px monospace face
const TITLE_H = 44
const STATUS_H = 40
const PANE_HEAD_H = 30
const PAD_X = 18
const PAD_Y = 12

/** Fraction of the width given to the console pane. */
const SPLIT = 0.635

export interface ScreenInput {
  session: TerminalSessionState
  packets: CapturedPacket[]
  capturing: boolean
  /** Blink phase for the cursor. */
  cursorOn: boolean
}

export class ScreenTexture {
  readonly canvas: HTMLCanvasElement
  readonly texture: THREE.CanvasTexture
  private ctx: CanvasRenderingContext2D
  /** Cheap change detection so we only repaint when something moved. */
  private signature = ''

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = W
    this.canvas.height = H
    this.ctx = this.canvas.getContext('2d')!

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter

    this.paintIdle()
  }

  dispose() {
    this.texture.dispose()
  }

  /** Repaint if anything visible changed. Returns true when it repainted. */
  update(input: ScreenInput): boolean {
    const s = input.session
    const sig = [
      s.deviceId, s.lines.length, s.input, s.prompt, s.busy,
      input.packets.length, input.capturing, input.cursorOn,
      s.lines[s.lines.length - 1] ?? '',
    ].join('')

    if (sig === this.signature) return false
    this.signature = sig
    this.paint(input)
    this.texture.needsUpdate = true
    return true
  }

  /* ── Painting ───────────────────────────────────────────────────── */

  private paintIdle() {
    const c = this.ctx
    c.fillStyle = '#05070b'
    c.fillRect(0, 0, W, H)
    c.fillStyle = '#16202c'
    c.font = UI_FONT
    c.textAlign = 'center'
    c.fillText('no session', W / 2, H / 2)
    c.textAlign = 'left'
  }

  private paint(input: ScreenInput) {
    const c = this.ctx
    const { session } = input

    c.fillStyle = CHROME.bg
    c.fillRect(0, 0, W, H)

    this.paintTitleBar(session)

    const bodyTop = TITLE_H
    const bodyH = H - TITLE_H - STATUS_H
    const splitX = Math.round(W * SPLIT)

    this.paintConsole(session, input.cursorOn, 0, bodyTop, splitX, bodyH)
    this.paintCapture(input, splitX + 1, bodyTop, W - splitX - 1, Math.round(bodyH * 0.52))
    this.paintHex(input, splitX + 1, bodyTop + Math.round(bodyH * 0.52) + 1,
                  W - splitX - 1, bodyH - Math.round(bodyH * 0.52) - 1)

    // Pane dividers
    c.fillStyle = CHROME.border
    c.fillRect(splitX, bodyTop, 1, bodyH)
    c.fillRect(splitX, bodyTop + Math.round(bodyH * 0.52), W - splitX, 1)

    this.paintStatusBar(session)
  }

  private paintTitleBar(s: TerminalSessionState) {
    const c = this.ctx
    c.fillStyle = CHROME.bgChrome
    c.fillRect(0, 0, W, TITLE_H)
    c.fillStyle = CHROME.border
    c.fillRect(0, TITLE_H - 1, W, 1)

    // Traffic lights
    const lights = ['#ff5f56', '#ffbd2e', '#27c93f']
    lights.forEach((col, i) => {
      c.beginPath()
      c.arc(PAD_X + 10 + i * 24, TITLE_H / 2, 8, 0, Math.PI * 2)
      c.fillStyle = col
      c.fill()
    })

    c.font = UI_FONT
    c.textBaseline = 'middle'
    c.fillStyle = CHROME.fgDim
    c.fillText('console —', PAD_X + 90, TITLE_H / 2)
    const w1 = c.measureText('console —').width
    c.fillStyle = '#00dcff'
    c.fillText(` ${s.deviceId ?? ''}`, PAD_X + 90 + w1, TITLE_H / 2)
    const w2 = c.measureText(` ${s.deviceId ?? ''}`).width
    c.fillStyle = CHROME.fgDim
    c.fillText(`  · ${s.terminalType.replace('_', ' ')}`, PAD_X + 90 + w1 + w2, TITLE_H / 2)

    // tmux-ish window tabs, right aligned
    c.font = SMALL_FONT
    const tab = '1:split'
    const tw = c.measureText(tab).width + 22
    c.fillStyle = CHROME.statusActive
    roundRect(c, W - PAD_X - tw, 10, tw, TITLE_H - 20, 4)
    c.fill()
    c.fillStyle = '#05070b'
    c.fillText(tab, W - PAD_X - tw + 11, TITLE_H / 2)
  }

  /** Header strip shared by every pane. */
  private paneHead(x: number, y: number, w: number, label: string, sub: string, color: string) {
    const c = this.ctx
    c.fillStyle = 'rgba(255,255,255,0.025)'
    c.fillRect(x, y, w, PANE_HEAD_H)
    c.fillStyle = CHROME.border
    c.fillRect(x, y + PANE_HEAD_H - 1, w, 1)

    c.font = SMALL_FONT
    c.textBaseline = 'middle'
    c.fillStyle = color
    const text = `▍${label.toUpperCase()}`
    c.fillText(text, x + 14, y + PANE_HEAD_H / 2)
    c.fillStyle = CHROME.fgDim
    c.fillText(sub, x + 14 + c.measureText(text).width + 8, y + PANE_HEAD_H / 2)
  }

  private paintConsole(
    s: TerminalSessionState, cursorOn: boolean,
    x: number, y: number, w: number, h: number,
  ) {
    const c = this.ctx
    c.fillStyle = CHROME.bgPane
    c.fillRect(x, y, w, h)
    this.paneHead(x, y, w, 'console', `· ${s.lines.length} lines`, CHROME.borderActive)

    const top = y + PANE_HEAD_H + PAD_Y
    const avail = h - PANE_HEAD_H - PAD_Y * 2
    const rows = Math.floor(avail / LINE_H)

    // The prompt row is always the last visible row; scrollback fills upward.
    const visible = s.lines.slice(Math.max(0, s.lines.length - (rows - 1)))

    c.save()
    c.beginPath()
    c.rect(x, y + PANE_HEAD_H, w, h - PANE_HEAD_H)
    c.clip()
    c.textBaseline = 'top'

    visible.forEach((line, i) => {
      this.drawAnsiLine(line, x + PAD_X, top + i * LINE_H, w - PAD_X * 2)
    })

    // Prompt + input + block cursor
    const py = top + visible.length * LINE_H
    let px = x + PAD_X
    px = this.drawAnsiLine(highlightPrompt(s.prompt), px, py, w - PAD_X * 2)
    px += CHAR_W
    c.font = FONT
    c.fillStyle = '#ffffff'
    c.fillText(s.input, px, py)
    if (cursorOn) {
      c.fillStyle = '#00dcff'
      c.fillRect(px + s.input.length * CHAR_W, py + 2, CHAR_W * 0.62, LINE_H - 8)
    }

    c.restore()
  }

  /**
   * Draw one ANSI-coded line, returning the x position after the last glyph.
   * Background runs are filled first so inverse-video headers read correctly.
   */
  private drawAnsiLine(line: string, x: number, y: number, maxW: number): number {
    const c = this.ctx
    const { segments } = parseAnsi(line)
    let cx = x

    for (const seg of segments) {
      if (!seg.text) continue
      const st = seg.style
      const fg = st.reverse ? (st.bg ?? CHROME.bg) : st.fg
      const bg = st.reverse ? (st.fg ?? CHROME.fg) : st.bg
      const wpx = seg.text.length * CHAR_W

      if (bg) {
        c.fillStyle = bg
        c.fillRect(cx, y - 2, wpx, LINE_H - 2)
      }

      c.font = st.bold ? FONT_BOLD : FONT
      c.globalAlpha = st.dim ? 0.6 : 1
      c.fillStyle = fg ?? CHROME.fg
      c.fillText(seg.text, cx, y)
      c.globalAlpha = 1

      cx += wpx
      if (cx > x + maxW) break
    }
    return cx
  }

  private paintCapture(input: ScreenInput, x: number, y: number, w: number, h: number) {
    const c = this.ctx
    c.fillStyle = CHROME.bgPane
    c.fillRect(x, y, w, h)
    this.paneHead(x, y, w, 'live capture',
      input.capturing ? `· ${input.packets.length} frames` : '· idle', CHROME.borderTable)

    const rowH = 26
    const headY = y + PANE_HEAD_H
    const cols = [0.09, 0.20, 0.44, 0.72, 0.90]

    // Inverse header row
    c.fillStyle = CHROME.borderTable
    c.fillRect(x, headY, w, rowH)
    c.font = SMALL_FONT
    c.textBaseline = 'middle'
    c.fillStyle = '#05070b'
    const heads = ['NO', 'PROTO', 'SOURCE', 'DEST', 'LEN']
    heads.forEach((t, i) => c.fillText(t, x + 12 + cols[i] * (w - 24), headY + rowH / 2))

    const rows = Math.floor((h - PANE_HEAD_H - rowH) / rowH)
    const list = input.packets.slice(-rows).reverse()

    if (list.length === 0) {
      c.fillStyle = CHROME.fgDim
      c.font = SMALL_FONT
      c.textAlign = 'center'
      c.fillText('waiting for frames…', x + w / 2, headY + rowH * 2)
      c.textAlign = 'left'
      return
    }

    list.forEach((p, i) => {
      const ry = headY + rowH + i * rowH
      if (i % 2 === 0) {
        c.fillStyle = 'rgba(255,255,255,0.018)'
        c.fillRect(x, ry, w, rowH)
      }
      const cells: [string, string][] = [
        [String(p.id), CHROME.fgDim],
        [p.protocol, protoColor(p.protocol)],
        [p.srcIp || p.srcMac, CHROME.fg],
        [p.dstIp || p.dstMac, CHROME.fg],
        [String(p.size), CHROME.fgDim],
      ]
      c.font = SMALL_FONT
      cells.forEach(([t, col], ci) => {
        c.fillStyle = col
        c.fillText(t, x + 12 + cols[ci] * (w - 24), ry + rowH / 2)
      })
    })
  }

  private paintHex(input: ScreenInput, x: number, y: number, w: number, h: number) {
    const c = this.ctx
    c.fillStyle = CHROME.bgPane
    c.fillRect(x, y, w, h)
    this.paneHead(x, y, w, 'hexdump', '· tcpdump -X', CHROME.borderHex)

    const last = input.packets[input.packets.length - 1]
    const rows = Math.floor((h - PANE_HEAD_H - PAD_Y * 2) / 24)

    const lines = last
      ? dumpPacket(last, Math.max(2, rows - 2))
      : ['\x1b[90mNo frame selected.\x1b[0m', '',
         '\x1b[90mAttach the sniffer to a link (K)\x1b[0m',
         '\x1b[90mto populate this pane.\x1b[0m']

    c.save()
    c.beginPath()
    c.rect(x, y + PANE_HEAD_H, w, h - PANE_HEAD_H)
    c.clip()
    c.textBaseline = 'top'

    // The hex pane uses a smaller grid than the console.
    const savedFont = FONT
    lines.slice(0, rows).forEach((line, i) => {
      this.drawAnsiSmall(line, x + 14, y + PANE_HEAD_H + PAD_Y + i * 24, w - 28)
    })
    void savedFont
    c.restore()
  }

  /** Hex pane variant — 17px grid so 16 bytes fit the narrow column. */
  private drawAnsiSmall(line: string, x: number, y: number, maxW: number) {
    const c = this.ctx
    const { segments } = parseAnsi(line)
    const cw = 10.2
    let cx = x
    c.font = '500 17px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'
    for (const seg of segments) {
      if (!seg.text) continue
      c.fillStyle = seg.style.fg ?? CHROME.fg
      c.globalAlpha = seg.style.dim ? 0.6 : 1
      c.fillText(seg.text, cx, y)
      c.globalAlpha = 1
      cx += seg.text.length * cw
      if (cx > x + maxW) break
    }
  }

  private paintStatusBar(s: TerminalSessionState) {
    const c = this.ctx
    const y = H - STATUS_H
    c.fillStyle = CHROME.statusBg
    c.fillRect(0, y, W, STATUS_H)
    c.fillStyle = CHROME.border
    c.fillRect(0, y, W, 1)

    c.font = SMALL_FONT
    c.textBaseline = 'middle'
    const my = y + STATUS_H / 2
    let x = PAD_X

    // [netlab] tag
    const tag = 'netlab'
    const tw = c.measureText(tag).width + 20
    c.fillStyle = CHROME.statusActive
    roundRect(c, x, y + 9, tw, STATUS_H - 18, 3)
    c.fill()
    c.fillStyle = '#05070b'
    c.fillText(tag, x + 10, my)
    x += tw + 14

    c.fillStyle = '#00dcff'
    c.fillText(s.deviceId ?? '', x, my)
    x += c.measureText(s.deviceId ?? '').width + 14

    const mode = /\(config/.test(s.prompt) ? 'config' : s.prompt.endsWith('#') ? 'priv' : 'user'
    const modeColor = mode === 'config' ? '#d7a3ff' : mode === 'priv' ? '#ff8a80' : '#6cb6ff'
    const mw = c.measureText(mode).width + 18
    c.fillStyle = modeColor + '2b'
    roundRect(c, x, y + 9, mw, STATUS_H - 18, 3)
    c.fill()
    c.fillStyle = modeColor
    c.fillText(mode, x + 9, my)
    x += mw + 14

    if (s.busy) {
      c.fillStyle = CHROME.statusActive
      c.fillText('▶ streaming', x, my)
    }

    c.fillStyle = CHROME.fgDim
    c.textAlign = 'right'
    c.fillText('Tab complete · ? help · ^L clear · F4 camera · Esc close', W - PAD_X, my)
    c.textAlign = 'left'
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}
