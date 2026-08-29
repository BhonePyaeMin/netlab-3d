/**
 * Devices.ts — Concrete implementations of specific device types.
 */
import { NetworkDevice } from './NetworkDevice'
import type { EthernetFrame } from './DataPlane'

import { IPMath } from './IPMath'
import type { IPv4Packet, IPv6Packet, UDPPacket, RIPPacket, DHCPPacket, ICMPPacket, ICMPv6Packet } from './DataPlane'

import { OSPFProcess } from './OSPFProcess'
import { RIPProcess } from './RIPProcess'
import { DHCPServer } from './DHCPServer'
import { DHCPClient } from './DHCPClient'
import { DNSServer } from './DNSServer'
import { DNSClient } from './DNSClient'
import { NATProcess } from './NATProcess'

export class Router extends NetworkDevice {
  public ospfProcess: OSPFProcess | null = null
  public ripProcess: RIPProcess | null = null
  public dhcpServer: DHCPServer | null = null
  public dhcpClients: Map<string, DHCPClient> = new Map() // Key: interfaceId
  public dnsServer: DNSServer | null = null
  public dnsClient: DNSClient = new DNSClient(this as unknown as NetworkDevice)
  public natProcess: NATProcess = new NATProcess(this as unknown as Router)

  constructor(id: string, hostname: string = id) {
    super(id, hostname, 'router')
    this.capabilities = { console: true, cli: true, terminal_type: 'cisco_ios' }
  }

  public override tick(deltaTime: number): void {
    if (this.ospfProcess) {
      this.ospfProcess.tick(deltaTime)
    }
    if (this.ripProcess) {
      this.ripProcess.tick(deltaTime)
    }
    this.natProcess.cleanupTranslations()
    // Check interfaces for DHCP client initialization
    for (const intf of this.interfaces.values()) {
      if (intf.ipAddress === 'dhcp' && intf.operStatus === 'up' && !this.dhcpClients.has(intf.id)) {
        const client = new DHCPClient(this, intf.id)
        this.dhcpClients.set(intf.id, client)
        client.start()
      }
    }
  }

