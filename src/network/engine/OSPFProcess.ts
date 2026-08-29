import type { Router } from './Devices'
import { OSPFNeighbor } from './OSPFNeighbor'
import type { OSPFHeader, OSPFHello, EthernetFrame } from './DataPlane'
import { IPMath } from './IPMath'
import type { NetworkInterface } from './NetworkInterface'

export interface OSPFNetworkStatement {
  network: string
  wildcard: string
  area: string
}

export interface OSPFInterfaceConfig {
  intfId: string
  area: string
  cost: number
  helloInterval: number
  deadInterval: number
}

// Very simple LSA representation for our educational DB
export interface EducationalLSA {
  advertisingRouter: string
  area: string
  links: {
    subnet: string // Network
    mask: string   // Subnet mask
    cost: number
    neighborRouterId?: string // If connected to another router
  }[]
  sequenceNumber: number
}

export class OSPFProcess {
  public processId: number
  public routerId: string | null = null
  public router: Router
  
  public networks: OSPFNetworkStatement[] = []
  
  // Interface ID -> OSPF Config
  public ospfInterfaces: Map<string, OSPFInterfaceConfig> = new Map()
  
  // Interface ID -> list of neighbors
  public neighbors: Map<string, OSPFNeighbor[]> = new Map()
  
  // Link State Database
  public lsdb: Map<string, EducationalLSA> = new Map()
  
  private helloTimer: number = 0
  private spfTimer: number = 0
  private lsdbDirty: boolean = false

  constructor(router: Router, processId: number) {
    this.router = router
    this.processId = processId
  }

  public getRouterId(): string {
    if (this.routerId) return this.routerId
    // Highest IP on loopbacks, then highest IP on physical
    // For sim, just pick highest IP on any up interface
    let highestIp = '0.0.0.0'
    for (const intf of this.router.interfaces.values()) {
      if (intf.ipAddress && intf.operStatus === 'up') {
        const numIp = IPMath.ipToLong(intf.ipAddress)
        if (numIp > IPMath.ipToLong(highestIp)) {
          highestIp = intf.ipAddress
        }
      }
    }
    return highestIp !== '0.0.0.0' ? highestIp : '0.0.0.0'
  }

  public addNetwork(network: string, wildcard: string, area: string) {
    // Remove if exists
    this.networks = this.networks.filter(n => !(n.network === network && n.wildcard === wildcard))
    this.networks.push({ network, wildcard, area })
    this.reassessInterfaces()
    this.generateLSA()
  }

  public removeNetwork(network: string, wildcard: string, area: string) {
    this.networks = this.networks.filter(n => !(n.network === network && n.wildcard === wildcard))
    this.reassessInterfaces()
    this.generateLSA()
  }

  public reassessInterfaces() {
    const newOspfInterfaces = new Map<string, OSPFInterfaceConfig>()
    
    for (const intf of this.router.interfaces.values()) {
      if (!intf.ipAddress || !intf.subnetMask || intf.operStatus !== 'up') continue
      
      const intfNum = IPMath.ipToLong(intf.ipAddress)
      // Check if it matches any network statement
      let matchedArea: string | null = null
      for (const net of this.networks) {
        const netNum = IPMath.ipToLong(net.network)
        const wildNum = IPMath.ipToLong(net.wildcard)
        const maskNum = (~wildNum) >>> 0
        if ((intfNum & maskNum) === (netNum & maskNum)) {
          matchedArea = net.area
          break
        }
      }
      
      if (matchedArea) {
        // Calculate cost: Reference BW (100Mbps) / Intf Speed
        // speed is in Mbps in our simulation (e.g., 1000 for Gigabit, 100 for FastEthernet)
        const refBw = 100
        let cost = Math.max(1, Math.floor(refBw / intf.speed))
        
        newOspfInterfaces.set(intf.id, {
          intfId: intf.id,
          area: matchedArea,
          cost,
          helloInterval: 10,
          deadInterval: 40
        })
        
        if (!this.neighbors.has(intf.id)) {
          this.neighbors.set(intf.id, [])
        }
      }
    }
    
    this.ospfInterfaces = newOspfInterfaces
    
    // Clean up neighbors for interfaces no longer in OSPF
    for (const key of this.neighbors.keys()) {
      if (!this.ospfInterfaces.has(key)) {
        this.neighbors.delete(key)
      }
    }
  }

