/**
 * NetworkDevice.ts — Base class for all simulated network devices.
 *
 * Maintains its own configuration, interfaces, physical ports, tables, and logs.
 */
import type { DeviceType, DeviceStatus, DeviceCapabilities } from './DeviceTypes'
import type { PhysicalPort }             from './PhysicalPort'
import type { NetworkInterface }         from './NetworkInterface'
import { CLISession }                    from './CLIEngine'
import { IPMath }                        from './IPMath'
import { ACLEngine }                     from './ACLEngine'

import type { EthernetFrame, ICMPPacket } from './DataPlane'
import type { INetworkEngine }            from './INetworkEngine'

export interface RouteEntry {
  network: string
  mask: string
  nextHop: string | null
  outgoingInterfaceId: string | null
  metric: number
  administrativeDistance: number
  protocol: 'connected' | 'static' | 'ospf' | 'rip'
}

export interface Ipv6RouteEntry {
  network: string
  prefixLength: number
  nextHop: string | null
  outgoingInterfaceId: string | null
  metric: number
  administrativeDistance: number
  protocol: 'connected' | 'static' | 'ospf' | 'rip'
}

export interface ArpEntry {
  ipAddress: string
  macAddress: string
  interfaceId: string
  expiresAt: number
}

export interface MacTableEntry {
  macAddress: string
  portId: string
  vlan: number
  expiresAt: number
}

export interface NdpEntry {
  ipv6Address: string
  macAddress: string
  interfaceId: string
  expiresAt: number
}

export abstract class NetworkDevice {
  public readonly id: string
  public hostname: string
  public readonly deviceType: DeviceType
  public status: DeviceStatus
  
  public capabilities: DeviceCapabilities = { console: false, cli: false, terminal_type: 'none' }
  public gns3NodeId: string | null = null
  public gns3ProjectId: string | null = null

  public bootTimer: number = 0
  public stopTimer: number = 0
  private isRestarting: boolean = false

  public ports: Map<string, PhysicalPort> = new Map()
  public interfaces: Map<string, NetworkInterface> = new Map()