  public override receiveFrame(portId: string, frame: EthernetFrame): void {
    const hop = this.initTraceHop(portId)

    if (frame.ethertype === 0x0806 || (frame.ethertype === 0x8100 && (frame.payload as any).ethertype === 0x0806)) {
      this.arpProcessFrame(portId, frame)
      return
    }

    if (frame.ethertype === 0x86DD || (frame.ethertype === 0x8100 && (frame.payload as any).ethertype === 0x86DD)) {
      const p = (frame.ethertype === 0x86DD) ? frame.payload : (frame.payload as any).payload;
      if (p.nextHeader === 58 && (p.payload.type === 135 || p.payload.type === 136)) {
        this.ndpProcessFrame(portId, frame)
        return
      }
    }
    
    let ipv4: IPv4Packet | null = null
    let ipv6: IPv6Packet | null = null
    let vlanId: number | undefined = undefined

    if (frame.ethertype === 0x0800) {
      ipv4 = frame.payload as IPv4Packet
    } else if (frame.ethertype === 0x86DD) {
      ipv6 = frame.payload as IPv6Packet
    } else if (frame.ethertype === 0x8100) {
      const dot1q = frame.payload as any
      if (dot1q.ethertype === 0x0800) {
        ipv4 = dot1q.payload as IPv4Packet
        vlanId = dot1q.vlanId
      } else if (dot1q.ethertype === 0x86DD) {
        ipv6 = dot1q.payload as IPv6Packet
        vlanId = dot1q.vlanId
      }
    }

    if (ipv4) {
      // Find ingress logical interface
      const ingressIntf = Array.from(this.interfaces.values()).find(i => 
        (i.connectedPortId === portId && i.type === 'physical') ||
        (i.parentPortId === portId && i.encapsulationDot1Q === vlanId)
      )
      
      if (!ingressIntf || ingressIntf.adminStatus === 'down' || ingressIntf.operStatus === 'down') return

      // Intercept OSPF Packets (Protocol 89)
      if (ipv4.protocol === 89 && this.ospfProcess) {
        if (ipv4.dstIp === '224.0.0.5' || ipv4.dstIp === ingressIntf.ipAddress) {
           this.ospfProcess.receiveOSPF(ingressIntf, ipv4.payload as any, ipv4.srcIp)
           return // Don't route local OSPF traffic
        }
      }

      // Intercept UDP Packets (RIP, DHCP)
      if (ipv4.protocol === 17) {
        const udp = ipv4.payload as UDPPacket
        if (udp.dstPort === 520 && this.ripProcess) {
          if (ipv4.dstIp === '224.0.0.9' || ipv4.dstIp === '255.255.255.255' || ipv4.dstIp === ingressIntf.ipAddress) {
            this.ripProcess.receiveRIP(frame, ingressIntf.id)
            return
          }
        }
        if (udp.dstPort === 67 && this.dhcpServer) {
          this.dhcpServer.receiveDHCP(frame, ingressIntf.id)
          return
        }
        if (udp.dstPort === 68) {
          const client = this.dhcpClients.get(ingressIntf.id)
          if (client) {
            client.receiveDHCP(frame)
            return
          }
        }
        if (udp.dstPort === 53 && this.dnsServer?.enabled) {
          this.dnsServer.receiveDNS(frame, ingressIntf.id)
          return
        }
        if (udp.srcPort === 53) {
          this.dnsClient.receiveDNS(frame)
          return
        }
      }

      // NAT Ingress (Outside -> Inside)
      if (ingressIntf.natZone === 'outside') {
        this.natProcess.processIngress(ipv4, ingressIntf)
      }

      // ── Ingress ACL check ──────────────────────────────────────────
      const ingressAclBinding = this.interfaceAcls.get(ingressIntf.id)
      if (ingressAclBinding?.in) {
        const verdict = this.aclEngine.matchPacket(ingressAclBinding.in, ipv4)
        if (verdict === 'deny') {
          hop?.decisions.push(`Ingress ACL ${ingressAclBinding.in} denied packet`)
          this.log(`%ACL-4-DENY: Denied packet from ${ipv4.srcIp} to ${ipv4.dstIp}`)
          return // Packet dropped by ACL
        }
      }

      // Check if it's destined to one of our own interfaces
      const isForUs = Array.from(this.interfaces.values()).some(i => i.ipAddress === ipv4!.dstIp)
      if (isForUs) {
        hop?.decisions.push('Packet destined for this router (consumed)')
        if (hop) hop.action = 'consume'
        // Handle ICMP Echo Request (ping) directed at this router
        if (ipv4.protocol === 1) {
          this.handleIcmpForUs(ipv4, ingressIntf, portId)
        } else if (ipv4.protocol === 17) {
          // UDP
          const udp = ipv4.payload as UDPPacket
          if (udp.dstPort === 67 && (this as any).dhcpServer) {
            // let dhcp server handle
          } else if (udp.dstPort === 53 && (this as any).dnsServer?.enabled) {
            // let dns server handle
          } else {
            this.sendIcmpPortUnreachable(ipv4, ingressIntf.id)
          }
        }
        return
      }

      // Decrement TTL
      if (ipv4.ttl <= 1) {
        hop?.decisions.push('TTL Exceeded (dropped)')
        this.log(`%IP-4-DROP: Packet dropped (TTL expired from ${ipv4.srcIp})`)
        this.sendIcmpTimeExceeded(ipv4, ingressIntf.id)
        return // TTL Exceeded
      }
      ipv4.ttl -= 1
      hop?.decisions.push(`TTL decremented to ${ipv4.ttl}`)

      // Routing Lookup: Longest Prefix Match
      let bestRoute = null
      let maxPrefix = -1

      for (const route of this.routingTable) {
        if (IPMath.isSameSubnet(ipv4.dstIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
          const prefix = IPMath.calculateHosts(route.mask) === 0 ? 32 : 32 - Math.log2(IPMath.calculateHosts(route.mask) + 2)
          if (prefix > maxPrefix) {
            bestRoute = route
            maxPrefix = prefix
          } else if (prefix === maxPrefix && bestRoute) {
            if (route.administrativeDistance < bestRoute.administrativeDistance) {
              bestRoute = route
            } else if (route.administrativeDistance === bestRoute.administrativeDistance && route.metric < bestRoute.metric) {
              bestRoute = route
            }
          }
        }
      }

      if (!bestRoute) {
        hop?.decisions.push('Routing: No route to host (dropped)')
        this.log(`%IP-4-DROP: Packet dropped (No route to host ${ipv4.dstIp})`)
        return // Destination Host Unreachable (Drop)
      }

      hop?.decisions.push(`Routing: matched ${bestRoute.network}/${bestRoute.mask}`)

      let outIntfId = bestRoute.outgoingInterfaceId
      let nextHopIp = bestRoute.nextHop

      // Recursive lookup if we only have nextHop
      if (!outIntfId && nextHopIp) {
        const recursiveRoute = this.routingTable.find(r => r.protocol === 'connected' && IPMath.isSameSubnet(nextHopIp!, r.network, r.mask))
        if (recursiveRoute) {
          outIntfId = recursiveRoute.outgoingInterfaceId
        } else {
          return // Drop
        }
      }

      if (!outIntfId) return // Drop

      const outIntf = this.getInterface(outIntfId)
      if (!outIntf || outIntf.operStatus !== 'up') return // Interface down

      // NAT Egress (Inside -> Outside)
      if (ingressIntf.natZone === 'inside' && outIntf.natZone === 'outside') {
        this.natProcess.processEgress(ipv4, ingressIntf, outIntf)
      }

      // ── Egress ACL check ───────────────────────────────────────────
      const egressAclBinding = this.interfaceAcls.get(outIntfId!)
      if (egressAclBinding?.out) {
        const verdict = this.aclEngine.matchPacket(egressAclBinding.out, ipv4)
        if (verdict === 'deny') {
          hop?.decisions.push(`Egress ACL ${egressAclBinding.out} denied packet`)
          this.log(`%ACL-4-DENY: Denied packet from ${ipv4.srcIp} to ${ipv4.dstIp}`)
          return // Packet dropped by egress ACL
        }
      }

      // Resolve Next-Hop MAC (or Destination MAC if directly connected)
      const targetIp = nextHopIp || ipv4.dstIp
      const targetMac = this.resolveArp(targetIp)
      
      if (!targetMac) {
        hop?.decisions.push(`ARP lookup: MAC not found for ${targetIp} (dropped)`)
        return
      }

      hop?.decisions.push(`ARP lookup: resolved MAC ${targetMac} (forwarding)`)

      // Rebuild and transmit frame
      let newFrame: EthernetFrame = {
        srcMac: outIntf.macAddress,
        dstMac: targetMac,
        ethertype: 0x0800,
        payload: ipv4
      }

      // Encapsulate if exiting a subinterface
      if (outIntf.type === 'subinterface' && outIntf.encapsulationDot1Q) {
        newFrame = {
          srcMac: outIntf.macAddress,
          dstMac: targetMac,
          ethertype: 0x8100,
          payload: {
            vlanId: outIntf.encapsulationDot1Q,
            ethertype: 0x0800,
            payload: ipv4
          }
        }
      }

      const txPortId = outIntf.type === 'subinterface' ? outIntf.parentPortId! : outIntf.connectedPortId!
      if (hop) {
        hop.outgoingPortId = txPortId
        hop.action = 'forward'
      }
      this.engine?.transmitFrame(this.id, txPortId, newFrame)
    }

    if (ipv6) {
      const ingressIntf = Array.from(this.interfaces.values()).find(i => 
        (i.connectedPortId === portId && i.type === 'physical') ||
        (i.parentPortId === portId && i.encapsulationDot1Q === vlanId)
      )
      if (!ingressIntf || ingressIntf.adminStatus === 'down' || ingressIntf.operStatus === 'down') return

      const isForUs = (ingressIntf.ipv6LinkLocal && IPMath.expandIpv6(ingressIntf.ipv6LinkLocal) === IPMath.expandIpv6(ipv6.dstIp)) || 
                      Array.from(this.interfaces.values()).some(i => i.ipv6Addresses.some(a => IPMath.expandIpv6(a.split('/')[0]) === IPMath.expandIpv6(ipv6!.dstIp)))
      
      if (isForUs) {
        if (ipv6.nextHeader === 58) {
          this.handleIcmpv6ForUs(ipv6, ingressIntf, portId)
        }
        return
      }

      if (!this.ipv6UnicastRoutingEnabled) return

      if (ipv6.hopLimit <= 1) {
        this.sendIcmpv6TimeExceeded(ipv6, ingressIntf.id)
        return
      }
      ipv6.hopLimit -= 1

      let bestRoute = null
      let maxPrefix = -1
      for (const route of this.ipv6RoutingTable) {
        if ((route.network === '::' && route.prefixLength === 0) || IPMath.isSameIpv6Subnet(ipv6.dstIp, route.network, route.prefixLength)) {
          if (route.prefixLength > maxPrefix) { bestRoute = route; maxPrefix = route.prefixLength }
          else if (route.prefixLength === maxPrefix && bestRoute && route.administrativeDistance < bestRoute.administrativeDistance) { bestRoute = route }
        }
      }

      if (!bestRoute) return
      let outIntfId = bestRoute.outgoingInterfaceId
      let nextHopIp = bestRoute.nextHop
      if (!outIntfId && nextHopIp) {
        const rec = this.ipv6RoutingTable.find(r => r.protocol === 'connected' && IPMath.isSameIpv6Subnet(nextHopIp!, r.network, r.prefixLength))
        if (rec) outIntfId = rec.outgoingInterfaceId
        else return
      }
      if (!outIntfId) return
      const outIntf = this.getInterface(outIntfId)
      if (!outIntf || outIntf.operStatus !== 'up') return

      const targetIp = nextHopIp || ipv6.dstIp
      const targetMac = this.resolveNdp(targetIp)
      if (!targetMac) return

      let newFrame: EthernetFrame = { srcMac: outIntf.macAddress, dstMac: targetMac, ethertype: 0x86DD, payload: ipv6 }
      if (outIntf.type === 'subinterface' && outIntf.encapsulationDot1Q) {
         newFrame = { srcMac: outIntf.macAddress, dstMac: targetMac, ethertype: 0x8100, payload: { vlanId: outIntf.encapsulationDot1Q, ethertype: 0x86DD, payload: ipv6 } as any }
      }

      const txPortId = outIntf.type === 'subinterface' ? outIntf.parentPortId! : outIntf.connectedPortId!
      this.engine?.transmitFrame(this.id, txPortId, newFrame)
    }
  }


  private handleIcmpv6ForUs(ipv6: IPv6Packet, ingressIntf: any, portId: string): void {
    const icmp = ipv6.payload as ICMPv6Packet
    if (icmp.type !== 128) {
      if (icmp.type === 129 || icmp.type === 3) {
        const cb = this.pingCallbacks.get(icmp.payload?.identifier)
        if (cb) cb(icmp as any, ipv6.srcIp, Date.now(), icmp.payload?.sequenceNumber)
      }
      return
    }

    const replySrcIp = ipv6.dstIp
    const replyIcmp: ICMPv6Packet = {
      type: 129,
      code: 0,
      payload: icmp.payload
    }
    const replyIpv6: IPv6Packet = {
      srcIp: replySrcIp,
      dstIp: ipv6.srcIp,
      nextHeader: 58,
      hopLimit: 64,
      payload: replyIcmp
    }

    const targetMac = this.resolveNdp(ipv6.srcIp)
    if (!targetMac) return

    let replyFrame: EthernetFrame = {
      srcMac: ingressIntf.macAddress,
      dstMac: targetMac,
      ethertype: 0x86DD,
      payload: replyIpv6
    }
    if (ingressIntf.type === 'subinterface' && ingressIntf.encapsulationDot1Q) {
      replyFrame = {
        srcMac: ingressIntf.macAddress,
        dstMac: targetMac,
        ethertype: 0x8100,
        payload: { vlanId: ingressIntf.encapsulationDot1Q, ethertype: 0x86DD, payload: replyIpv6 } as any
      }
    }
    this.engine?.transmitFrame(this.id, portId, replyFrame)
  }
}

export class Layer2Switch extends NetworkDevice {
  constructor(id: string, hostname: string = id, deviceType: DeviceType = 'layer2switch') {
    super(id, hostname, deviceType)
    this.capabilities = { console: true, cli: true, terminal_type: 'cisco_ios' }
  }