  public tick(deltaTimeMs: number) {
    // We tick neighbors
    for (const [intfId, neighborList] of this.neighbors) {
      let lsdbChanged = false
      for (const n of neighborList) {
        const oldState = n.state
        n.tick(deltaTimeMs)
        if (oldState !== n.state && n.state === 'Down') {
          this.router.log(`%OSPF-5-ADJCHG: Process ${this.processId}, Nbr ${n.routerId} on ${this.router.getInterface(intfId)?.name} from FULL to DOWN, Dead timer expired`)
          lsdbChanged = true
        }
      }
      // Remove dead neighbors
      const prevCount = neighborList.length
      this.neighbors.set(intfId, neighborList.filter(n => n.state !== 'Down'))
      if (prevCount !== this.neighbors.get(intfId)!.length) lsdbChanged = true
      
      if (lsdbChanged) {
        this.generateLSA()
      }
    }

    this.helloTimer -= deltaTimeMs / 1000
    if (this.helloTimer <= 0) {
      this.helloTimer = 10 // default
      this.sendHellos()
    }
    
    if (this.lsdbDirty) {
      this.spfTimer -= deltaTimeMs / 1000
      if (this.spfTimer <= 0) {
        this.runSPF()
        this.lsdbDirty = false
      }
    }
  }

  private sendHellos() {
    this.reassessInterfaces() // Ensure interfaces are up to date
    const rtrId = this.getRouterId()
    if (rtrId === '0.0.0.0') return // Need a router ID
    
    for (const [intfId, config] of this.ospfInterfaces) {
      const intf = this.router.getInterface(intfId)
      if (!intf || intf.operStatus !== 'up') continue
      
      // Construct Hello
      const hello: OSPFHello = {
        networkMask: intf.subnetMask!,
        helloInterval: config.helloInterval,
        options: 0,
        rtrPriority: 1,
        routerDeadInterval: config.deadInterval,
        designatedRouter: '0.0.0.0', // simplified
        backupDesignatedRouter: '0.0.0.0',
        neighbors: (this.neighbors.get(intfId) || []).filter(n => n.state !== 'Down').map(n => n.routerId)
      }
      
      const header: OSPFHeader = {
        version: 2,
        type: 'hello',
        packetLength: 0,
        routerId: rtrId,
        areaId: config.area,
        checksum: 0,
        authtype: 0,
        authentication: 0,
        payload: hello
      }
      
      // Multicast to 224.0.0.5
      const outFrame: EthernetFrame = {
        srcMac: intf.macAddress,
        dstMac: '01:00:5E:00:00:05',
        ethertype: 0x0800,
        payload: {
          srcIp: intf.ipAddress,
          dstIp: '224.0.0.5',
          protocol: 89,
          ttl: 1,
          payload: header
        }
      }
      
      if (intf.type === 'subinterface' && intf.encapsulationDot1Q) {
         // handle dot1q
         this.router.engine?.transmitFrame(this.router.id, intf.parentPortId!, {
           srcMac: intf.macAddress, dstMac: '01:00:5E:00:00:05', ethertype: 0x8100, payload: {
             vlanId: intf.encapsulationDot1Q,
             ethertype: 0x0800,
             payload: outFrame.payload
           }
         })
      } else {
         this.router.engine?.transmitFrame(this.router.id, intf.connectedPortId!, outFrame)
      }
    }
  }

  public receiveOSPF(intf: NetworkInterface, header: OSPFHeader, srcIp: string) {
    if (header.type === 'hello') {
      this.processHello(intf, header, srcIp)
    } else if (header.type === 'lsu') {
      // Simplified: Just flood LSA and trigger SPF
      const lsu = header.payload as any
      let changed = false
      for (const lsa of lsu.lsas) {
         if (this.processLSA(lsa)) changed = true
      }
      if (changed) {
         this.floodLSAs(intf.id) // Flood out other interfaces
         this.lsdbDirty = true
         this.spfTimer = 2 // 2 second delay before SPF
      }
    }
  }

