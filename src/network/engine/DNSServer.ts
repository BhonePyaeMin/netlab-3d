/**
 * DNSServer.ts — Simulated DNS server for educational network simulation.
 * Supports hostname → IPv4 mappings and responds to A record queries over UDP/IP.
 */
import { NetworkDevice } from './NetworkDevice'
import { IPMath } from './IPMath'
import type { DNSPacket, DNSRecord, Frame, IPv4Packet, UDPPacket } from './DataPlane'

export interface DNSEntry {
  hostname: string
  ipAddress: string
  ttl: number
}

export class DNSServer {
  public device: NetworkDevice
  public enabled: boolean = false
  public records: Map<string, DNSEntry> = new Map() // Key: lowercase hostname

  constructor(device: NetworkDevice) {
    this.device = device
  }

  public addRecord(hostname: string, ipAddress: string, ttl: number = 86400) {
    this.records.set(hostname.toLowerCase(), { hostname: hostname.toLowerCase(), ipAddress, ttl })
    console.log(`[DNS] ${this.device.hostname}: Added record: ${hostname} -> ${ipAddress}`)
  }

  public removeRecord(hostname: string) {
    this.records.delete(hostname.toLowerCase())
  }

  public resolve(hostname: string): string | null {
    return this.records.get(hostname.toLowerCase())?.ipAddress ?? null
  }

  public receiveDNS(frame: Frame, intfId: string) {
    const intf = this.device.getInterface(intfId)
    if (!intf) return

    const ipPacket = frame.payload as IPv4Packet
    if (!ipPacket || ipPacket.protocol !== 17) return
    const udpPacket = ipPacket.payload as UDPPacket
    if (!udpPacket || udpPacket.dstPort !== 53) return
    const dnsQuery = udpPacket.payload as DNSPacket
    if (!dnsQuery || dnsQuery.qr !== 0) return // Only handle queries

    const answers: DNSRecord[] = []
    let rcode = 0 // No error

    for (const question of dnsQuery.questions) {
      if (question.type !== 1) continue // Only handle A records

      const ip = this.resolve(question.name)
      if (ip) {
        answers.push({
          name: question.name,
          type: 1,
          class: 1,
          ttl: this.records.get(question.name.toLowerCase())!.ttl,
          data: ip
        })
      } else {
        rcode = 3 // NXDOMAIN
      }
    }

    const dnsResponse: DNSPacket = {
      id: dnsQuery.id,
      qr: 1,
      opcode: 0,
      aa: true,
      tc: false,
      rd: dnsQuery.rd,
      ra: false,
      rcode,
      questions: dnsQuery.questions,
      answers
    }

    const responseUdp: UDPPacket = {
      srcPort: 53,
      dstPort: udpPacket.srcPort,
      length: 100,
      checksum: 0,
      payload: dnsResponse
    }

    const responseIp: IPv4Packet = {
      version: 4,
      ihl: 5,
      tos: 0,
      totalLength: 120,
      identification: 0,
      flags: 0,
      fragmentOffset: 0,
      ttl: 64,
      protocol: 17,
      headerChecksum: 0,
      srcIp: intf.ipAddress!,
      dstIp: ipPacket.srcIp,
      payload: responseUdp
    }

    const responseFrame: Frame = {
      srcMac: intf.macAddress,
      dstMac: frame.srcMac,
      ethertype: 0x0800,
      payload: responseIp
    }

    if (intf.type === 'subinterface' && intf.encapsulationDot1Q) {
      this.device.engine?.transmitFrame(this.device.id, intf.parentPortId!, {
        srcMac: responseFrame.srcMac,
        dstMac: responseFrame.dstMac,
        ethertype: 0x8100,
        payload: { vlanId: intf.encapsulationDot1Q, ethertype: 0x0800, payload: responseFrame.payload }
      })
    } else {
      this.device.engine?.transmitFrame(this.device.id, intf.connectedPortId!, responseFrame)
    }

    const status = answers.length > 0 ? `Resolved: ${answers[0].data}` : `NXDOMAIN`
    console.log(`[DNS] ${this.device.hostname}: Query from ${ipPacket.srcIp} for "${dnsQuery.questions[0]?.name}" -> ${status}`)
  }
}
