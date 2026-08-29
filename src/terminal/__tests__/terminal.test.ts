import { describe, it, expect } from 'vitest'
import { parseAnsi, parseAnsiBlock, stripAnsi, C } from '../ansi'
import { highlightLine, highlightPrompt, highlight } from '../highlight'
import { serialiseFrame, hexdump, dumpPacket } from '../hexdump'
import { bootSequence, deviceCard, motd } from '../banner'
import { ANSI_256, protoColor } from '../theme'
import type { CapturedPacket } from '../../network/types'

describe('ansi parser', () => {
  it('splits a line into styled segments', () => {
    const { segments } = parseAnsi('plain\x1b[31mred\x1b[0mplain2')
    expect(segments.map(s => s.text)).toEqual(['plain', 'red', 'plain2'])
    expect(segments[1].style.fg).toBe(ANSI_256[1])
    expect(segments[2].style.fg).toBeUndefined()
  })

  it('applies bold, dim, underline and reverse attributes', () => {
    const { segments } = parseAnsi('\x1b[1;2;4;7mx')
    const s = segments[0].style
    expect(s).toMatchObject({ bold: true, dim: true, underline: true, reverse: true })
  })

  it('turns attributes off with their 2x counterparts', () => {
    const { segments } = parseAnsi('\x1b[1ma\x1b[22mb')
    expect(segments[0].style.bold).toBe(true)
    expect(segments[1].style.bold).toBeUndefined()
  })

  it('resolves 256-colour and truecolour selectors', () => {
    expect(parseAnsi('\x1b[38;5;196mx').segments[0].style.fg).toBe(ANSI_256[196])
    expect(parseAnsi('\x1b[38;2;10;20;30mx').segments[0].style.fg).toBe('rgb(10, 20, 30)')
  })

  it('maps bright foreground codes 90-97 onto the bright half of the palette', () => {
    expect(parseAnsi('\x1b[92mx').segments[0].style.fg).toBe(ANSI_256[10])
  })

  it('carries style across lines in a block', () => {
    const parsed = parseAnsiBlock(['\x1b[32mgreen start', 'still green', '\x1b[0mdone'])
    expect(parsed[1].segments[0].style.fg).toBe(ANSI_256[2])
    expect(parsed[2].segments[parsed[2].segments.length - 1].style.fg).toBeUndefined()
  })

  it('swallows non-SGR CSI sequences instead of printing them', () => {
    const { segments } = parseAnsi('a\x1b[2Kb\x1b[Hc')
    expect(segments.map(s => s.text).join('')).toBe('abc')
  })

  it('always yields one segment so blank lines keep their height', () => {
    expect(parseAnsi('').segments).toHaveLength(1)
  })

  it('stripAnsi round-trips to the visible text', () => {
    expect(stripAnsi(C.bGreen('up') + ' / ' + C.err('down'))).toBe('up / down')
  })
})

