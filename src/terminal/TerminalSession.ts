/**
 * TerminalSession.ts — headless console session state.
 *
 * All console behaviour (scrollback, streaming, prompt, history, command
 * dispatch) lives here rather than in a React component, so the *same* live
 * session can be rendered simultaneously by:
 *
 *   · TerminalOverlay  — the flat 2D window
 *   · ConsoleStation   — the MacBook screen inside the 3D scene
 *
 * Using an external store rather than context also sidesteps the React
 * reconciler boundary at <Canvas>: r3f children read it the same way DOM
 * components do, via useSyncExternalStore.
 *
 * Follows the same subscriber pattern as NetworkStore.
 */
import { simulationEngine } from '../network/engine/globalEngine'
import { gns3Connector }    from '../network/engine/GNS3Connector'
import { C }                from './ansi'
import { highlight, highlightPrompt } from './highlight'
import { bootSequence, deviceCard, motd } from './banner'

/** How the active session is being presented. */
export type TerminalView = '2d' | '3d'

export interface TerminalSessionState {
  /** null when no console is open. */
  deviceId: string | null
  terminalType: string
  /** ANSI-coloured scrollback. */
  lines: string[]
  input: string
  prompt: string
  /** True while queued output is still being revealed. */
  busy: boolean
  view: TerminalView
  /** Bumped whenever a command is committed — lets views react to activity. */
  commandCount: number
}

/** Hard cap on scrollback so a chatty session can't grow the DOM without end. */
const MAX_SCROLLBACK = 1200
/** Lines revealed per animation frame while output streams in. */
const LINES_PER_FRAME = 3

const EMPTY: TerminalSessionState = {
  deviceId: null,
  terminalType: 'cisco_ios',
  lines: [],
  input: '',
  prompt: '',
  busy: false,
  view: '3d',
  commandCount: 0,
}

class TerminalSessionClass {
  private state: TerminalSessionState = { ...EMPTY }
  private subscribers = new Set<() => void>()

  /** Lines waiting to be revealed by the streaming pump. */
  private queue: string[] = []
  private raf: number | null = null

  /** Command history, newest last, plus the current recall position. */
  private history: string[] = []
  private historyIndex = -1

  /* ── Store plumbing ─────────────────────────────────────────────── */

  subscribe = (cb: () => void): (() => void) => {
    this.subscribers.add(cb)
    return () => { this.subscribers.delete(cb) }
  }

  getSnapshot = (): TerminalSessionState => this.state

  private set(patch: Partial<TerminalSessionState>) {
    this.state = { ...this.state, ...patch }
    this.subscribers.forEach(cb => cb())
  }

  /* ── Output streaming ───────────────────────────────────────────── */

  private pump = () => {
    if (this.queue.length === 0) {
      this.raf = null
      if (this.state.busy) this.set({ busy: false })
      return
    }
    const chunk = this.queue.splice(0, LINES_PER_FRAME)
    this.set({ lines: capped(this.state.lines.concat(chunk)) })
    this.raf = requestAnimationFrame(this.pump)
  }

  /**
   * Append output. Streamed output is revealed a few lines per frame — a real
   * console never paints a 60-line `show run` in a single tick, and the
   * stagger is what sells it.
   */
  emit(newLines: string[], stream = true) {
    if (newLines.length === 0) return
    if (!stream) {
      this.set({ lines: capped(this.state.lines.concat(newLines)) })
      return
    }
    this.queue.push(...newLines)
    if (!this.state.busy) this.set({ busy: true })
    if (this.raf === null) this.raf = requestAnimationFrame(this.pump)
  }

