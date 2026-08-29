/**
 * DNSClient.ts — Simulated DNS client for educational network simulation.
 * Sends DNS A record queries to a configured DNS server and caches responses.
 */
import { NetworkDevice } from './NetworkDevice'
import type { DNSPacket, Frame, IPv4Packet, UDPPacket } from './DataPlane'
import { IPMath } from './IPMath'

export interface DNSCacheEntry {
  ipAddress: string
  ttl: number
  resolvedAt: number
}

export class DNSClient {
  public device: NetworkDevice
  public serverIp: string | null = null

  // Cache: hostname -> resolved IP
  public cache: Map<string, DNSCacheEntry> = new Map()

  // Pending queries: txid -> { hostname, callback, expiresAt }
  private pending: Map<number, { hostname: string; callback: (ip: string | null) => void, expiresAt: number }> = new Map()

  constructor(device: NetworkDevice) {
    this.device = device
  }

  /**
   * Perform a DNS query for a hostname.
   * @param hostname - The hostname to resolve
   * @param callback - Called with the resolved IP (or null on failure)
   */
  public resolve(hostname: string, callback: (ip: string | null) => void) {
    const lower = hostname.toLowerCase()

    // Check cache first
    const cached = this.cache.get(lower)
    if (cached) {
      callback(cached.ipAddress)
      return
    }

    if (!this.serverIp) {
      console.warn(`[DNS Client] ${this.device.hostname}: No DNS server configured`)
      callback(null)
      return
    }

    // Find an up interface to send from
    const srcIntf = Array.from(this.device.interfaces.values()).find(
      i => i.operStatus === 'up' && i.ipAddress && i.ipAddress !== 'dhcp'
    )
    if (!srcIntf) {
      console.warn(`[DNS Client] ${this.device.hostname}: No interface up to send DNS query`)
      callback(null)
      return
    }

    const txid = Math.floor(Math.random() * 0xFFFF)
    this.pending.set(txid, { hostname: lower, callback })

    const dnsQuery: DNSPacket = {
      id: txid,
      qr: 0,
      opcode: 0,
      aa: false,
      tc: false,
      rd: true,
      ra: false,
      rcode: 0,
      questions: [{ name: lower, type: 1, class: 1 }],
      answers: []
    }

    const udpPacket: UDPPacket = {
      srcPort: Math.floor(Math.random() * 10000) + 49152,
      dstPort: 53,
      length: 50,
      checksum: 0,
      payload: dnsQuery
    }

    const ipPacket: IPv4Packet = {
      version: 4,
      ihl: 5,
      tos: 0,
      totalLength: 70,
      identification: 0,
      flags: 0,
      fragmentOffset: 0,
      ttl: 64,
      protocol: 17,
      headerChecksum: 0,
      srcIp: srcIntf.ipAddress!,
      dstIp: this.serverIp,
      payload: udpPacket
    }

    const frame: Frame = {
      srcMac: srcIntf.macAddress,
      dstMac: 'FF:FF:FF:FF:FF:FF', // Will be resolved by ARP in real sim; simplified here
      ethertype: 0x0800,
      payload: ipPacket
    }

    // Route the frame out the correct interface via the device's routing table
    const bestIntf = this.findRouteIntf(this.serverIp)
    if (!bestIntf) {
      console.warn(`[DNS Client] ${this.device.hostname}: No route to DNS server ${this.serverIp}`)
      this.pending.delete(txid)
      callback(null)
      return
    }

    frame.srcMac = bestIntf.macAddress
    const resolvedMac = this.device.resolveArp(this.serverIp)
    if (resolvedMac) frame.dstMac = resolvedMac

    this.device.engine?.transmitFrame(this.device.id, bestIntf.connectedPortId!, frame)

    // Timeout after 5 logical seconds
    this.pending.set(txid, {
      hostname,
      callback,
      expiresAt: this.device.engine!.now() + 5000
    })
  }

  public tick() {
    const now = this.device.engine!.now()
    for (const [txid, req] of Array.from(this.pending.entries())) {
      if (now > req.expiresAt) {
        console.warn(`[DNS Client] ${this.device.hostname}: Query timeout for "${req.hostname}"`)
        this.pending.delete(txid)
        req.callback(null)
      }
    }
  }

  public receiveDNS(frame: Frame) {
    const ipPacket = frame.payload as IPv4Packet
    if (!ipPacket || ipPacket.protocol !== 17) return
    const udpPacket = ipPacket.payload as UDPPacket
    if (!udpPacket || udpPacket.dstPort !== 53 && udpPacket.srcPort !== 53) return
    const dnsResp = udpPacket.payload as DNSPacket
    if (!dnsResp || dnsResp.qr !== 1) return

    const pending = this.pending.get(dnsResp.id)
    if (!pending) return

    this.pending.delete(dnsResp.id)

    if (dnsResp.rcode !== 0 || dnsResp.answers.length === 0) {
      console.log(`[DNS Client] ${this.device.hostname}: NXDOMAIN for "${pending.hostname}"`)
      pending.callback(null)
      return
    }

    const answer = dnsResp.answers[0]
    this.cache.set(pending.hostname, { ipAddress: answer.data, ttl: answer.ttl, resolvedAt: this.device.engine!.now() })
    console.log(`[DNS Client] ${this.device.hostname}: Resolved "${pending.hostname}" -> ${answer.data}`)
    pending.callback(answer.data)
  }

  private findRouteIntf(dstIp: string) {
    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.device.routingTable) {
      if (IPMath.isSameSubnet(dstIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
        const maskLong = IPMath.ipToLong(route.mask)
        const prefix = 32 - Math.round(Math.log2(((~maskLong) >>> 0) + 1))
        if (prefix > maxPrefix) {
          maxPrefix = prefix
          bestRoute = route
        }
      }
    }
    if (!bestRoute?.outgoingInterfaceId) return null
    return this.device.getInterface(bestRoute.outgoingInterfaceId) || null
  }
}
