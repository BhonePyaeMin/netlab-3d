import { Router } from './Devices'
import { IPMath } from './IPMath'
import type { DHCPPacket, Frame, IPv4Packet, UDPPacket } from './DataPlane'

export interface DHCPPool {
  name: string
  network: string
  mask: string
  defaultRouter?: string
  dnsServer?: string
}

export interface DHCPBinding {
  macAddress: string
  ipAddress: string
  leaseExpires: number
}

export class DHCPServer {
  public router: Router
  public pools: Map<string, DHCPPool> = new Map()
  public excludedAddresses: string[] = [] // Store individual IPs or ranges, simplified as list of IPs
  public bindings: Map<string, DHCPBinding> = new Map() // Key: MAC

  constructor(router: Router) {
    this.router = router
  }

  public addPool(name: string) {
    if (!this.pools.has(name)) {
      this.pools.set(name, { name, network: '', mask: '' })
    }
  }

  public addExcludedAddressRange(startIp: string, endIp: string = startIp) {
    try {
      const startLong = IPMath.ipToLong(startIp)
      const endLong = IPMath.ipToLong(endIp)
      for (let i = startLong; i <= endLong; i++) {
        this.excludedAddresses.push(IPMath.longToIp(i))
      }
    } catch (e) {
      // Ignore invalid IPs
    }
  }

  private isExcludedOrBound(ip: string): boolean {
    if (this.excludedAddresses.includes(ip)) return true
    for (const binding of this.bindings.values()) {
      if (binding.ipAddress === ip) return true
    }
    return false
  }

  private allocateIp(pool: DHCPPool, mac: string): string | null {
    if (this.bindings.has(mac)) {
      return this.bindings.get(mac)!.ipAddress
    }
    
    // Find next available IP
    try {
      const netLong = IPMath.ipToLong(pool.network)
      const maskLong = IPMath.ipToLong(pool.mask)
      const invMask = (~maskLong) >>> 0
      
      // Skip network address (0) and broadcast (invMask)
      for (let i = 1; i < invMask; i++) {
        const candidateLong = (netLong & maskLong) + i
        const candidate = IPMath.longToIp(candidateLong)
        if (!this.isExcludedOrBound(candidate)) {
          return candidate
        }
      }
    } catch (e) { }

    return null
  }

  public receiveDHCP(frame: Frame, intfId: string) {
    const intf = this.router.getInterface(intfId)
    if (!intf || !intf.ipAddress) return

    const ipPacket = frame.payload as IPv4Packet
    if (!ipPacket || ipPacket.protocol !== 17) return
    const udpPacket = ipPacket.payload as UDPPacket
    if (!udpPacket || udpPacket.dstPort !== 67) return
    const dhcpPacket = udpPacket.payload as DHCPPacket
    if (!dhcpPacket || dhcpPacket.op !== 1) return // Only process BootRequests

    const msgType = dhcpPacket.options.messageType
    const clientMac = dhcpPacket.chaddr

    // Find a pool that matches the receiving interface
    let matchingPool: DHCPPool | null = null
    for (const pool of this.pools.values()) {
      if (pool.network && pool.mask && IPMath.isSameSubnet(intf.ipAddress, pool.network, pool.mask)) {
        matchingPool = pool
        break
      }
    }

    if (!matchingPool) return

    if (msgType === 1) {
      // DHCP Discover -> Send Offer
      const offeredIp = this.allocateIp(matchingPool, clientMac)
      if (!offeredIp) return // Pool exhausted

      this.sendDHCPReply(intfId, clientMac, dhcpPacket.xid, 2, offeredIp, matchingPool)
    } else if (msgType === 3) {
      // DHCP Request -> Send ACK
      const requestedIp = dhcpPacket.options.requestedIpAddress || dhcpPacket.ciaddr
      
      // Basic check if requested IP is the one we would allocate (or if it's already bound to this MAC)
      const expectedIp = this.allocateIp(matchingPool, clientMac)
      if (requestedIp === expectedIp) {
        // Commit binding
        this.bindings.set(clientMac, {
          macAddress: clientMac,
          ipAddress: requestedIp,
          leaseExpires: this.device.engine!.now() + 86400 * 1000 // 1 day
        })
        this.device.log(`%DHCPD-4-ASSIGN: Assigned IP ${requestedIp} to MAC ${clientMac}`)
        this.sendDHCPReply(intfId, clientMac, dhcpPacket.xid, 5, requestedIp, matchingPool)
      }
    }
  }

  private sendDHCPReply(intfId: string, destMac: string, xid: number, msgType: 2 | 5, assignedIp: string, pool: DHCPPool) {
    const intf = this.router.getInterface(intfId)
    if (!intf || !intf.ipAddress) return

    const dhcpReply: DHCPPacket = {
      op: 2, // BootReply
      xid: xid,
      ciaddr: '0.0.0.0',
      yiaddr: assignedIp,
      siaddr: intf.ipAddress,
      chaddr: destMac,
      options: {
        messageType: msgType,
        subnetMask: pool.mask,
        router: pool.defaultRouter,
        dnsServer: pool.dnsServer,
        serverIdentifier: intf.ipAddress,
        ipAddressLeaseTime: 86400
      }
    }

    const udpPacket: UDPPacket = {
      srcPort: 67,
      dstPort: 68,
      length: 300,
      checksum: 0,
      payload: dhcpReply
    }

    const ipPacket: IPv4Packet = {
      version: 4,
      ihl: 5,
      tos: 0,
      totalLength: 320,
      identification: 0,
      flags: 0,
      fragmentOffset: 0,
      ttl: 255,
      protocol: 17, // UDP
      headerChecksum: 0,
      srcIp: intf.ipAddress,
      dstIp: '255.255.255.255',
      payload: udpPacket
    }

    const frame: Frame = {
      srcMac: intf.macAddress,
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0800,
      payload: ipPacket
    }

    if (intf.type === 'subinterface' && intf.encapsulationDot1Q) {
      this.router.engine?.transmitFrame(this.router.id, intf.parentPortId!, {
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        ethertype: 0x8100,
        payload: {
          vlanId: intf.encapsulationDot1Q,
          ethertype: 0x0800,
          payload: frame.payload
        }
      })
    } else {
      this.router.engine?.transmitFrame(this.router.id, intf.connectedPortId!, frame)
    }
  }
}