  public override receiveFrame(portId: string, frame: EthernetFrame): void {
    const hop = this.initTraceHop(portId)
    const port = this.ports.get(portId)
    // Drop frames on down ports
    if (!port || !port.linkDetected) {
      hop?.decisions.push('Port is down (dropped)')
      return
    }

    // Find the logical interface bound to this port
    const ingressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === portId)
    if (!ingressIntf || ingressIntf.adminStatus === 'down' || ingressIntf.operStatus === 'down') {
      hop?.decisions.push('Interface is admin/oper down (dropped)')
      return
    }

    let vlanId = 1
    let innerFrame: EthernetFrame = { ...frame }

    // 1. Ingress VLAN Determination
    if (ingressIntf.switchportMode === 'access') {
      vlanId = ingressIntf.accessVlan
      // Drop tagged frames on access ports
      if (frame.ethertype === 0x8100) return
    } else if (ingressIntf.switchportMode === 'trunk') {
      if (frame.ethertype === 0x8100) {
        const dot1q = frame.payload as any
        vlanId = dot1q.vlanId
        // Check allowed VLANs
        if (ingressIntf.trunkAllowedVlans !== 'all' && !ingressIntf.trunkAllowedVlans.includes(vlanId)) {
          return // Drop
        }
        // Unwrap the frame for internal processing
        innerFrame.ethertype = dot1q.ethertype
        innerFrame.payload = dot1q.payload
      } else {
        // Untagged frame on trunk belongs to native VLAN
        vlanId = ingressIntf.trunkNativeVlan
      }
    }

