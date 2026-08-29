import { Router } from './Devices'
import { IPMath } from './IPMath'
import type { RIPPacket, RIPRouteEntry, Frame, IPv4Packet, UDPPacket } from './DataPlane'

interface RIPRoute {
  network: string
  mask: string
  nextHop: string
  metric: number // 1-15, 16 is unreachable
  interfaceId: string
  learnedFrom: string
  timer: number // Resets to 0 on update. If > 180 (invalid), if > 240 (flush)
}

export class RIPProcess {
  public router: Router
  public version: 1 | 2 = 2
  public autoSummary: boolean = true
  public networks: string[] = [] // Networks that are enabled for RIP

  public routingDatabase: Map<string, RIPRoute> = new Map() // Key: network/mask

  private updateTimer: number = 0
  private updateInterval: number = 30 // seconds

  constructor(router: Router) {
    this.router = router
  }

  public addNetwork(network: string) {
    if (!this.networks.includes(network)) {
      this.networks.push(network)
    }
  }

  public removeNetwork(network: string) {
    this.networks = this.networks.filter(n => n !== network)
    // Clear routes that were learned on interfaces that no longer match the network
    // For simplicity, we can clear the whole RIP DB and let it relearn
    this.routingDatabase.clear()
    this.updateRouterRoutingTable()
  }

  private isInterfaceInNetwork(ip: string): boolean {
    return this.networks.some(net => IPMath.isSameSubnet(ip, net, '255.0.0.0')) // Simplified classful check for the 'network' command
  }

  public tick(deltaTime: number) {
    this.updateTimer += deltaTime
    
    // Check route timeouts
    let changed = false
    for (const [key, route] of this.routingDatabase) {
      route.timer += deltaTime
      if (route.timer >= 240) {
        this.routingDatabase.delete(key)
        changed = true
      } else if (route.timer >= 180 && route.metric < 16) {
        route.metric = 16 // Mark as invalid
        changed = true
      }
    }

    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0
      this.sendUpdates()
    } else if (changed) {
      this.sendUpdates() // Triggered update
    }

