/**
 * highlight.ts — Semantic colouriser for network CLI output.
 *
 * The simulation engines (CLIEngine, VPCS, Linux shell) emit plain text so they
 * stay easy to unit-test. This module is the presentation layer that turns that
 * text into the colour a real IOS / Linux terminal would produce: green link
 * state, red errors, cyan addresses, amber interfaces, inverse table headers.
 *
 * Everything happens in ONE pass over a master alternation regex, so a match is
 * never re-scanned and escape sequences can never nest.
 */
import { ESC, RESET } from './ansi'

/** Paint `text` with the given SGR codes. */
const paint = (codes: string, text: string) => `${ESC}${codes}m${text}${RESET}`

/* ─── Palette roles ───────────────────────────────────────────────────── */
const ROLE = {
  ipv4:      '96',      // bright cyan
  mac:       '95',      // bright magenta
  iface:     '93',      // bright yellow
  up:        '92;1',    // bright green bold
  down:      '91;1',    // bright red bold
  errorLine: '91;1',
  warnLine:  '93',
  okLine:    '92',
  header:    '30;42;1', // black on green — inverse header row
  keyword:   '94',      // bright blue
  number:    '97',      // bright white
  comment:   '90',
} as const

/* ─── Line-level classifiers ──────────────────────────────────────────── */

/** Column-header lines from `show` commands, rendered as inverse bars. */
const HEADER_PATTERNS: RegExp[] = [
  /^Interface\s+IP-Address\s+OK\?/i,
  /^Protocol\s+Address\s+Age/i,
  /^\s*Destination\s+Gateway/i,
  /^\s*Vlan\s+Name\s+Status/i,
  /^Device ID\s+Local Int/i,
  /^\s*Vlan\s+Mac Address\s+Type/i,
  /^Port\s+Mode\s+Encapsulation/i,
  /^Neighbor ID\s+Pri\s+State/i,
  /^Secure Port\s+MaxSecureAddr/i,
  /^Pro\s+Inside global/i,
  /^IP address\s+Client-ID/i,
  /^No\.\s+Time\s+Source/i,
  /^\s*Interface\s+PID\s+Area/i,
]

const ERROR_LINE = /^(%|ERROR|error:|FAILED|Invalid input|Unknown command|Request timed out|Destination host unreachable|Permission denied)/i
const WARN_LINE  = /^(WARN|Warning|\*\w{3}\s+\d+\s+\d\d:)/i
const OK_LINE    = /^(\[OK\]|Building configuration|Compressed configuration|Success rate is 100)/i
const LEGEND     = /^(Codes:|\s{7}\w+ - )/
/** A bare IOS ping result row: `!!!!!`, `.!!!!`, `U.U.U` — nothing else on it. */
const PING_LINE  = /^[!.UQM*]{2,}$/

/* ─── Token-level master regex ────────────────────────────────────────── */
/*
 * Order matters: longer / more specific alternatives come first so that, for
 * example, an interface name is matched before the bare number inside it.
 */
const TOKENS = new RegExp(
  [
    // interface names (Gi0/0, FastEthernet0/1, Se0/0/0.100, Vlan10, eth0, ens33)
    '(?<iface>\\b(?:Gigabit|Fast|Ten|Forty|Hundred)?Ethernet\\d+(?:\\/\\d+)*(?:\\.\\d+)?\\b|\\b(?:Gi|Fa|Te|Et|Se|Lo|Po|Vl|Tu)\\d+(?:\\/\\d+)*(?:\\.\\d+)?\\b|\\bSerial\\d+(?:\\/\\d+)*\\b|\\bVlan\\d+\\b|\\bLoopback\\d+\\b|\\b(?:eth|ens|enp|wlan)\\d+\\b)',
    // MAC addresses — both cisco dotted and colon/hyphen forms
    '(?<mac>\\b[0-9a-fA-F]{4}\\.[0-9a-fA-F]{4}\\.[0-9a-fA-F]{4}\\b|\\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\\b)',
    // IPv4, optionally with /prefix
    '(?<ipv4>\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?:\\/\\d{1,2})?\\b)',
    // link / admin state words
    '(?<up>\\bup\\b|\\bUP\\b|\\bconnected\\b|\\bactive\\b|\\bFULL\\b|\\bestablished\\b|\\bassigned\\b)',
    '(?<down>\\bdown\\b|\\bDOWN\\b|\\bnotconnect\\b|\\berr-disabled\\b|\\bINIT\\b|\\bdeleted\\b|\\bunreachable\\b|\\bfailed\\b)',
    // ping result strings — a run of ! or .
    '(?<pingok>!{2,})',
    // routing-protocol source codes at the start of a route line
    '(?<routecode>^[OCSRDBIEL]\\*?(?:\\s+(?:E1|E2|N1|N2|IA|EX))?(?=\\s+\\d))',
    // common config keywords
    '(?<keyword>\\b(?:interface|router|ospf|eigrp|rip|bgp|network|area|hostname|enable|configure|shutdown|permit|deny|access-list|vlan|switchport|trunk|encapsulation|dot1q|route|nat|inside|outside|dhcp|pool|default-gateway|password|secret|version|duplex|speed|description)\\b)',
    // bare numbers with units
    '(?<number>\\b\\d+(?:\\.\\d+)?\\s?(?:ms|bytes|packets|percent)\\b)',
  ].join('|'),
  'g',
)