    // 1.5 Port Security
    if (ingressIntf.portSecurityEnabled) {
      if (!ingressIntf.portSecurityMacAddresses.includes(innerFrame.srcMac)) {
        if (ingressIntf.portSecurityMacAddresses.length < ingressIntf.portSecurityMax) {
          // Add MAC (dynamic/sticky handled same in simulation data structure)
          ingressIntf.portSecurityMacAddresses.push(innerFrame.srcMac)
        } else {
          // Violation
          const logMsg = `%PORT-SECURITY-2-VIOLATION: Security violation on ${ingressIntf.name}, unauthorized MAC ${innerFrame.srcMac}`
          if (ingressIntf.portSecurityViolation === 'protect') {
            hop?.decisions.push('Port Security violation (dropped silently)')
            this.log(logMsg)
            return // Silently drop
          } else if (ingressIntf.portSecurityViolation === 'restrict') {
            ingressIntf.portSecurityViolationCount++
            hop?.decisions.push('Port Security violation (dropped, count increased)')
            this.log(logMsg)
            return // Drop and count
          } else if (ingressIntf.portSecurityViolation === 'shutdown') {
            ingressIntf.portSecurityViolationCount++
            ingressIntf.operStatus = 'down'
            ingressIntf.adminStatus = 'down' // err-disabled
            hop?.decisions.push('Port Security violation (port err-disabled, dropped)')
            this.log(logMsg)
            return
          }
        }
      }
    }

    // 2. MAC Learning per VLAN
    const macKey = `${vlanId}-${innerFrame.srcMac}`
    this.macTable.set(macKey, {
      macAddress: innerFrame.srcMac,
      portId: portId,
      vlan: vlanId,
      expiresAt: this.engine!.now() + 300000 // 5 minutes
    })

    // 3. Egress Function
    const transmitToPort = (egressPortId: string) => {
      const egressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === egressPortId)
      if (!egressIntf || egressIntf.adminStatus === 'down' || egressIntf.operStatus === 'down') return