    if (changed) {
      this.updateRouterRoutingTable()
    }
  }

  private sendUpdates() {
    const activeInterfaces = Array.from(this.router.interfaces.values()).filter(i => 
      i.operStatus === 'up' && i.ipAddress && this.isInterfaceInNetwork(i.ipAddress)
    )

    if (activeInterfaces.length === 0) return

    // Build the payload
    const entries: RIPRouteEntry[] = []

    // 1. Add connected routes that match the network statements
    for (const route of this.router.routingTable) {
      if (route.protocol === 'connected' && route.outgoingInterfaceId) {
        const intf = this.router.getInterface(route.outgoingInterfaceId)
        if (intf && intf.ipAddress && this.isInterfaceInNetwork(intf.ipAddress)) {
          entries.push({
            addressFamily: 2,
            routeTag: 0,
            ipAddress: route.network,
            subnetMask: route.mask,
            nextHop: '0.0.0.0',
            metric: 1
          })
        }
      }
    }

    // 2. Add learned RIP routes that are valid (Split horizon should apply, but simple implementation first)
    for (const route of this.routingDatabase.values()) {
      if (route.metric < 16) {
        entries.push({
          addressFamily: 2,
          routeTag: 0,
          ipAddress: route.network,
          subnetMask: route.mask,
          nextHop: route.nextHop, // Or 0.0.0.0 if we are advertising it directly
          metric: Math.min(route.metric + 1, 16)
        })
      }
    }

    if (entries.length === 0) return

    const ripPayload: RIPPacket = {
      command: 2, // Response
      version: this.version,
      entries
    }

    const udpPayload: UDPPacket = {
      srcPort: 520,
      dstPort: 520,
      length: 8 + entries.length * 20,
      checksum: 0,
      payload: ripPayload
    }

    for (const intf of activeInterfaces) {
      // Split Horizon: Filter out routes learned from this interface
      const filteredEntries = entries.filter(e => {
        const dbRoute = this.routingDatabase.get(`${e.ipAddress}/${e.subnetMask}`)
        if (dbRoute && dbRoute.interfaceId === intf.id) {
          return false // Split horizon
        }
        return true
      })

      if (filteredEntries.length === 0) continue

      const outUdp: UDPPacket = { ...udpPayload, payload: { ...ripPayload, entries: filteredEntries } }

      const ipPacket: IPv4Packet = {
        version: 4,
        ihl: 5,
        tos: 0,
        totalLength: 20 + outUdp.length,
        identification: 0,
        flags: 0,
        fragmentOffset: 0,
        ttl: 2, // RIP typically 2 or 1
        protocol: 17, // UDP
        headerChecksum: 0,
        srcIp: intf.ipAddress!,
        dstIp: this.version === 2 ? '224.0.0.9' : '255.255.255.255',
        payload: outUdp
      }

      const frame: Frame = {
        srcMac: intf.macAddress,
        dstMac: this.version === 2 ? '01:00:5E:00:00:09' : 'FF:FF:FF:FF:FF:FF',
        ethertype: 0x0800, // IPv4
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

  public receiveRIP(frame: Frame, intfId: string) {
    const intf = this.router.getInterface(intfId)
    if (!intf || !intf.ipAddress || !this.isInterfaceInNetwork(intf.ipAddress)) return

    const ipPacket = frame.payload as IPv4Packet
    if (!ipPacket || ipPacket.protocol !== 17) return
    const udpPacket = ipPacket.payload as UDPPacket
    if (!udpPacket || udpPacket.dstPort !== 520) return
    const ripPacket = udpPacket.payload as RIPPacket
    if (!ripPacket || ripPacket.command !== 2) return

    let routingChanged = false
    const neighborIp = ipPacket.srcIp

    for (const entry of ripPacket.entries) {
      if (entry.metric >= 16) continue // Unreachable
      if (entry.addressFamily !== 2) continue

      // Apply auto-summary if enabled (simplified)
      let network = entry.ipAddress
      let mask = entry.subnetMask
      if (this.autoSummary) {
        mask = '255.0.0.0' // Mock classful mask for now
        network = IPMath.getNetworkAddress(network, mask)
      }

      const key = `${network}/${mask}`
      const newMetric = entry.metric + 1
      if (newMetric >= 16) continue

      const existingRoute = this.routingDatabase.get(key)
      
      if (!existingRoute) {
        // Learn new route
        this.routingDatabase.set(key, {
          network,
          mask,
          nextHop: neighborIp,
          metric: newMetric,
          interfaceId: intfId,
          learnedFrom: neighborIp,
          timer: 0
        })
        routingChanged = true
      } else {
        if (existingRoute.learnedFrom === neighborIp) {
          // Update timer for existing route from same neighbor
          existingRoute.timer = 0
          if (existingRoute.metric !== newMetric) {
            existingRoute.metric = newMetric
            routingChanged = true
          }
        } else if (newMetric < existingRoute.metric) {
          // Better route found
          existingRoute.nextHop = neighborIp
          existingRoute.metric = newMetric
          existingRoute.interfaceId = intfId
          existingRoute.learnedFrom = neighborIp
          existingRoute.timer = 0
          routingChanged = true
        }
      }
    }

    if (routingChanged) {
      this.updateRouterRoutingTable()
    }
  }

  private updateRouterRoutingTable() {
    // Clear old RIP routes
    this.router.routingTable = this.router.routingTable.filter(r => r.protocol !== 'rip')

    // Add valid RIP routes
    for (const route of this.routingDatabase.values()) {
      if (route.metric < 16) {
        this.router.routingTable.push({
          network: route.network,
          mask: route.mask,
          nextHop: route.nextHop,
          outgoingInterfaceId: route.interfaceId,
          protocol: 'rip',
          administrativeDistance: 120,
          metric: route.metric
        })
      }
    }
  }
}