  /** Reveal everything still queued — Ctrl+C, or Enter on an empty line. */
  flush() {
    if (this.queue.length === 0) return
    const rest = this.queue
    this.queue = []
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      // Null the handle too: a stale id would make `emit` believe a pump is
      // already scheduled and output would stop forever.
      this.raf = null
    }
    this.set({ lines: capped(this.state.lines.concat(rest)), busy: false })
  }

  /* ── Session lifecycle ──────────────────────────────────────────── */

  async open(deviceId: string) {
    const device = simulationEngine.getDevice(deviceId)

    this.queue = []
    if (this.raf !== null) { cancelAnimationFrame(this.raf); this.raf = null }
    this.history = []
    this.historyIndex = -1

    this.set({
      deviceId,
      terminalType: device?.capabilities?.terminal_type || 'cisco_ios',
      lines: [],
      input: '',
      prompt: simulationEngine.getPrompt(deviceId),
      busy: false,
      commandCount: 0,
    })

    this.emit([
      C.grey(`Trying ${deviceId} … `) + C.ok('Open'),
      '',
      ...bootSequence(deviceId, device),
      ...deviceCard(deviceId, device),
      ...motd(deviceId),
    ])

    // The GNS3 bridge is optional; when absent we stay on the local simulation
    // engine and say so rather than failing silently.
    const conn = await gns3Connector.connectToConsole(deviceId)
    if (this.state.deviceId !== deviceId) return   // session closed while awaiting
    this.emit([
      conn.success
        ? C.ok('[gns3] ') + C.grey(conn.message)
        : C.grey('[local] ') + C.grey('GNS3 bridge unavailable — using built-in simulation engine.'),
      '',
    ])
  }

  close() {
    this.queue = []
    if (this.raf !== null) { cancelAnimationFrame(this.raf); this.raf = null }
    this.set({ ...EMPTY, view: this.state.view })
  }

  setView(view: TerminalView) { this.set({ view }) }
  toggleView() { this.set({ view: this.state.view === '3d' ? '2d' : '3d' }) }

  setInput(input: string) { this.set({ input }) }

  /* ── Command entry ──────────────────────────────────────────────── */

  /** Client-side conveniences that never reach the device CLI. */
  private runLocal(cmd: string): boolean {
    const c = cmd.toLowerCase()
    const id = this.state.deviceId
    if (!id) return false

    if (c === 'clear' || c === 'cls') { this.set({ lines: [] }); return true }
    if (c === 'neofetch' || c === 'banner') {
      this.emit(deviceCard(id, simulationEngine.getDevice(id)))
      return true
    }
    if (c === 'logout' || c === 'quit') { this.close(); return true }
    return false
  }

  async submit() {
    const id = this.state.deviceId
    if (!id) return

    // Enter on an EMPTY line during a stream skips to the end, the way space
    // does at a `--More--` prompt. If something was typed, the command always
    // wins: a real terminal never discards input because output is arriving.
    if (this.queue.length > 0) {
      this.flush()
      if (!this.state.input.trim()) return
    }

    const cmd = this.state.input.trim()
    this.emit([`${highlightPrompt(this.state.prompt)} ${C.bWhite(cmd)}`], false)
    this.set({ input: '', commandCount: this.state.commandCount + 1 })
    this.historyIndex = -1

    if (!cmd) {
      this.set({ prompt: simulationEngine.getPrompt(id) })
      return
    }

    this.history.push(cmd)
    if (this.runLocal(cmd)) {
      if (this.state.deviceId) this.set({ prompt: simulationEngine.getPrompt(id) })
      return
    }

    this.set({ busy: true })
    const output = await gns3Connector.executeCommand(id, cmd, this.state.terminalType)
    if (this.state.deviceId !== id) return   // closed while awaiting
    this.emit(highlight(output))
    this.set({ prompt: simulationEngine.getPrompt(id) })
  }

  /** Ctrl+C — abandon the current line and stop paging. */
  interrupt() {
    if (!this.state.deviceId) return
    this.flush()
    this.emit([`${highlightPrompt(this.state.prompt)} ${this.state.input}${C.bRed('^C')}`], false)
    this.set({ input: '' })
  }

  clearScreen() { this.set({ lines: [] }) }

  tabComplete() {
    const id = this.state.deviceId
    if (!id) return
    const completed = simulationEngine.autoComplete(id, this.state.input)
    if (completed !== this.state.input) this.set({ input: completed })
  }

  showHelp() {
    const id = this.state.deviceId
    if (!id) return
    const help = simulationEngine.getHelp(id, this.state.input)
    this.emit([
      `${highlightPrompt(this.state.prompt)} ${this.state.input}?`,
      ...highlight(help),
    ])
  }

  historyPrev() {
    if (this.history.length === 0) return
    if (this.historyIndex >= this.history.length - 1) return
    this.historyIndex += 1
    this.set({ input: this.history[this.history.length - 1 - this.historyIndex] })
  }

  historyNext() {
    if (this.historyIndex > 0) {
      this.historyIndex -= 1
      this.set({ input: this.history[this.history.length - 1 - this.historyIndex] })
    } else if (this.historyIndex === 0) {
      this.historyIndex = -1
      this.set({ input: '' })
    }
  }
}

function capped(lines: string[]): string[] {
  return lines.length > MAX_SCROLLBACK ? lines.slice(lines.length - MAX_SCROLLBACK) : lines
}

/** Singleton — import this everywhere. */
export const TerminalSession = new TerminalSessionClass()