describe('semantic highlighter', () => {
  const visible = (s: string) => stripAnsi(s)

  it('never changes the visible text', () => {
    const line = 'GigabitEthernet0/0    192.168.1.1     YES manual up                    up'
    expect(visible(highlightLine(line))).toBe(line)
  })

  it('colours IPv4 addresses, interfaces and MACs', () => {
    const out = highlightLine('Gi0/1 10.0.0.1 aabb.ccdd.eeff')
    expect(out).toContain('\x1b[93m')  // interface  → yellow
    expect(out).toContain('\x1b[96m')  // ipv4       → cyan
    expect(out).toContain('\x1b[95m')  // mac        → magenta
  })

  it('marks link state up green and down red', () => {
    expect(highlightLine('Serial0/0/0 is up')).toContain('\x1b[92;1m')
    expect(highlightLine('Serial0/0/0 is down')).toContain('\x1b[91;1m')
  })

  it('paints IOS error lines red', () => {
    expect(highlightLine('% Invalid input detected at "^" marker.')).toMatch(/^\x1b\[91;1m/)
  })

  it('renders show-command column headers as inverse bars', () => {
    const out = highlightLine('Interface              IP-Address      OK? Method Status')
    expect(out).toMatch(/^\x1b\[30;42;1m/)
  })

  it('dims IOS config comment lines', () => {
    expect(highlightLine('!')).toMatch(/^\x1b\[90m/)
  })

  it('leaves pre-coloured lines untouched', () => {
    const pre = C.bCyan('already coloured')
    expect(highlightLine(pre)).toBe(pre)
  })

  it('highlights a successful ping run', () => {
    expect(highlightLine('!!!!!')).toContain('\x1b[92;1m')
  })

  it('splits blocks on newlines', () => {
    expect(highlight('a\nb\nc')).toHaveLength(3)
    expect(highlight('')).toEqual([])
  })
})

describe('prompt highlighting', () => {
  it.each([
    ['R1>', 'R1>'],
    ['R1#', 'R1#'],
    ['R1(config-if)#', 'R1(config-if)#'],
    ['root@srv1:~#', 'root@srv1:~#'],
    ['C:\\Users\\Administrator>', 'C:\\Users\\Administrator>'],
  ])('preserves the visible text of %s', (prompt, expected) => {
    expect(stripAnsi(highlightPrompt(prompt))).toBe(expected)
  })

  it('distinguishes privileged from user mode by sigil colour', () => {
    expect(highlightPrompt('R1#')).toContain('\x1b[91;1m')
    expect(highlightPrompt('R1>')).toContain('\x1b[97;1m')
  })
})

describe('hexdump', () => {
  const packet: CapturedPacket = {
    id: 7,
    timestamp: 1_700_000_000_000,
    srcMac: 'aabb.ccdd.eeff',
    dstMac: '0011.2233.4455',
    srcIp: '192.168.1.10',
    dstIp: '10.0.0.5',
    protocol: 'TCP',
    vlan: 1,
    ttl: 64,
    srcPort: 51234,
    dstPort: 443,
    size: 74,
  }

  it('serialises an Ethernet+IPv4+TCP frame with the right prefix', () => {
    const bytes = serialiseFrame(packet).map(b => b.value)
    // dst MAC, then src MAC, then EtherType 0x0800.
    expect(bytes.slice(0, 6)).toEqual([0x00, 0x11, 0x22, 0x33, 0x44, 0x55])
    expect(bytes.slice(6, 12)).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])
    expect(bytes.slice(12, 14)).toEqual([0x08, 0x00])
    // IPv4 version/IHL, then TTL and protocol 6 at the usual offsets.
    expect(bytes[14]).toBe(0x45)
    expect(bytes[22]).toBe(64)
    expect(bytes[23]).toBe(6)
  })

  it('writes the source and destination IPs into the IPv4 header', () => {
    const bytes = serialiseFrame(packet).map(b => b.value)
    expect(bytes.slice(26, 30)).toEqual([192, 168, 1, 10])
    expect(bytes.slice(30, 34)).toEqual([10, 0, 0, 5])
  })

  it('inserts an 802.1Q tag for a non-default VLAN', () => {
    const bytes = serialiseFrame({ ...packet, vlan: 20 }).map(b => b.value)
    expect(bytes.slice(12, 14)).toEqual([0x81, 0x00])
    expect(bytes[15]).toBe(20)
  })

  it('emits ARP frames with EtherType 0x0806', () => {
    const bytes = serialiseFrame({ ...packet, protocol: 'ARP' }).map(b => b.value)
    expect(bytes.slice(12, 14)).toEqual([0x08, 0x06])
  })

  it('formats rows with offset, hex columns and an ASCII gutter', () => {
    // 74 bytes → 5 data rows; capped at 4 plus a trailing truncation notice.
    const rows = hexdump(serialiseFrame(packet), 4)
    expect(rows).toHaveLength(5)
    expect(stripAnsi(rows[0])).toMatch(/^0x0000:\s+([0-9a-f]{4}\s){7}[0-9a-f]{4}\s+\|.{16}\|$/)
    expect(stripAnsi(rows[1])).toMatch(/^0x0010:/)
    expect(stripAnsi(rows[4])).toContain('more bytes truncated')
  })

  it('respects the row cap and reports truncation', () => {
    const rows = hexdump(serialiseFrame({ ...packet, size: 1500 }), 2)
    expect(rows).toHaveLength(3)
    expect(stripAnsi(rows[2])).toContain('more bytes truncated')
  })

  it('is deterministic for the same packet', () => {
    expect(dumpPacket(packet)).toEqual(dumpPacket(packet))
  })

  it('leads with a tcpdump-style summary line', () => {
    expect(stripAnsi(dumpPacket(packet)[0])).toBe('#7 TCP  192.168.1.10:51234 > 10.0.0.5:443  len 74')
  })
})

describe('banners', () => {
  it('produces an IOS boot sequence for network gear', () => {
    const out = bootSequence('R1').map(stripAnsi).join('\n')
    expect(out).toContain('ROMMON')
    expect(out).toContain('Press RETURN to get started.')
  })

  it('produces a Linux boot sequence for a linux terminal type', () => {
    const device = { capabilities: { terminal_type: 'linux' } } as never
    const out = bootSequence('SRV1', device).map(stripAnsi).join('\n')
    expect(out).toContain('Linux version')
    expect(out).toContain('systemd')
  })

  it('is deterministic per device id', () => {
    expect(bootSequence('R1')).toEqual(bootSequence('R1'))
    expect(bootSequence('R1')).not.toEqual(bootSequence('R2'))
  })

  it('renders the device card with the host name and colour bar', () => {
    const card = deviceCard('R1')
    const text = card.map(stripAnsi).join('\n')
    expect(text).toContain('R1')
    expect(text).toContain('host')
    expect(card.some(l => stripAnsi(l).includes('███'))).toBe(true)
  })

  it('renders a boxed MOTD naming the device', () => {
    expect(motd('R1').map(stripAnsi).join('\n')).toContain('AUTHORISED ACCESS ONLY')
  })
})

describe('theme', () => {
  it('builds a full 256-entry palette', () => {
    expect(ANSI_256).toHaveLength(256)
    expect(ANSI_256[16]).toBe('#000000')
    expect(ANSI_256[231]).toBe('#ffffff')
  })

  it('maps known protocols to distinct colours and falls back otherwise', () => {
    expect(protoColor('TCP')).not.toBe(protoColor('UDP'))
    expect(protoColor('tcp')).toBe(protoColor('TCP'))
    expect(protoColor('MYSTERY')).toBe('#c5ccd6')
  })
})
