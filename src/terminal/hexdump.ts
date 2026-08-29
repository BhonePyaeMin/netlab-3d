/**
 * hexdump.ts — Byte-level packet rendering, `tcpdump -X` style.
 *
 * Captured packets carry only decoded metadata (addresses, ports, protocol,
 * size). To show a credible hex pane we serialise that metadata back into the
 * bytes it came from — a real Ethernet II frame with an IPv4 header and a
 * transport header — then format offset / hex / ASCII columns.
 *
 * Bytes are colour-coded by the header they belong to, which is what makes the
 * pane readable rather than decorative:
 *   L2 header  magenta · L3 header cyan · L4 header green · payload grey
 */
import { ESC, RESET } from './ansi'
import type { CapturedPacket } from '../network/types'

const paint = (codes: string, text: string) => `${ESC}${codes}m${text}${RESET}`

const L2 = '95'      // magenta
const L3 = '96'      // cyan
const L4 = '92'      // green
const PAYLOAD = '90' // grey

/** ethertype / IP protocol numbers keyed by the engine's protocol label. */
const IP_PROTO: Record<string, number> = {
  ICMP: 1, TCP: 6, UDP: 17, OSPF: 89, DNS: 17, DHCP: 17, RIP: 17,
}

function macBytes(mac: string | undefined): number[] {
  if (!mac) return [0, 0, 0, 0, 0, 0]
  const hexPairs = mac.replace(/[.:-]/g, '').match(/.{1,2}/g) ?? []
  const out = hexPairs.slice(0, 6).map(h => parseInt(h, 16) & 0xff)
  while (out.length < 6) out.push(0)
  return out
}

function ipBytes(ip: string | undefined): number[] {
  if (!ip) return [0, 0, 0, 0]
  const parts = ip.split('.').map(n => parseInt(n, 10) & 0xff)
  while (parts.length < 4) parts.push(0)
  return parts.slice(0, 4)
}

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff]

/** One byte of the frame plus the header region it belongs to. */
interface TaggedByte { value: number; role: string }

/**
 * Rebuild the on-the-wire frame for a captured packet.
 * Returns every byte tagged with its header region.
 */
export function serialiseFrame(p: CapturedPacket): TaggedByte[] {
  const bytes: TaggedByte[] = []
  const push = (vals: number[], role: string) =>
    vals.forEach(v => bytes.push({ value: v & 0xff, role }))

  /* — Ethernet II — */
  push(macBytes(p.dstMac), L2)
  push(macBytes(p.srcMac), L2)
  if (p.vlan && p.vlan !== 1) {
    push([0x81, 0x00], L2)                   // 802.1Q TPID
    push(u16((p.vlan & 0x0fff) | 0x0000), L2) // PCP/DEI/VID
  }
  const isArp = p.protocol === 'ARP'
  push(isArp ? [0x08, 0x06] : [0x08, 0x00], L2) // EtherType

  if (isArp) {
    push([0x00, 0x01], L3)                 // HTYPE ethernet
    push([0x08, 0x00], L3)                 // PTYPE IPv4
    push([0x06, 0x04], L3)                 // HLEN / PLEN
    push([0x00, 0x01], L3)                 // OPER request
    push(macBytes(p.srcMac), L3)
    push(ipBytes(p.srcIp), L3)
    push(macBytes(p.dstMac), L3)
    push(ipBytes(p.dstIp), L3)
    // Ethernet minimum-frame padding.
    push(new Array(18).fill(0x00), PAYLOAD)
    return bytes
  }

  /* — IPv4 — */
  const totalLen = Math.max(20, p.size - 14)
  push([0x45, 0x00], L3)                    // version/IHL, DSCP
  push(u16(totalLen), L3)                   // total length
  push(u16(p.id & 0xffff), L3)              // identification
  push([0x40, 0x00], L3)                    // flags (DF) / fragment offset
  push([(p.ttl ?? 64) & 0xff, IP_PROTO[p.protocol] ?? 6], L3)
  push([0x00, 0x00], L3)                    // header checksum (elided)
  push(ipBytes(p.srcIp), L3)
  push(ipBytes(p.dstIp), L3)

  /* — Transport — */
  if (p.protocol === 'ICMP') {
    push([0x08, 0x00], L4)                  // type 8 echo request, code 0
    push([0x00, 0x00], L4)                  // checksum
    push(u16(p.id & 0xffff), L4)            // identifier
    push(u16(1), L4)                        // sequence
  } else if (p.srcPort !== undefined || p.dstPort !== undefined) {
    push(u16(p.srcPort ?? 0), L4)
    push(u16(p.dstPort ?? 0), L4)
    if (p.protocol === 'TCP') {
      push(u16(p.id * 7919), L4)            // sequence
      push([0x00, 0x00], L4)
      push(u16(0), L4)                      // ack
      push([0x00, 0x00], L4)
      push([0x50, 0x18], L4)                // offset / PSH+ACK
      push(u16(0x7210), L4)                 // window
      push([0x00, 0x00, 0x00, 0x00], L4)    // checksum / urgent
    } else {
      push(u16(Math.max(8, p.size - 34)), L4) // UDP length
      push([0x00, 0x00], L4)                  // checksum
    }
  }

  /* — Payload — deterministic filler so redraws are stable. */
  const remaining = Math.max(0, p.size - bytes.length)
  let seed = (p.id * 2654435761) >>> 0
  for (let i = 0; i < Math.min(remaining, 96); i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    const printable = 0x20 + ((seed >>> 16) % 0x5f)
    bytes.push({ value: printable, role: PAYLOAD })
  }

  return bytes
}