  // 3D/Simulation coordinate position
  public position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }

  public engine?: INetworkEngine
  public cliSession: CLISession


  public startupConfig: string = ''

  public routingTable: RouteEntry[] = []
  public staticRoutes: RouteEntry[] = [] // User-configured static routes
  public ipv6RoutingTable: Ipv6RouteEntry[] = []
  public staticIpv6Routes: Ipv6RouteEntry[] = []
  public ipv6UnicastRoutingEnabled: boolean = false
  public arpTable: Map<string, ArpEntry> = new Map()
  public ndpTable: Map<string, NdpEntry> = new Map()
  public macTable: Map<string, MacTableEntry> = new Map()

  // Discovery protocols
  public cdpEnabled: boolean = true
  public lldpEnabled: boolean = true

  /** Default gateway (used by PCs/hosts for off-subnet routing) */
  public defaultGateway: string | null = null

  public vlanDatabase: Map<number, { id: number, name: string }> = new Map([[1, { id: 1, name: 'default' }]])

  /** ACL engine — stores all access-lists for this device */
  public aclEngine: ACLEngine = new ACLEngine()

  /** Maps interfaceId → { in?: aclId, out?: aclId } */
  public interfaceAcls: Map<string, { in?: string; out?: string }> = new Map()

  /**
   * Ping reply callbacks: identifier → callback
   * When device receives an ICMP Echo Reply matching identifier, it calls the callback.
   */
  public pingCallbacks: Map<number, (icmp: ICMPPacket, srcIp: string, rtt: number, sent: number) => void> = new Map()

  public logs: string[] = []

  constructor(id: string, hostname: string, deviceType: DeviceType) {
    this.id = id
    this.hostname = hostname
    this.deviceType = deviceType
    this.status = 'RUNNING'
    this.cliSession = new CLISession(this)
  }

  public log(message: string) {
    const timestamp = new Date().toISOString()
    const logStr = `[${timestamp}] ${message}`
    this.logs.push(logStr)
    // Keep last 1000 logs
    if (this.logs.length > 1000) {
      this.logs.shift()
    }
    
    // Global log
    if (this.engine) {
      this.engine.globalLogs.unshift({
        id: `log-${Date.now()}-${Math.random()}`,
        time: this.engine.currentTime,
        deviceId: this.id,
        message
      })
      if (this.engine.globalLogs.length > 5000) {
        this.engine.globalLogs.pop()
      }
    }
  }

  // --- Power Lifecycle ---

  public start() {
    if (this.status !== 'OFF' && this.status !== 'STOPPING') return
    this.status = 'STARTING'
    this.bootTimer = 3000 // 3 seconds simulated boot
    this.log(`%SYS-5-START: System started`)
  }

  public stop() {
    if (this.status === 'OFF' || this.status === 'STOPPING') return
    this.status = 'STOPPING'
    this.stopTimer = 1000 // 1 second simulated shutdown
    this.log(`%SYS-5-STOP: System stopped`)
    this.flushState()
  }

  public restart() {
    if (this.status === 'OFF') {
      this.start()
    } else {
      this.stop()
      this.isRestarting = true
    }
  }

  public reset() {
    this.status = 'OFF'
    this.flushState()
    this.start()
  }

  private flushState() {
    // Force interfaces down
    for (const intf of this.interfaces.values()) {
      intf.operStatus = 'down'
    }
    this.arpTable.clear()
    this.macTable.clear()
    this.ndpTable.clear()
    this.routingTable = this.staticRoutes.slice()
    this.updateConnectedRoutes()
    this.pingCallbacks.clear()
    if ((this as any).ospfProcess) (this as any).ospfProcess.neighbors.clear()
    if ((this as any).natProcess) (this as any).natProcess.translations.clear()
    if ((this as any).dhcpClient) (this as any).dhcpClient = null
    if ((this as any).dhcpServer) (this as any).dhcpServer.bindings.clear()
  }

  public getPort(portId: string): PhysicalPort | undefined {
    return this.ports.get(portId)
  }

  public getInterface(interfaceId: string): NetworkInterface | undefined {
    return this.interfaces.get(interfaceId)
  }

  public addPort(port: PhysicalPort) {
    this.ports.set(port.id, port)
  }

  public addInterface(intf: NetworkInterface) {
    this.interfaces.set(intf.id, intf)
  }

  // --- GNS3 Node Getters ---
  
  public getConsolePort(): PhysicalPort | undefined {
    return Array.from(this.ports.values()).find(p => p.portType === 'console')
  }

  public getEthernetPorts(): PhysicalPort[] {
    return Array.from(this.ports.values()).filter(p => 
      p.portType === 'ethernet' && (p.name.includes('Ethernet') || p.name.includes('Eth') || p.name.includes('e')) && !p.name.includes('Gigabit')
    )
  }

  public getGigabitEthernetPorts(): PhysicalPort[] {
    return Array.from(this.ports.values()).filter(p => 
      p.portType === 'ethernet' && (p.name.includes('Gigabit') || p.name.includes('G'))
    )
  }

  public getSerialPorts(): PhysicalPort[] {
    return Array.from(this.ports.values()).filter(p => p.portType === 'serial')
  }

  public getMacAddresses(): string[] {
    return Array.from(this.interfaces.values())
      .map(i => i.macAddress)
      .filter((mac, index, self) => self.indexOf(mac) === index)
  }

  // Subclasses must implement how they process an incoming frame (later stages)
  public receiveFrame(portId: string, frame: EthernetFrame): void {
    // Default implementation drops the frame.
  }

  protected initTraceHop(portId?: string): import('../types').PacketTraceHop | null {
    if (this.engine?.activeTrace) {
      const hop: import('../types').PacketTraceHop = {
        deviceId: this.id,
        incomingPortId: portId,
        decisions: [],
        action: 'drop' // Defaults to drop, should be updated to 'forward' or 'consume' if successful
      }
      this.engine.activeTrace.hops.push(hop)
      return hop
    }
    return null
  }

  public updateConnectedRoutes(): void {
    // Remove old connected and static routes
    this.routingTable = this.routingTable.filter(r => r.protocol !== 'connected' && r.protocol !== 'static')

    // Add connected routes for up interfaces with IPs
    for (const intf of this.interfaces.values()) {
      if (intf.adminStatus === 'up' && intf.operStatus === 'up' && intf.ipAddress && intf.subnetMask) {
        const netAddr = IPMath.getNetworkAddress(intf.ipAddress, intf.subnetMask)
        this.routingTable.push({
          network: netAddr,
          mask: intf.subnetMask,
          nextHop: null,
          outgoingInterfaceId: intf.id,
          metric: 0,
          administrativeDistance: 0,
          protocol: 'connected'
        })
      }
    }

    // Evaluate static routes
    for (const route of this.staticRoutes) {
      if (route.outgoingInterfaceId) {
        // Exit interface specified. Check if it's up.
        const intf = this.getInterface(route.outgoingInterfaceId)
        if (intf && intf.operStatus === 'up') {
          this.routingTable.push({ ...route })
        }
      } else if (route.nextHop) {
        // Next-hop specified. Check if we have a connected route to reach it.
        const isReachable = this.routingTable.find(r => 
          r.protocol === 'connected' && IPMath.isSameSubnet(r.network, route.nextHop!, r.mask)
        )
        if (isReachable) {
          this.routingTable.push({ ...route })
        }
      }
    }
    this.updateConnectedIpv6Routes()
  }

  public updateConnectedIpv6Routes(): void {
    this.ipv6RoutingTable = this.ipv6RoutingTable.filter(r => r.protocol !== 'connected' && r.protocol !== 'static')

    for (const intf of this.interfaces.values()) {
      if (intf.adminStatus === 'up' && intf.operStatus === 'up') {
        if (intf.ipv6LinkLocal) {
          this.ipv6RoutingTable.push({
            network: 'fe80::',
            prefixLength: 10,
            nextHop: null,
            outgoingInterfaceId: intf.id,
            metric: 0,
            administrativeDistance: 0,
            protocol: 'connected'
          })
        }
        for (const addrStr of intf.ipv6Addresses) {
          const [ip, prefix] = addrStr.split('/')
          const prefNum = parseInt(prefix, 10)
          this.ipv6RoutingTable.push({
            network: ip,
            prefixLength: prefNum,
            nextHop: null,
            outgoingInterfaceId: intf.id,
            metric: 0,
            administrativeDistance: 0,
            protocol: 'connected'
          })
        }
      }
    }

    for (const route of this.staticIpv6Routes) {
      if (route.outgoingInterfaceId) {
        const intf = this.getInterface(route.outgoingInterfaceId)
        if (intf && intf.operStatus === 'up') {
          this.ipv6RoutingTable.push({ ...route })
        }
      } else if (route.nextHop) {
        const isReachable = this.ipv6RoutingTable.find(r => 
          r.protocol === 'connected' && IPMath.isSameIpv6Subnet(r.network, route.nextHop!, r.prefixLength)
        )
        if (isReachable) {
          this.ipv6RoutingTable.push({ ...route })
        }
      }
    }
  }

  public arpProcessFrame(portId: string, frame: EthernetFrame): void {
    let arp = frame.payload as any
    let vlanId: number | undefined = undefined
    
    if (frame.ethertype === 0x8100) {
      const dot1q = frame.payload as any
      if (dot1q.ethertype !== 0x0806) return
      arp = dot1q.payload
      vlanId = dot1q.vlanId
    } else if (frame.ethertype !== 0x0806) {
      return
    }

    let intf = Array.from(this.interfaces.values()).find(i => 
      (i.connectedPortId === portId && i.type === 'physical') ||
      (i.parentPortId === portId && i.encapsulationDot1Q === vlanId)
    )
    
    if (!intf || intf.adminStatus === 'down' || intf.operStatus === 'down') return

    if (arp.senderIp && arp.senderMac) {
      this.arpTable.set(arp.senderIp, {
        ipAddress: arp.senderIp,
        macAddress: arp.senderMac,
        interfaceId: intf.id,
        expiresAt: this.engine!.now() + 14400000 // 4 hours
      })
      this.log(`%ARP-5-ENTRY: Added ARP entry for ${arp.senderIp} -> ${arp.senderMac}`)
    }

    if (arp.operation === 'request' && arp.targetIp === intf.ipAddress) {
      let replyFrame: EthernetFrame = {
        srcMac: intf.macAddress,
        dstMac: arp.senderMac,
        ethertype: 0x0806,
        payload: {
          operation: 'reply',
          senderMac: intf.macAddress,
          senderIp: intf.ipAddress,
          targetMac: arp.senderMac,
          targetIp: arp.senderIp
        }
      }
      
      if (intf.type === 'subinterface' && intf.encapsulationDot1Q) {
        replyFrame = {
          srcMac: replyFrame.srcMac,
          dstMac: replyFrame.dstMac,
          ethertype: 0x8100,
          payload: {
            vlanId: intf.encapsulationDot1Q,
            ethertype: 0x0806,
            payload: replyFrame.payload
          }
        }
      }
      
      this.engine?.transmitFrame(this.id, portId, replyFrame)
    }
  }

  public ndpProcessFrame(portId: string, frame: EthernetFrame): void {
    let ipv6 = frame.payload as any
    let vlanId: number | undefined = undefined

    if (frame.ethertype === 0x8100) {
      const dot1q = frame.payload as any
      if (dot1q.ethertype !== 0x86DD) return
      ipv6 = dot1q.payload
      vlanId = dot1q.vlanId
    } else if (frame.ethertype !== 0x86DD) {
      return
    }

    if (ipv6.nextHeader !== 58) return
    const icmpv6 = ipv6.payload as any
    if (icmpv6.type !== 135 && icmpv6.type !== 136) return

    const intf = Array.from(this.interfaces.values()).find(i => 
      (i.connectedPortId === portId && i.type === 'physical') ||
      (i.parentPortId === portId && i.encapsulationDot1Q === vlanId)
    )

    if (!intf || intf.adminStatus === 'down' || intf.operStatus === 'down') return

    const ndp = icmpv6.payload

    if (ipv6.srcIp && frame.srcMac && ipv6.srcIp !== '::') {
      this.ndpTable.set(ipv6.srcIp, {
        ipv6Address: ipv6.srcIp,
        macAddress: frame.srcMac,
        interfaceId: intf.id,
        expiresAt: this.engine!.now() + 14400000
      })
    }

    if (icmpv6.type === 135 && ndp.targetAddress) {
      const isForUs = intf.ipv6LinkLocal === ndp.targetAddress || intf.ipv6Addresses.some(a => IPMath.expandIpv6(a.split('/')[0]) === IPMath.expandIpv6(ndp.targetAddress))
      if (isForUs) {
        const replyIpv6 = {
          srcIp: ndp.targetAddress,
          dstIp: ipv6.srcIp,
          nextHeader: 58,
          hopLimit: 255,
          payload: {
            type: 136,
            code: 0,
            payload: {
              targetAddress: ndp.targetAddress,
              targetMac: intf.macAddress
            }
          }
        }

        let replyFrame: EthernetFrame = {
          srcMac: intf.macAddress,
          dstMac: frame.srcMac,
          ethertype: 0x86DD,
          payload: replyIpv6
        }

        if (intf.type === 'subinterface' && intf.encapsulationDot1Q) {
          replyFrame = {
            srcMac: replyFrame.srcMac,
            dstMac: replyFrame.dstMac,
            ethertype: 0x8100,
            payload: {
              vlanId: intf.encapsulationDot1Q,
              ethertype: 0x86DD,
              payload: replyIpv6
            } as any
          }
        }
        this.engine?.transmitFrame(this.id, portId, replyFrame)
      }
    }
  }

  public resolveArp(ip: string): string | null {
    const entry = this.arpTable.get(ip)
    if (entry) {
      if (this.engine!.now() > entry.expiresAt) {
        this.arpTable.delete(ip)
        return null
      }
      return entry.macAddress
    }
    return null
  }

  public resolveNdp(ipv6: string): string | null {
    const entry = this.ndpTable.get(ipv6)
    if (entry) {
      if (Date.now() > entry.expiresAt) {
        this.ndpTable.delete(ipv6)
        return null
      }
      return entry.macAddress
    }
    return null
  }

  public sendIcmpTimeExceeded(droppedIpv4: IPv4Packet, ingressIntfId: string): void {
    if (droppedIpv4.protocol !== 1) return
    const ingressIntf = this.getInterface(ingressIntfId)
    if (!ingressIntf || !ingressIntf.ipAddress) return

    const origIcmp = droppedIpv4.payload as ICMPPacket
    const replyIcmp: ICMPPacket = {
      type: 11, // Time Exceeded
      code: 0,
      identifier: origIcmp.identifier,
      sequenceNumber: origIcmp.sequenceNumber,
      payload: origIcmp.payload
    }

    const replyIpv4: IPv4Packet = {
      srcIp: ingressIntf.ipAddress,
      dstIp: droppedIpv4.srcIp,
      protocol: 1,
      ttl: 255,
      payload: replyIcmp
    }

    // Routing Lookup for the reply
    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.routingTable) {
      if (IPMath.isSameSubnet(replyIpv4.dstIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
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

    const targetIp = nextHopIp || replyIpv4.dstIp
    const targetMac = this.resolveArp(targetIp)
    if (!targetMac) return

    let txFrame: EthernetFrame = {
      srcMac: outIntf.macAddress,
      dstMac: targetMac,
      ethertype: 0x0800,
      payload: replyIpv4
    }

    if (outIntf.type === 'subinterface' && outIntf.encapsulationDot1Q) {
      txFrame = {
        srcMac: outIntf.macAddress,
        dstMac: targetMac,
        ethertype: 0x8100,
        payload: {
          vlanId: outIntf.encapsulationDot1Q,
          ethertype: 0x0800,
          payload: replyIpv4
        }
      }
    }

    const txPortId = outIntf.type === 'subinterface' ? outIntf.parentPortId! : outIntf.connectedPortId!
    this.engine?.transmitFrame(this.id, txPortId, txFrame)
  }

  public sendIcmpPortUnreachable(droppedIpv4: IPv4Packet, ingressIntfId: string): void {
    const ingressIntf = this.getInterface(ingressIntfId)
    if (!ingressIntf || !ingressIntf.ipAddress) return

    const replyIcmp: ICMPPacket = {
      type: 3, // Destination Unreachable
      code: 3, // Port Unreachable
      identifier: 0,
      sequenceNumber: 0,
      payload: droppedIpv4
    }

    const replyIpv4: IPv4Packet = {
      srcIp: ingressIntf.ipAddress,
      dstIp: droppedIpv4.srcIp,
      protocol: 1,
      ttl: 255,
      payload: replyIcmp
    }

    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.routingTable) {
      if (IPMath.isSameSubnet(replyIpv4.dstIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
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

    const targetIp = nextHopIp || replyIpv4.dstIp
    const targetMac = this.resolveArp(targetIp)
    if (!targetMac) return

    let txFrame: EthernetFrame = {
      srcMac: outIntf.macAddress,
      dstMac: targetMac,
      ethertype: 0x0800,
      payload: replyIpv4
    }

    if (outIntf.type === 'subinterface' && outIntf.encapsulationDot1Q) {
      txFrame = {
        srcMac: outIntf.macAddress,
        dstMac: targetMac,
        ethertype: 0x8100,
        payload: { vlanId: outIntf.encapsulationDot1Q, ethertype: 0x0800, payload: replyIpv4 }
      }
    }

    const txPortId = outIntf.type === 'subinterface' ? outIntf.parentPortId! : outIntf.connectedPortId!
    this.engine?.transmitFrame(this.id, txPortId, txFrame)
  }

  public sendIcmpv6TimeExceeded(droppedIpv6: IPv6Packet, ingressIntfId: string): void {
    if (droppedIpv6.nextHeader === 58) {
       const origIcmp = droppedIpv6.payload as ICMPv6Packet
       if (origIcmp.type < 128) return
    }
    const ingressIntf = this.getInterface(ingressIntfId)
    if (!ingressIntf || (!ingressIntf.ipv6Addresses.length && !ingressIntf.ipv6LinkLocal)) return

    const srcIp = ingressIntf.ipv6Addresses.length > 0 ? ingressIntf.ipv6Addresses[0].split('/')[0] : ingressIntf.ipv6LinkLocal!

    const replyIcmp: ICMPv6Packet = {
      type: 3, // Time Exceeded
      code: 0,
      payload: droppedIpv6
    }

    const replyIpv6: IPv6Packet = {
      srcIp: srcIp,
      dstIp: droppedIpv6.srcIp,
      nextHeader: 58,
      hopLimit: 255,
      payload: replyIcmp
    }

    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.ipv6RoutingTable) {
      if ((route.network === '::' && route.prefixLength === 0) || IPMath.isSameIpv6Subnet(replyIpv6.dstIp, route.network, route.prefixLength)) {
        if (route.prefixLength > maxPrefix) { bestRoute = route; maxPrefix = route.prefixLength }
        else if (route.prefixLength === maxPrefix && bestRoute && route.administrativeDistance < bestRoute.administrativeDistance) { bestRoute = route }
      }
    }
    
    if (!bestRoute) return
    let outIntfId = bestRoute.outgoingInterfaceId
    let nextHopIp = bestRoute.nextHop
    if (!outIntfId && nextHopIp) {
      const recRoute = this.ipv6RoutingTable.find(r => r.protocol === 'connected' && IPMath.isSameIpv6Subnet(nextHopIp!, r.network, r.prefixLength))
      if (recRoute) outIntfId = recRoute.outgoingInterfaceId
      else return
    }
    if (!outIntfId) return
    const outIntf = this.getInterface(outIntfId)
    if (!outIntf || outIntf.operStatus !== 'up') return

    const targetIp = nextHopIp || replyIpv6.dstIp
    const targetMac = this.resolveNdp(targetIp)
    if (!targetMac) return

    let txFrame: EthernetFrame = { srcMac: outIntf.macAddress, dstMac: targetMac, ethertype: 0x86DD, payload: replyIpv6 }
    if (outIntf.type === 'subinterface' && outIntf.encapsulationDot1Q) {
      txFrame = { srcMac: outIntf.macAddress, dstMac: targetMac, ethertype: 0x8100, payload: { vlanId: outIntf.encapsulationDot1Q, ethertype: 0x86DD, payload: replyIpv6 } as any }
    }

    const txPortId = outIntf.type === 'subinterface' ? outIntf.parentPortId! : outIntf.connectedPortId!
    this.engine?.transmitFrame(this.id, txPortId, txFrame)
  }

  public tick(deltaTime: number): void {
    if (this.status === 'STOPPING') {
      this.stopTimer -= deltaTime
      if (this.stopTimer <= 0) {
        this.status = 'OFF'
        if (this.isRestarting) {
          this.isRestarting = false
          this.start()
        }
      }
      return
    }

    if (this.status === 'STARTING') {
      this.bootTimer -= deltaTime
      if (this.bootTimer <= 0) {
        this.status = 'RUNNING'
        // Bring interfaces back up if admin up and cable connected
        for (const intf of this.interfaces.values()) {
          const port = this.getPort(intf.connectedPortId || '')
          if (intf.adminStatus === 'up') {
            if (intf.id.startsWith('Vlan') || intf.id.startsWith('Loopback')) {
               intf.operStatus = 'up'
            } else if (port && port.connectedCableId) {
               intf.operStatus = 'up'
            }
          }
        }
        this.updateConnectedRoutes()
      }
      return
    }

    if (this.status !== 'RUNNING') return
  }

  public generateRunningConfig(): string {
    const lines: string[] = []
    lines.push('!')
    lines.push(`hostname ${this.hostname}`)
    lines.push('!')

    if (this.ipv6UnicastRoutingEnabled) {
      lines.push('ipv6 unicast-routing')
      lines.push('!')
    }

    // DNS
    // (Assuming DNS Client state is part of the Router subclass. Since we are in the base class, we can check via type assertion)
    const router = this as any
    if (router.dnsClient?.serverIp) {
      lines.push(`ip name-server ${router.dnsClient.serverIp}`)
      lines.push('!')
    }

    // DHCP Server
    if (router.dhcpServer?.pools?.size > 0) {
      for (const pool of router.dhcpServer.pools.values()) {
        lines.push(`ip dhcp pool ${pool.name}`)
        if (pool.network && pool.mask) lines.push(` network ${pool.network} ${pool.mask}`)
        if (pool.defaultRouter) lines.push(` default-router ${pool.defaultRouter}`)
        if (pool.dnsServer) lines.push(` dns-server ${pool.dnsServer}`)
      }
      lines.push('!')
    }

    // DHCP Excluded Addresses
    if (router.dhcpServer?.excludedAddresses?.size > 0) {
      for (const exc of router.dhcpServer.excludedAddresses.values()) {
        lines.push(`ip dhcp excluded-address ${exc.start} ${exc.end}`)
      }
      lines.push('!')
    }

    // Interfaces
    for (const intf of this.interfaces.values()) {
      // Reconstruct interface name (e.g. from GigabitEthernet0/0)
      lines.push(`interface ${intf.name}`)
      
      if (intf.encapsulationDot1Q) {
        lines.push(` encapsulation dot1Q ${intf.encapsulationDot1Q}`)
      }

      if (intf.ipAddress) {
        if (intf.ipAddress === 'dhcp') {
          lines.push(' ip address dhcp')
        } else {
          lines.push(` ip address ${intf.ipAddress} ${intf.subnetMask}`)
        }
      } else {
        lines.push(' no ip address')
      }

      for (const ipv6 of intf.ipv6Addresses) {
        lines.push(` ipv6 address ${ipv6}`)
      }

      if (intf.switchportMode) {
        lines.push(` switchport mode ${intf.switchportMode}`)
      }
      if (intf.accessVlan !== 1 && intf.switchportMode === 'access') {
        lines.push(` switchport access vlan ${intf.accessVlan}`)
      }
      if (intf.trunkNativeVlan !== 1) {
        lines.push(` switchport trunk native vlan ${intf.trunkNativeVlan}`)
      }
      if (intf.trunkAllowedVlans !== 'all') {
        const allowedStr = Array.isArray(intf.trunkAllowedVlans) ? intf.trunkAllowedVlans.join(',') : intf.trunkAllowedVlans
        lines.push(` switchport trunk allowed vlan ${allowedStr}`)
      }
      if (intf.portSecurityEnabled) {
        lines.push(` switchport port-security`)
        if (intf.portSecurityMax !== 1) lines.push(` switchport port-security maximum ${intf.portSecurityMax}`)
        if (intf.portSecurityViolation !== 'shutdown') lines.push(` switchport port-security violation ${intf.portSecurityViolation}`)
        if (intf.portSecuritySticky) lines.push(` switchport port-security mac-address sticky`)
      }

      if (intf.natZone) {
        lines.push(` ip nat ${intf.natZone}`)
      }

      const acl = this.interfaceAcls.get(intf.id)
      if (acl?.in) lines.push(` ip access-group ${acl.in} in`)
      if (acl?.out) lines.push(` ip access-group ${acl.out} out`)

      if (intf.adminStatus === 'down') {
        lines.push(' shutdown')
      }
      lines.push('!')
    }

    // Global NAT inside source static
    if (router.natProcess?.staticTranslations?.size > 0) {
      for (const [inside, outside] of router.natProcess.staticTranslations.entries()) {
        lines.push(`ip nat inside source static ${inside} ${outside}`)
      }
      lines.push('!')
    }

    // Static Routes
    for (const route of this.staticRoutes) {
      if (route.outgoingInterfaceId) {
        const intf = this.getInterface(route.outgoingInterfaceId)
        lines.push(`ip route ${route.network} ${route.mask} ${intf?.name}`)
      } else {
        lines.push(`ip route ${route.network} ${route.mask} ${route.nextHop}`)
      }
    }
    for (const route of this.staticIpv6Routes) {
      if (route.outgoingInterfaceId) {
        const intf = this.getInterface(route.outgoingInterfaceId)
        lines.push(`ipv6 route ${route.network}/${route.prefixLength} ${intf?.name}`)
      } else {
        lines.push(`ipv6 route ${route.network}/${route.prefixLength} ${route.nextHop}`)
      }
    }
    if (this.staticRoutes.length > 0 || this.staticIpv6Routes.length > 0) {
      lines.push('!')
    }

    // Default gateway (for PCs)
    if (this.defaultGateway) {
      lines.push(`ip default-gateway ${this.defaultGateway}`)
      lines.push('!')
    }

    // ACLs
    const aclLines = this.aclEngine.generateConfig()
    if (aclLines.length > 0) {
      lines.push(...aclLines)
      lines.push('!')
    }

    // OSPF
    if (router.ospfProcess?.networks?.size > 0) {
      lines.push('router ospf 1') // Assuming process ID 1 for now
      for (const net of router.ospfProcess.networks.values()) {
        lines.push(` network ${net.ip} ${net.wildcard} area ${net.area}`)
      }
      if (router.ospfProcess.routerId) {
        lines.push(` router-id ${router.ospfProcess.routerId}`)
      }
      lines.push('!')
    }

    // RIP
    if (router.ripProcess?.networks?.size > 0) {
      lines.push('router rip')
      if (router.ripProcess.version === 2) lines.push(' version 2')
      for (const net of router.ripProcess.networks.values()) {
        lines.push(` network ${net}`)
      }
      lines.push('!')
    }

    lines.push('end')
    return lines.join('\n')
  }
  public handleIcmpForUs(ipv4: IPv4Packet, ingressIntf: LogicalInterface, portId: string): void {
    const icmp = ipv4.payload as ICMPPacket
    if (icmp.type !== 8) {
      if (icmp.type === 0 || icmp.type === 11 || icmp.type === 3) {
        const cb = this.pingCallbacks.get(icmp.identifier)
        if (cb) cb(icmp, ipv4.srcIp, this.engine!.now(), icmp.sequenceNumber)
      }
      return
    }

    const replySrcIp = ingressIntf.ipAddress
    if (!replySrcIp) return

    const replyIcmp: ICMPPacket = { type: 0, code: 0, identifier: icmp.identifier, sequenceNumber: icmp.sequenceNumber, payload: icmp.payload }
    const replyIpv4: IPv4Packet = { srcIp: replySrcIp, dstIp: ipv4.srcIp, protocol: 1, ttl: 255, payload: replyIcmp }

    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.routingTable) {
      if (IPMath.isSameSubnet(replyIpv4.dstIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
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

    const targetIp = nextHopIp || replyIpv4.dstIp
    const targetMac = this.resolveArp(targetIp)
    if (!targetMac) return

    let txFrame: EthernetFrame = { srcMac: outIntf.macAddress, dstMac: targetMac, ethertype: 0x0800, payload: replyIpv4 }
    if (outIntf.type === 'subinterface' && outIntf.encapsulationDot1Q) {
      txFrame = { srcMac: outIntf.macAddress, dstMac: targetMac, ethertype: 0x8100, payload: { vlanId: outIntf.encapsulationDot1Q, ethertype: 0x0800, payload: replyIpv4 } }
    }

    const txPortId = outIntf.type === 'subinterface' ? outIntf.parentPortId! : outIntf.connectedPortId!
    this.engine?.transmitFrame(this.id, txPortId, txFrame)
  }
}