      // VLAN Check
      if (egressIntf.switchportMode === 'access' && egressIntf.accessVlan !== vlanId) return

      let outFrame: EthernetFrame = { ...innerFrame }

      if (egressIntf.switchportMode === 'access') {
        // Sent untagged
      } else if (egressIntf.switchportMode === 'trunk') {
        if (egressIntf.trunkAllowedVlans !== 'all' && !egressIntf.trunkAllowedVlans.includes(vlanId)) {
          return // Drop, VLAN not allowed
        }
        
        if (egressIntf.trunkNativeVlan === vlanId) {
          // Send untagged on native VLAN
        } else {
          // Encapsulate with 802.1Q
          outFrame.ethertype = 0x8100
          outFrame.payload = {
            vlanId: vlanId,
            ethertype: innerFrame.ethertype,
            payload: innerFrame.payload
          }
        }
      }

      if (hop) {
        hop.outgoingPortId = egressPortId
        hop.action = 'forward'
      }
      this.engine?.transmitFrame(this.id, egressPortId, outFrame)
    }

    // 4. Known Unicast Forwarding
    const destKey = `${vlanId}-${innerFrame.dstMac}`
    const destEntry = this.macTable.get(destKey)
    if (destEntry) {
      if (destEntry.portId === portId) {
        hop?.decisions.push('MAC lookup: matched source port (dropped)')
        return // Drop if dest is on same port
      }
      hop?.decisions.push(`MAC lookup: matched port ${destEntry.portId} (forwarding)`)
      transmitToPort(destEntry.portId)
      return
    }

    // 5. Unknown Unicast & Broadcast Flooding
    hop?.decisions.push('MAC lookup: unknown/broadcast (flooding)')
    for (const p of this.ports.values()) {
      if (p.id !== portId && p.linkDetected) {
        transmitToPort(p.id)
      }
    }
  }
}

export class Layer3Switch extends Layer2Switch {
  constructor(id: string, hostname: string = id) {
    super(id, hostname, 'layer3switch')
    this.capabilities = { console: true, cli: true, terminal_type: 'cisco_ios' }
  }

  public override receiveFrame(portId: string, frame: EthernetFrame): void {
    // Determine Ingress VLAN
    const ingressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === portId)
    if (!ingressIntf || ingressIntf.adminStatus === 'down' || ingressIntf.operStatus === 'down') return

    let vlanId = 1
    let innerFrame = frame
    
    if (ingressIntf.switchportMode === 'access') {
      vlanId = ingressIntf.accessVlan
      if (frame.ethertype === 0x8100) return // Drop tagged frames on access port
    } else if (ingressIntf.switchportMode === 'trunk') {
      if (frame.ethertype === 0x8100) {
        const dot1q = frame.payload as any
        vlanId = dot1q.vlanId
        if (ingressIntf.trunkAllowedVlans !== 'all' && !ingressIntf.trunkAllowedVlans.includes(vlanId)) return // VLAN not allowed
        innerFrame = { ...frame, ethertype: dot1q.ethertype, payload: dot1q.payload }
      } else {
        vlanId = ingressIntf.trunkNativeVlan
      }
    }

    // Check if there is an SVI for this VLAN
    const svi = Array.from(this.interfaces.values()).find(i => i.type === 'svi' && i.vlanId === vlanId)
    