/**
 * Colour each character of a ping result row by what it means:
 * `!` reply · `.` timeout · `U` unreachable · `Q` source quench · `M` MTU.
 */
function colourPingRow(line: string): string {
  return line.replace(/[!.UQM*]/g, ch => {
    if (ch === '!') return paint(ROLE.up, ch)
    if (ch === '.') return paint(ROLE.down, ch)
    return paint(ROLE.warnLine, ch)
  })
}

/**
 * Colourise a single plain-text line of CLI output.
 * Lines that already contain escape sequences are returned untouched, so a
 * command can opt out by emitting its own colour.
 */
export function highlightLine(line: string): string {
  if (line.includes('\x1b')) return line
  if (line.trim() === '') return line

  const trimmed = line.trimStart()

  // Whole-line rules first — they win over token rules.
  for (const re of HEADER_PATTERNS) {
    if (re.test(line)) return paint(ROLE.header, line)
  }
  // Ping result rows must be tested before the `!`-comment rule, since a
  // successful IOS ping is a line of nothing but exclamation marks.
  if (PING_LINE.test(trimmed)) return colourPingRow(line)
  if (LEGEND.test(line))       return paint(ROLE.comment, line)
  if (ERROR_LINE.test(trimmed)) return paint(ROLE.errorLine, line)
  if (OK_LINE.test(trimmed))    return paint(ROLE.okLine, line)
  if (WARN_LINE.test(trimmed))  return paint(ROLE.warnLine, line)
  // IOS comment / separator lines in running-config dumps.
  if (/^\s*!/.test(line))       return paint(ROLE.comment, line)

  TOKENS.lastIndex = 0
  return line.replace(TOKENS, (matched: string, ...rest: unknown[]) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>

    if (groups.iface)     return paint(ROLE.iface, matched)
    if (groups.mac)       return paint(ROLE.mac, matched)
    if (groups.ipv4)      return paint(ROLE.ipv4, matched)
    if (groups.up)        return paint(ROLE.up, matched)
    if (groups.down)      return paint(ROLE.down, matched)
    if (groups.pingok)    return paint(ROLE.up, matched)
    if (groups.routecode) return paint('96;1', matched)
    if (groups.keyword)   return paint(ROLE.keyword, matched)
    if (groups.number)    return paint(ROLE.number, matched)
    return matched
  })
}

/** Colourise a block of output, splitting on newlines. */
export function highlight(output: string): string[] {
  if (!output) return []
  return output.split('\n').map(highlightLine)
}

/**
 * Colourise a shell prompt the way a real `PS1` would: user@host in green,
 * path in blue, mode marker in magenta, sigil in white.
 *
 * Handles the prompt shapes the engine produces:
 *   R1>  ·  R1#  ·  R1(config-if)#  ·  root@srv:~#  ·  C:\Users\Administrator>
 */
export function highlightPrompt(prompt: string): string {
  if (!prompt) return prompt

  // Linux: root@host:~#
  const linux = /^([\w.-]+)@([\w.-]+):(\S*?)([#$])$/.exec(prompt)
  if (linux) {
    const [, user, host, path, sigil] = linux
    return (
      paint('92;1', user) + paint('90', '@') + paint('92;1', host) +
      paint('90', ':') + paint('94;1', path) + paint('97;1', sigil)
    )
  }

  // Windows: C:\Users\Administrator>
  if (/^[A-Za-z]:\\/.test(prompt)) {
    return paint('94;1', prompt.replace(/>$/, '')) + paint('97;1', '>')
  }

  // Cisco IOS: HOST(mode)#  /  HOST#  /  HOST>
  const ios = /^([\w.-]+)(\([\w-]+\))?([#>])$/.exec(prompt)
  if (ios) {
    const [, host, mode, sigil] = ios
    return (
      paint('96;1', host) +
      (mode ? paint('95', mode) : '') +
      paint(sigil === '#' ? '91;1' : '97;1', sigil)
    )
  }

  return paint('96;1', prompt)
}