  private processHello(intf: NetworkInterface, header: OSPFHeader, srcIp: string) {
    const config = this.ospfInterfaces.get(intf.id)
    if (!config) return // OSPF not enabled on interface
    
    const hello = header.payload as OSPFHello
    
    // Parameter matching
    if (hello.networkMask !== intf.subnetMask) return
    if (hello.helloInterval !== config.helloInterval) return
    if (hello.routerDeadInterval !== config.deadInterval) return
    if (header.areaId !== config.area) return
    
    let neighbors = this.neighbors.get(intf.id)
    if (!neighbors) {
      neighbors = []
      this.neighbors.set(intf.id, neighbors)
    }
    
    let nbr = neighbors.find(n => n.routerId === header.routerId)
    if (!nbr) {
      nbr = new OSPFNeighbor(header.routerId, srcIp, intf.id)
      neighbors.push(nbr)
      nbr.state = 'Init'
    }
    
    nbr.resetDeadTimer()
    
    // Check if we are in their neighbor list
    if (hello.neighbors.includes(this.getRouterId())) {
      if (nbr.state === 'Init') {
         nbr.state = '2-Way'
         // Educational sim jump straight to Full
         nbr.state = 'Full'
         this.router.log(`%OSPF-5-ADJCHG: Process ${this.processId}, Nbr ${nbr.routerId} on ${intf.name} from LOADING to FULL, Loading Done`)
         this.generateLSA()
      }
    } else {
      nbr.state = 'Init'
    }
  }

  private generateLSA() {
    const rtrId = this.getRouterId()
    if (rtrId === '0.0.0.0') return
    
    let currentLsa = this.lsdb.get(rtrId)
    const seq = currentLsa ? currentLsa.sequenceNumber + 1 : 1
    
    const links = []
    
    for (const [intfId, config] of this.ospfInterfaces) {
      const intf = this.router.getInterface(intfId)
      if (!intf || intf.operStatus !== 'up') continue
      
      const subnet = IPMath.getNetworkAddress(intf.ipAddress!, intf.subnetMask!)
      const neighbors = this.neighbors.get(intfId) || []
      const fullNeighbors = neighbors.filter(n => n.state === 'Full')
      
      if (fullNeighbors.length > 0) {
        // Point-to-Point simulation: Add a link for each neighbor
        for (const n of fullNeighbors) {
          links.push({
            subnet,
            mask: intf.subnetMask!,
            cost: config.cost,
            neighborRouterId: n.routerId
          })
        }
      } else {
        // Stub network
        links.push({
          subnet,
          mask: intf.subnetMask!,
          cost: config.cost
        })
      }
    }
    
    const newLsa: EducationalLSA = {
      advertisingRouter: rtrId,
      area: '0', // simplified
      links,
      sequenceNumber: seq
    }
    
    this.lsdb.set(rtrId, newLsa)
    this.lsdbDirty = true
    this.spfTimer = 1 // 1 second delay
    this.floodLSAs(null)
  }

  private processLSA(lsa: EducationalLSA): boolean {
    const current = this.lsdb.get(lsa.advertisingRouter)
    if (!current || current.sequenceNumber < lsa.sequenceNumber) {
      this.lsdb.set(lsa.advertisingRouter, lsa)
      return true
    }
    return false
  }

  private floodLSAs(skipIntfId: string | null) {
    const rtrId = this.getRouterId()
    if (rtrId === '0.0.0.0') return
    
    const lsas = Array.from(this.lsdb.values())
    const payload = { lsas }
    
    const header: OSPFHeader = {
      version: 2,
      type: 'lsu',
      packetLength: 0,
      routerId: rtrId,
      areaId: '0',
      checksum: 0,
      authtype: 0,
      authentication: 0,
      payload
    }
    
    for (const [intfId, config] of this.ospfInterfaces) {
      if (intfId === skipIntfId) continue
      
      const intf = this.router.getInterface(intfId)
      if (!intf || intf.operStatus !== 'up') continue
      
      const neighbors = this.neighbors.get(intfId) || []
      const hasFull = neighbors.some(n => n.state === 'Full')
      if (!hasFull) continue // Don't flood out stub interfaces
      
      const outFrame: EthernetFrame = {
        srcMac: intf.macAddress,
        dstMac: '01:00:5E:00:00:05',
        ethertype: 0x0800,
        payload: {
          srcIp: intf.ipAddress,
          dstIp: '224.0.0.5',
          protocol: 89,
          ttl: 1,
          payload: header
        }
      }
      
      if (intf.type === 'subinterface' && intf.encapsulationDot1Q) {
         this.router.engine?.transmitFrame(this.router.id, intf.parentPortId!, {
           srcMac: intf.macAddress, dstMac: '01:00:5E:00:00:05', ethertype: 0x8100, payload: {
             vlanId: intf.encapsulationDot1Q,
             ethertype: 0x0800,
             payload: outFrame.payload
           }
         })
      } else {
         this.router.engine?.transmitFrame(this.router.id, intf.connectedPortId!, outFrame)
      }
    }
  }