    // Check if the frame is destined to the SVI's MAC
    if (svi && innerFrame.dstMac === svi.macAddress) {
      if (innerFrame.ethertype === 0x0806) {
        // We pass it to the SVI for ARP processing. But our `arpProcessFrame` expects a portId.
        // For SVI, the portId is not physical. Actually `arpProcessFrame` looks for `connectedPortId === portId`.
        // We need to modify `arpProcessFrame` to also find SVIs based on VLAN...
        // For now, let's just handle SVI ARP here or let super handle it?
        // Wait, ARP to SVI MUST be replied to by the SVI.
        // Let's manually reply to ARP for SVI here to save modifying NetworkDevice too much.
        const arp = innerFrame.payload as any
        if (arp.operation === 'request' && arp.targetIp === svi.ipAddress) {
          this.arpTable.set(arp.senderIp, { ipAddress: arp.senderIp, macAddress: arp.senderMac, interfaceId: svi.id, expiresAt: this.engine!.now() + 14400000 })
          
          let replyFrame: EthernetFrame = {
            srcMac: svi.macAddress,
            dstMac: arp.senderMac,
            ethertype: 0x0806,
            payload: {
              operation: 'reply',
              senderMac: svi.macAddress,
              senderIp: svi.ipAddress,
              targetMac: arp.senderMac,
              targetIp: arp.senderIp
            }
          }
          // The reply needs to go out via Layer 2 switching on this VLAN!
          // We can just call super.receiveFrame recursively acting as if the frame came from nowhere? No, we transmit it directly to the port it came from.
          if (ingressIntf.switchportMode === 'trunk' && ingressIntf.trunkNativeVlan !== vlanId) {
            replyFrame = { srcMac: replyFrame.srcMac, dstMac: replyFrame.dstMac, ethertype: 0x8100, payload: { vlanId, ethertype: 0x0806, payload: replyFrame.payload } }
          }
          this.engine?.transmitFrame(this.id, portId, replyFrame)
        }
        return
      }

      if (innerFrame.ethertype === 0x0800) {
        // Layer 3 Routing
        const ipv4 = innerFrame.payload as IPv4Packet
        if (Array.from(this.interfaces.values()).some(i => i.ipAddress === ipv4.dstIp)) return // For us

        if (ipv4.ttl <= 1) {
          this.sendIcmpTimeExceeded(ipv4, ingressIntf.id)
          return
        }
        ipv4.ttl -= 1

        let bestRoute = null
        let maxPrefix = -1
        for (const route of this.routingTable) {
          if (IPMath.isSameSubnet(ipv4.dstIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
            const prefix = IPMath.calculateHosts(route.mask) === 0 ? 32 : 32 - Math.log2(IPMath.calculateHosts(route.mask) + 2)
            if (prefix > maxPrefix) { bestRoute = route; maxPrefix = prefix }
            else if (prefix === maxPrefix && bestRoute && route.administrativeDistance < bestRoute.administrativeDistance) { bestRoute = route }
          }
        }
        if (!bestRoute) return
        
        let outIntfId = bestRoute.outgoingInterfaceId
        let nextHopIp = bestRoute.nextHop
        if (!outIntfId && nextHopIp) {
          const recRoute = this.routingTable.find(r => r.protocol === 'connected' && IPMath.isSameSubnet(nextHopIp!, r.network, r.mask))
          if (recRoute) outIntfId = recRoute.outgoingInterfaceId
          else return
        }
        if (!outIntfId) return
        
        const outIntf = this.getInterface(outIntfId)
        if (!outIntf || outIntf.operStatus !== 'up') return

        const targetIp = nextHopIp || ipv4.dstIp
        const targetMac = this.resolveArp(targetIp)
        if (!targetMac) return

        const newFrame: EthernetFrame = { srcMac: outIntf.macAddress, dstMac: targetMac, ethertype: 0x0800, payload: ipv4 }

        if (outIntf.type === 'svi') {
          // Route it into the destination VLAN!
          // We can simulate this by putting it through the L2 engine as if it arrived from the SVI.
          // But to avoid recursion, we just inject it into the MAC forwarding table logic.
          const destKey = `${outIntf.vlanId}-${targetMac}`
          const destEntry = this.macTable.get(destKey)
          if (destEntry) {
            const egressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === destEntry.portId)
            if (egressIntf && egressIntf.operStatus === 'up') {
              let finalFrame = newFrame
              if (egressIntf.switchportMode === 'trunk' && egressIntf.trunkNativeVlan !== outIntf.vlanId) {
                finalFrame = { srcMac: newFrame.srcMac, dstMac: newFrame.dstMac, ethertype: 0x8100, payload: { vlanId: outIntf.vlanId, ethertype: 0x0800, payload: newFrame.payload } }
              }
              this.engine?.transmitFrame(this.id, destEntry.portId, finalFrame)
            }
          } else {
            // Flood to VLAN
            for (const p of this.ports.values()) {
              if (p.linkDetected) {
                const egressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === p.id)
                if (egressIntf && egressIntf.operStatus === 'up') {
                  if (egressIntf.switchportMode === 'access' && egressIntf.accessVlan === outIntf.vlanId) {
                    this.engine?.transmitFrame(this.id, p.id, newFrame)
                  } else if (egressIntf.switchportMode === 'trunk' && (egressIntf.trunkAllowedVlans === 'all' || egressIntf.trunkAllowedVlans.includes(outIntf.vlanId!))) {
                    if (egressIntf.trunkNativeVlan === outIntf.vlanId) {
                      this.engine?.transmitFrame(this.id, p.id, newFrame)
                    } else {
                      this.engine?.transmitFrame(this.id, p.id, { srcMac: newFrame.srcMac, dstMac: newFrame.dstMac, ethertype: 0x8100, payload: { vlanId: outIntf.vlanId, ethertype: 0x0800, payload: newFrame.payload } })
                    }
                  }
                }
              }
            }
          }
        }
        return // Finished Layer 3 routing
      }
    }

    // Otherwise, standard Layer 2 Switching
    super.receiveFrame(portId, frame)
  }
}

export class PC extends NetworkDevice {
  public dhcpClient: DHCPClient | null = null
  public dnsClient: DNSClient = new DNSClient(this as unknown as NetworkDevice)

  constructor(id: string, hostname: string = id) {
    super(id, hostname, 'pc')
    this.capabilities = { console: true, cli: true, terminal_type: 'vpcs' }
  }

