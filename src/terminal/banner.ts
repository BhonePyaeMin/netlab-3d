/**
 * banner.ts — Boot banners, POST sequences and the neofetch-style device card.
 *
 * A real console never opens on an empty buffer: it shows ROMMON output, a
 * platform banner and a MOTD. These builders produce that opening scrollback
 * (already ANSI-coloured) so the terminal feels like an attached console
 * rather than a text box.
 */
import { C, sgr, ESC, RESET } from './ansi'
import type { NetworkDevice } from '../network/engine/NetworkDevice'

const paint = (codes: string, text: string) => `${ESC}${codes}m${text}${RESET}`

/* ─── ASCII art ───────────────────────────────────────────────────────── */

const NETLAB_ART = [
  '  ███╗   ██╗███████╗████████╗██╗      █████╗ ██████╗ ',
  '  ████╗  ██║██╔════╝╚══██╔══╝██║     ██╔══██╗██╔══██╗',
  '  ██╔██╗ ██║█████╗     ██║   ██║     ███████║██████╔╝',
  '  ██║╚██╗██║██╔══╝     ██║   ██║     ██╔══██║██╔══██╗',
  '  ██║ ╚████║███████╗   ██║   ███████╗██║  ██║██████╔╝',
  '  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═════╝ ',
]

/** Cyan→magenta vertical gradient across the art rows. */
const ART_GRADIENT = ['38;5;51', '38;5;45', '38;5;39', '38;5;69', '38;5;99', '38;5;135']

function art(): string[] {
  return NETLAB_ART.map((row, i) => paint(ART_GRADIENT[i % ART_GRADIENT.length], row))
}

/** The 16-swatch colour bar every neofetch prints under the logo. */
function colorBar(): string[] {
  const block = '███'
  const row = (base: number) =>
    Array.from({ length: 8 }, (_, i) => paint(`${base + i}`, block)).join('')
  return ['  ' + row(30), '  ' + row(90)]
}

/* ─── Device facts ────────────────────────────────────────────────────── */

const PLATFORM: Record<string, { model: string; os: string; rom: string }> = {
  Router:   { model: 'ISR 4331/K9',        os: 'IOS-XE 17.09.04a',        rom: 'ROMMON 16.12(3r)' },
  Switch:   { model: 'Catalyst C9300-24P', os: 'IOS-XE 17.09.04a',        rom: 'ROMMON 17.09(1r)' },
  Firewall: { model: 'ASA 5516-X',         os: 'ASA 9.20(2)',             rom: 'ROMMON 1.1.19'   },
  Server:   { model: 'UCS C220 M6',        os: 'Debian GNU/Linux 12',     rom: 'BIOS 4.3(2.240)' },
  PC:       { model: 'Generic Workstation',os: 'VPCS 0.8.3',              rom: 'SeaBIOS 1.16.2'  },
  Storage:  { model: 'NetApp AFF A250',    os: 'ONTAP 9.14.1',            rom: 'BIOS 15.2'       },
}

function platformOf(device: NetworkDevice | undefined) {
  const type = (device as unknown as { type?: string })?.type ?? 'Router'
  return PLATFORM[type] ?? PLATFORM.Router
}

/** Deterministic pseudo-random so a device shows stable "hardware" facts. */
function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/* ─── Public builders ─────────────────────────────────────────────────── */

/**
 * The POST / boot sequence streamed line-by-line when a console attaches.
 * Kept short enough to finish in about a second at the overlay's stream rate.
 */
export function bootSequence(deviceId: string, device?: NetworkDevice): string[] {
  const p = platformOf(device)
  const seed = seedFrom(deviceId)
  const mem = 2048 << (seed % 3)
  const isLinux = (device?.capabilities?.terminal_type ?? 'cisco_ios') === 'linux'

  if (isLinux) {
    return [
      C.grey('[    0.000000] Linux version 6.1.0-18-amd64 (netlab-build) #1 SMP'),
      C.grey(`[    0.004112] Memory: ${mem}MB available`),
      C.grey('[    0.221904] pci 0000:00:03.0: Intel 82540EM Gigabit Ethernet'),
      C.grey('[    0.418337] systemd[1]: Detected virtualization kvm.'),
      `${C.grey('[')}${C.ok('  OK  ')}${C.grey(']')} Started ${C.bWhite('Network Manager')}.`,
      `${C.grey('[')}${C.ok('  OK  ')}${C.grey(']')} Reached target ${C.bWhite('Multi-User System')}.`,
      '',
      `${p.os} ${C.bCyan(deviceId)} tty1`,
      '',
    ]
  }

  return [
    C.grey(`${p.rom}, RELEASE SOFTWARE`),
    C.grey(`Platform ${p.model} with ${mem}K/${mem / 4}K bytes of memory.`),
    '',
    C.dim('Self decompressing the image : ') + C.green('#'.repeat(38)) + C.dim(' [OK]'),
    '',
    C.bCyan(`Cisco ${p.os}`),
    C.grey('Technical Support: http://www.cisco.com/techsupport'),
    C.grey('Copyright (c) 1986-2025 by Cisco Systems, Inc.'),
    '',
    `${p.model} (revision 1.${seed % 9}) with ${mem}K bytes of memory.`,
    `Processor board ID ${C.bWhite('FDO' + (seed % 100000).toString().padStart(5, '0') + 'XYZ')}`,
    '',
    C.warn('Press RETURN to get started.'),
    '',
  ]
}

/**
 * A neofetch-style card: ASCII logo on the left, device facts on the right,
 * colour bar underneath. Rendered once at the top of every console session.
 */
export function deviceCard(deviceId: string, device?: NetworkDevice): string[] {
  const p = platformOf(device)
  const seed = seedFrom(deviceId)
  const type = (device as unknown as { type?: string })?.type ?? 'Node'
  const ifaces = device?.interfaces?.size ?? 0
  const uptimeMin = 3 + (seed % 720)

  const facts: Array<[string, string]> = [
    ['host',      `${deviceId} (${type})`],
    ['platform',  p.model],
    ['os',        p.os],
    ['uptime',    `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m`],
    ['interfaces', String(ifaces)],
    ['console',   'vty0 @ 9600 8N1'],
    ['engine',    'NetLab simulation core'],
  ]

  const logo = art()
  const info = facts.map(([k, v]) => `${paint('96;1', k.padEnd(11))}${C.grey('·')} ${C.bWhite(v)}`)

  // Interleave: logo rows first, then the fact list indented beneath.
  const out: string[] = ['', ...logo, '']
  out.push(`  ${paint('95;1', deviceId)}${C.grey(' — ')}${C.bWhite(p.model)}`)
  out.push('  ' + C.grey('─'.repeat(52)))
  out.push(...info.map(l => '  ' + l))
  out.push('')
  out.push(...colorBar())
  out.push('')
  return out
}

/** Login banner / MOTD shown after the boot sequence. */
export function motd(deviceId: string): string[] {
  return [
    sgr('91;1', '  ┌──────────────────────────────────────────────────────┐'),
    sgr('91;1', '  │') + C.bYellow('  AUTHORISED ACCESS ONLY — activity is logged.        ') + sgr('91;1', '│'),
    sgr('91;1', '  │') + C.grey(`  Console session opened on ${deviceId.padEnd(25)}`) + sgr('91;1', '│'),
    sgr('91;1', '  └──────────────────────────────────────────────────────┘'),
    '',
  ]
}