/** Printable-ASCII gutter character for a byte. */
function ascii(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
}

/**
 * Format a frame as coloured `tcpdump -X` lines:
 *   `0x0000:  4500 003c 1c46 4000 4006 ...   E..<.F@.@.`
 *
 * @param maxRows cap on the number of 16-byte rows (pane height)
 */
export function hexdump(bytes: TaggedByte[], maxRows = 12): string[] {
  const rows: string[] = []

  for (let off = 0; off < bytes.length && rows.length < maxRows; off += 16) {
    const slice = bytes.slice(off, off + 16)

    const hexCols = slice
      .map(b => paint(b.role, b.value.toString(16).padStart(2, '0')))
      .reduce<string[]>((acc, cur, i) => {
        // Group into 8 pairs of two bytes, tcpdump style.
        if (i % 2 === 0) acc.push(cur)
        else acc[acc.length - 1] += cur
        return acc
      }, [])
      .join(' ')

    // Pad using the uncoloured width so columns stay aligned.
    const plainWidth = slice.length * 2 + Math.max(0, Math.ceil(slice.length / 2) - 1)
    const targetWidth = 16 * 2 + 7
    const pad = ' '.repeat(Math.max(0, targetWidth - plainWidth))

    const gutter = slice.map(b => paint(b.role, ascii(b.value))).join('')

    rows.push(
      `${paint('90', '0x' + off.toString(16).padStart(4, '0') + ':')}  ` +
      hexCols + pad + '  ' +
      paint('90', '|') + gutter + paint('90', '|'),
    )
  }

  if (bytes.length > maxRows * 16) {
    rows.push(paint('90', `         … ${bytes.length - maxRows * 16} more bytes truncated`))
  }

  return rows
}

/** Convenience: metadata summary line + hexdump for one captured packet. */
export function dumpPacket(p: CapturedPacket, maxRows = 12): string[] {
  const ports = p.srcPort !== undefined ? `:${p.srcPort} > ${p.dstIp}:${p.dstPort}` : ` > ${p.dstIp ?? p.dstMac}`
  const head =
    paint('90', `#${p.id} `) +
    paint('93;1', p.protocol.padEnd(5)) +
    paint('96', `${p.srcIp ?? p.srcMac}${ports}`) +
    paint('90', `  len ${p.size}`) +
    (p.vlan && p.vlan !== 1 ? paint('95', `  vlan ${p.vlan}`) : '')

  return [head, '', ...hexdump(serialiseFrame(p), maxRows)]
}