  public override generateRunningConfig(): string {
    const lines: string[] = []
    
    // PC (VPCS) config
    // E.g.: ip 192.168.1.10 255.255.255.0 192.168.1.1
    const intf = Array.from(this.interfaces.values())[0]
    if (intf && intf.ipAddress) {
      if (intf.ipAddress === 'dhcp') {
        lines.push('ip dhcp')
      } else {
        let ipCmd = `ip ${intf.ipAddress} ${intf.subnetMask}`
        if (this.defaultGateway) ipCmd += ` ${this.defaultGateway}`
        lines.push(ipCmd)
      }
    }

    // PCs might also have DNS server configured via ip dns
    if (this.dnsClient?.serverIp) {
      lines.push(`ip dns ${this.dnsClient.serverIp}`)
    }

    return lines.join('\n')
  }

  public override tick(deltaTime: number): void {
    super.tick(deltaTime)
    this.dnsClient.tick()
    // If no static IP configured, and interface is up, try DHCP
    const intf = Array.from(this.interfaces.values())[0] // PCs usually have 1 interface
    if (intf && intf.operStatus === 'up' && (!intf.ipAddress || intf.ipAddress === 'dhcp') && !this.dhcpClient) {
      intf.ipAddress = 'dhcp' // mark it
      this.dhcpClient = new DHCPClient(this, intf.id)
      this.dhcpClient.start()
    }
  }

  public override receiveFrame(portId: string, frame: EthernetFrame): void {
    if (frame.ethertype === 0x0806) {
      this.arpProcessFrame(portId, frame)
    } else if (frame.ethertype === 0x0800) {
      const ipv4 = frame.payload as IPv4Packet
      // Only process packets addressed to us
      const isForUs = Array.from(this.interfaces.values()).some(i => i.ipAddress === ipv4.dstIp)
      if (!isForUs) return

      if (ipv4.protocol === 1) {
        // ICMP
        const icmp = ipv4.payload as ICMPPacket
        if (icmp.type === 8) {
          // Echo Request → reply
          const ingressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === portId)
          if (ingressIntf && ingressIntf.ipAddress) {
            this.handleIcmpForUs(ipv4, ingressIntf, portId)
          }
        } else if (icmp.type === 0 || icmp.type === 11 || icmp.type === 3) {
          // Echo Reply, Time Exceeded, Destination Unreachable → fire ping callback
          const cb = this.pingCallbacks.get(icmp.identifier)
          if (cb) cb(icmp, ipv4.srcIp, this.engine!.now(), icmp.sequenceNumber)
        }
      } else if (ipv4.protocol === 17) {
        const udp = ipv4.payload as UDPPacket
        if (udp.dstPort === 68 && this.dhcpClient) {
          this.dhcpClient.receiveDHCP(frame)
          return
        }
        if (udp.srcPort === 53 || udp.dstPort === 53) {
          this.dnsClient.receiveDNS(frame)
          return
        }
        if (ingressIntf) {
          this.sendIcmpPortUnreachable(ipv4, ingressIntf.id)
        }
      }
    } else if (frame.ethertype === 0x86DD) {
      const ipv6 = frame.payload as IPv6Packet
      if (ipv6.nextHeader === 58) {
        const icmp = ipv6.payload as ICMPv6Packet
        if (icmp.type === 135 || icmp.type === 136) {
           this.ndpProcessFrame(portId, frame)
           return
        }
        const ingressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === portId)
        if (!ingressIntf) return
        
        const isForUs = (ingressIntf.ipv6LinkLocal && IPMath.expandIpv6(ingressIntf.ipv6LinkLocal) === IPMath.expandIpv6(ipv6.dstIp)) || 
                        ingressIntf.ipv6Addresses.some(a => IPMath.expandIpv6(a.split('/')[0]) === IPMath.expandIpv6(ipv6.dstIp))
        if (!isForUs) return

        if (icmp.type === 128) {
           const replyIcmp: ICMPv6Packet = { type: 129, code: 0, payload: icmp.payload }
           const replyIpv6: IPv6Packet = { srcIp: ipv6.dstIp, dstIp: ipv6.srcIp, nextHeader: 58, hopLimit: 64, payload: replyIcmp }
           const targetMac = this.resolveNdp(ipv6.srcIp)
           if (targetMac) {
             this.engine?.transmitFrame(this.id, portId, { srcMac: ingressIntf.macAddress, dstMac: targetMac, ethertype: 0x86DD, payload: replyIpv6 })
           }
        } else if (icmp.type === 129 || icmp.type === 3) {
           const cb = this.pingCallbacks.get(icmp.payload?.identifier)
           if (cb) cb(icmp as any, ipv6.srcIp, this.engine!.now(), icmp.payload?.sequenceNumber)
        }
      }
    }
  }
}

export class Server extends NetworkDevice {
  public dnsServer: DNSServer | null = null
  public dnsClient: DNSClient = new DNSClient(this as unknown as NetworkDevice)

  constructor(id: string, hostname: string = id) {
    super(id, hostname, 'server')
    this.capabilities = { console: true, cli: true, terminal_type: 'linux' }
  }

  public override tick(deltaTime: number): void {
    super.tick(deltaTime)
    this.dnsClient.tick()
  }

