/**
 * keyHandler.ts — one keyboard contract for both console presentations.
 *
 * The flat 2D window and the 3D MacBook display are different surfaces but the
 * same terminal, so they must respond to keys identically. Both route through
 * here, which also emits `netlab:keystroke` — the signal the animated hands and
 * the key caps listen to.
 */
import { TerminalSession } from './TerminalSession'

export interface KeyHandlerOptions {
  onClose: () => void
  /** Optional — only the 2D window has toggleable panes. */
  onTogglePanes?: () => void
}

/**
 * Handle one keydown against the live session.
 * Returns true when the event was consumed.
 */
export function handleTerminalKey(
  e: React.KeyboardEvent<HTMLInputElement> | KeyboardEvent,
  { onClose, onTogglePanes }: KeyHandlerOptions,
): boolean {
  if (!TerminalSession.getSnapshot().deviceId) return false

  // Broadcast every physical keypress so the 3D hands can type along. This
  // fires before any early return so modifiers animate too.
  window.dispatchEvent(new CustomEvent('netlab:keystroke', {
    detail: { key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey },
  }))

  const lower = e.key.toLowerCase()

  if (e.ctrlKey && lower === 'l') { e.preventDefault(); TerminalSession.clearScreen(); return true }
  if (e.ctrlKey && lower === 'c') { e.preventDefault(); TerminalSession.interrupt(); return true }
  if (e.ctrlKey || e.metaKey) return false

  switch (e.key) {
    case 'F2':        e.preventDefault(); onTogglePanes?.(); return true
    case 'Tab':       e.preventDefault(); TerminalSession.tabComplete(); return true
    case '?':         e.preventDefault(); TerminalSession.showHelp(); return true
    case 'ArrowUp':   e.preventDefault(); TerminalSession.historyPrev(); return true
    case 'ArrowDown': e.preventDefault(); TerminalSession.historyNext(); return true
    case 'Escape':    e.preventDefault(); onClose(); return true
    case 'Enter':     e.preventDefault(); void TerminalSession.submit(); return true
    default:          return false
  }
}