  private runSPF() {
    // Dijkstra's Algorithm implementation
    const rtrId = this.getRouterId()
    if (rtrId === '0.0.0.0') return
    
    // Clear old OSPF routes
    this.router.routingTable = this.router.routingTable.filter(r => r.protocol !== 'ospf')
    
    // Distances map: NodeID (Router ID) -> Total Cost
    const dist = new Map<string, number>()
    // Previous node map for path reconstruction
    const prev = new Map<string, { routerId: string, outIntfId: string, nextHop: string }>()
    
    // Nodes to visit
    const unvisited = new Set<string>()
    for (const key of this.lsdb.keys()) {
      dist.set(key, Infinity)
      unvisited.add(key)
    }
    
    dist.set(rtrId, 0)
    
    // Initial neighbors from root
    const rootLSA = this.lsdb.get(rtrId)
    if (rootLSA) {
      for (const link of rootLSA.links) {
        if (link.neighborRouterId) {
          dist.set(link.neighborRouterId, link.cost)
          // Find the interface that leads to this neighbor
          let outIntfId = ''
          let nextHop = ''
          for (const [intfId, neighbors] of this.neighbors) {
             const n = neighbors.find(x => x.routerId === link.neighborRouterId)
             if (n && n.state === 'Full') {
                outIntfId = intfId
                nextHop = n.ipAddress
                break
             }
          }
          if (outIntfId) {
            prev.set(link.neighborRouterId, { routerId: rtrId, outIntfId, nextHop })
          }
        }
      }
    }
    
    while (unvisited.size > 0) {
      // Find node with min dist
      let u = null
      let minDist = Infinity
      for (const node of unvisited) {
        const d = dist.get(node) || Infinity
        if (d < minDist) {
          minDist = d
          u = node
        }
      }
      
      if (u === null || minDist === Infinity) break // Remaining nodes unreachable
      
      unvisited.delete(u)
      
      const lsa = this.lsdb.get(u)
      if (!lsa) continue
      
      for (const link of lsa.links) {
        if (link.neighborRouterId && unvisited.has(link.neighborRouterId)) {
          const v = link.neighborRouterId
          const alt = minDist + link.cost
          const currentDistV = dist.get(v) || Infinity
          if (alt < currentDistV) {
            dist.set(v, alt)
            // Inherit the nextHop and outIntfId from the path to u
            const pathInfo = prev.get(u)
            if (pathInfo) {
              prev.set(v, pathInfo) // Retain original outgoing interface/next-hop
            }
          }
        }
      }
    }
    
    // Now install routes from the LSDB using the computed shortest paths
    // Iterate through all LSAs, and install their stub networks
    for (const [node, lsa] of this.lsdb) {
      if (node === rtrId) continue // Don't install our own routes, they are connected
      const nodeDist = dist.get(node)
      if (nodeDist === undefined || nodeDist === Infinity) continue // Unreachable
      
      const pathInfo = prev.get(node)
      if (!pathInfo) continue
      
      for (const link of lsa.links) {
        // We install all links as routes (even point-to-point subnets).
        // Check if we already have this as a connected route
        const isConnected = this.router.routingTable.some(r => r.protocol === 'connected' && r.network === link.subnet && r.mask === link.mask)
        if (!isConnected) {
          const totalCost = nodeDist + link.cost
          
          // Add to routing table
          // (Duplicate check handled simply by overwriting if better metric)
          const existing = this.router.routingTable.find(r => r.network === link.subnet && r.mask === link.mask)
          if (!existing || existing.administrativeDistance > 110 || (existing.administrativeDistance === 110 && existing.metric > totalCost)) {
             this.router.routingTable = this.router.routingTable.filter(r => !(r.network === link.subnet && r.mask === link.mask))
             this.router.routingTable.push({
               network: link.subnet,
               mask: link.mask,
               nextHop: pathInfo.nextHop,
               outgoingInterfaceId: pathInfo.outIntfId,
               metric: totalCost,
               administrativeDistance: 110, // OSPF AD
               protocol: 'ospf'
             })
          }
        }
      }
    }
  }
}