  public override receiveFrame(portId: string, frame: EthernetFrame): void {
    if (frame.ethertype === 0x0806) {
      this.arpProcessFrame(portId, frame)
      return
    }
    if (frame.ethertype === 0x0800) {
      const ipv4 = frame.payload as IPv4Packet
      const isForUs = Array.from(this.interfaces.values()).some(i => i.ipAddress === ipv4.dstIp)
      if (!isForUs) return

      if (ipv4.protocol === 1) {
        const icmp = ipv4.payload as ICMPPacket
        if (icmp.type === 8) {
          const ingressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === portId)
          if (!ingressIntf?.ipAddress) return
          const ingressBinding = this.interfaceAcls.get(ingressIntf.id)
          if (ingressBinding?.in && this.aclEngine.matchPacket(ingressBinding.in, ipv4) === 'deny') return
          const replyIcmp: ICMPPacket = { type: 0, code: 0, identifier: icmp.identifier, sequenceNumber: icmp.sequenceNumber, payload: icmp.payload }
          const replyIpv4: IPv4Packet = { srcIp: ingressIntf.ipAddress, dstIp: ipv4.srcIp, protocol: 1, ttl: 64, payload: replyIcmp }
          const targetMac = this.resolveArp(ipv4.srcIp)
          if (!targetMac) return
          this.engine?.transmitFrame(this.id, portId, { srcMac: ingressIntf.macAddress, dstMac: targetMac, ethertype: 0x0800, payload: replyIpv4 })
        } else if (icmp.type === 0 || icmp.type === 11) {
          const cb = this.pingCallbacks.get(icmp.identifier)
          if (cb) cb(icmp, ipv4.srcIp, this.engine!.now(), icmp.sequenceNumber)
        }
        return
      }

      if (ipv4 && ipv4.protocol === 17) {
        const udp = ipv4.payload as UDPPacket
        // Find ingress interface
        const ingressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === portId)
        if (ingressIntf) {
          if (udp.dstPort === 53 && this.dnsServer?.enabled) {
            this.dnsServer.receiveDNS(frame, ingressIntf.id)
            return
          }
          if (udp.srcPort === 53) {
            this.dnsClient.receiveDNS(frame)
            return
          }
        }
      }
    } else if (frame.ethertype === 0x86DD) {
      const ipv6 = frame.payload as IPv6Packet
      if (ipv6.nextHeader === 58) {
        const icmp = ipv6.payload as ICMPv6Packet
        if (icmp.type === 135 || icmp.type === 136) {
           this.ndpProcessFrame(portId, frame)
           return
        }
        const ingressIntf = Array.from(this.interfaces.values()).find(i => i.connectedPortId === portId)
        if (!ingressIntf) return
        
        const isForUs = (ingressIntf.ipv6LinkLocal && IPMath.expandIpv6(ingressIntf.ipv6LinkLocal) === IPMath.expandIpv6(ipv6.dstIp)) || 
                        ingressIntf.ipv6Addresses.some(a => IPMath.expandIpv6(a.split('/')[0]) === IPMath.expandIpv6(ipv6.dstIp))
        if (!isForUs) return

        if (icmp.type === 128) {
           const replyIcmp: ICMPv6Packet = { type: 129, code: 0, payload: icmp.payload }
           const replyIpv6: IPv6Packet = { srcIp: ipv6.dstIp, dstIp: ipv6.srcIp, nextHeader: 58, hopLimit: 64, payload: replyIcmp }
           const targetMac = this.resolveNdp(ipv6.srcIp)
           if (targetMac) {
             this.engine?.transmitFrame(this.id, portId, { srcMac: ingressIntf.macAddress, dstMac: targetMac, ethertype: 0x86DD, payload: replyIpv6 })
           }
        } else if (icmp.type === 129 || icmp.type === 3) {
           const cb = this.pingCallbacks.get(icmp.payload?.identifier)
           if (cb) cb(icmp as any, ipv6.srcIp, this.engine!.now(), icmp.payload?.sequenceNumber)
        }
      }
    }
  }
}

export class Firewall extends Router {
  constructor(id: string, hostname: string = id) {
    super(id, hostname)
    Object.defineProperty(this, 'deviceType', { value: 'firewall', writable: false })
    this.capabilities = { console: true, cli: true, terminal_type: 'cisco_ios' }
  }
}

export class KaliMachine extends PC {
  constructor(id: string, hostname: string = id) {
    super(id, hostname)
    this.capabilities = { console: true, cli: true, terminal_type: 'linux' }
  }
}

export class WindowsServer extends Server {
  constructor(id: string, hostname: string = id) {
    super(id, hostname)
    this.capabilities = { console: true, cli: true, terminal_type: 'windows' }
  }
}

export class Hub extends NetworkDevice {
  constructor(id: string, hostname: string = id) {
    super(id, hostname, 'hub')
  }
}

export class Cloud extends Layer2Switch {
  constructor(id: string, hostname: string = id) {
    super(id, hostname)
    Object.defineProperty(this, 'deviceType', { value: 'cloud', writable: false })
  }
}

export class GenericDevice extends NetworkDevice {
  constructor(id: string, hostname: string = id) {
    super(id, hostname, 'generic')
  }
}
