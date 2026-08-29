/**
 * NATProcess.ts — Implements Network Address Translation (NAT) logic
 * for the Router device. Supports Static NAT and PAT (Overload).
 */
import type { Router } from './Devices'
import { IPMath } from './IPMath'
import type { IPv4Packet, UDPPacket } from './DataPlane'
import type { NetworkInterface } from './NetworkInterface'

export interface NATStaticMapping {
  localIp: string
  globalIp: string
}

export interface NATDynamicMapping {
  aclName: string
  interfaceId: string // The outside interface whose IP will be used (overload)
}

export interface NATTranslationEntry {
  protocol: 'udp' | 'tcp' | 'icmp'
  insideLocalIp: string
  insideLocalPort: number
  insideGlobalIp: string
  insideGlobalPort: number
  outsideLocalIp: string
  outsideLocalPort: number
  outsideGlobalIp: string
  outsideGlobalPort: number
  lastActive: number
}

export class NATProcess {
  public device: Router

  public staticMappings: NATStaticMapping[] = []
  public dynamicMappings: NATDynamicMapping[] = [] // Lists overload configs

  // Active translation table
  public translations: NATTranslationEntry[] = []
  
  public stats = {
    hits: 0,
    misses: 0,
    created: 0
  }

  // To allocate ports for PAT
  private nextPort = 10000

  constructor(device: Router) {
    this.device = device
  }

  public addStaticMapping(localIp: string, globalIp: string) {
    this.staticMappings.push({ localIp, globalIp })
  }

  public removeStaticMapping(localIp: string) {
    this.staticMappings = this.staticMappings.filter(m => m.localIp !== localIp)
  }

  public addDynamicMapping(aclName: string, interfaceId: string) {
    this.dynamicMappings.push({ aclName, interfaceId })
  }

  public removeDynamicMapping(aclName: string) {
    this.dynamicMappings = this.dynamicMappings.filter(m => m.aclName !== aclName)
  }

  /**
   * Translates an egress packet (Inside -> Outside).
   * Modifies source IP and Port.
   */
  public processEgress(ipv4: IPv4Packet, ingressIntf: NetworkInterface, egressIntf: NetworkInterface): void {
    if (ingressIntf.natZone !== 'inside' || egressIntf.natZone !== 'outside') return

    // 1. Check for Static NAT match
    const staticMap = this.staticMappings.find(m => m.localIp === ipv4.srcIp)
    if (staticMap) {
      ipv4.srcIp = staticMap.globalIp
      this.stats.hits++
      return
    }

    // 2. Check for PAT (Overload)
    // We assume any configured ACL name permits all traffic for educational purposes.
    if (this.dynamicMappings.length > 0) {
      const mapping = this.dynamicMappings[0]
      const outIntf = this.device.getInterface(mapping.interfaceId)
      if (outIntf && outIntf.ipAddress) {
        
        let protocol: 'udp' | 'tcp' | 'icmp' | null = null
        let srcPort = 0
        let dstPort = 0

        if (ipv4.protocol === 17) {
          protocol = 'udp'
          srcPort = (ipv4.payload as UDPPacket).srcPort
          dstPort = (ipv4.payload as UDPPacket).dstPort
        } else if (ipv4.protocol === 6) {
          protocol = 'tcp'
          // Assume TCP struct matches UDP for port fields in simulation
          srcPort = (ipv4.payload as any).srcPort
          dstPort = (ipv4.payload as any).dstPort
        } else if (ipv4.protocol === 1) {
          protocol = 'icmp'
          srcPort = (ipv4.payload as any).identifier || 0
          dstPort = srcPort // ICMP doesn't really have dst port, use identifier
        }

        if (protocol) {
          // Look for existing translation
          let entry = this.translations.find(t => 
            t.protocol === protocol &&
            t.insideLocalIp === ipv4.srcIp &&
            t.insideLocalPort === srcPort &&
            t.outsideGlobalIp === ipv4.dstIp &&
            t.outsideGlobalPort === dstPort
          )

          if (!entry) {
            // Create new translation
            const globalPort = this.nextPort++
            if (this.nextPort > 65000) this.nextPort = 10000

            entry = {
              protocol,
              insideLocalIp: ipv4.srcIp,
              insideLocalPort: srcPort,
              insideGlobalIp: outIntf.ipAddress,
              insideGlobalPort: globalPort,
              outsideLocalIp: ipv4.dstIp, // usually same as outside global
              outsideLocalPort: dstPort,
              outsideGlobalIp: ipv4.dstIp,
              outsideGlobalPort: dstPort,
              lastActive: this.device.engine!.now()
            }
            this.translations.push(entry)
            this.device.log(`%NAT-6-CREATED: dynamic translation created for ${entry.protocol} ${entry.insideLocalIp}:${entry.insideLocalPort} to ${entry.insideGlobalIp}:${entry.insideGlobalPort}`)
            this.stats.created++
          }

          // Apply translation
          entry.lastActive = this.device.engine!.now()
          ipv4.srcIp = entry.insideGlobalIp
          
          if (protocol === 'udp' || protocol === 'tcp') {
            (ipv4.payload as any).srcPort = entry.insideGlobalPort
          } else if (protocol === 'icmp') {
            (ipv4.payload as any).identifier = entry.insideGlobalPort
          }

          this.stats.hits++
        } else {
          console.log(`[NAT] Protocol missing or unknown: ${ipv4.protocol}`)
          this.stats.misses++ // Unknown protocol, can't PAT
        }
      } else {
         console.log(`[NAT] Egress interface not found or no IP: ${mapping.interfaceId}`)
      }
    }
  }

  /**
   * Translates an ingress packet (Outside -> Inside).
   * Modifies destination IP and Port BEFORE routing lookup.
   */
  public processIngress(ipv4: IPv4Packet, ingressIntf: NetworkInterface): void {
    if (ingressIntf.natZone !== 'outside') return

    // 1. Check for Static NAT match (dstIp == globalIp)
    const staticMap = this.staticMappings.find(m => m.globalIp === ipv4.dstIp)
    if (staticMap) {
      ipv4.dstIp = staticMap.localIp
      this.stats.hits++
      return
    }

    // 2. Check translation table (dstIp == insideGlobalIp && dstPort == insideGlobalPort)
    let protocol: 'udp' | 'tcp' | 'icmp' | null = null
    let dstPort = 0
    let srcPort = 0

    if (ipv4.protocol === 17) {
      protocol = 'udp'
      srcPort = (ipv4.payload as UDPPacket).srcPort
      dstPort = (ipv4.payload as UDPPacket).dstPort
    } else if (ipv4.protocol === 6) {
      protocol = 'tcp'
      srcPort = (ipv4.payload as any).srcPort
      dstPort = (ipv4.payload as any).dstPort
    } else if (ipv4.protocol === 1) {
      protocol = 'icmp'
      // ICMP reply will have identifier
      dstPort = (ipv4.payload as any).identifier || 0
      srcPort = dstPort
    }

    if (protocol) {
      const entry = this.translations.find(t => 
        t.protocol === protocol &&
        t.insideGlobalIp === ipv4.dstIp &&
        t.insideGlobalPort === dstPort &&
        t.outsideGlobalIp === ipv4.srcIp
      )

      if (entry) {
        entry.lastActive = this.device.engine!.now()
        ipv4.dstIp = entry.insideLocalIp
        
        if (protocol === 'udp' || protocol === 'tcp') {
          (ipv4.payload as any).dstPort = entry.insideLocalPort
        } else if (protocol === 'icmp') {
          (ipv4.payload as any).identifier = entry.insideLocalPort
        }
        
        this.stats.hits++
        return
      }
    }
    
    // Not translated
    this.stats.misses++
  }

  public cleanupTranslations() {
    const now = this.device.engine!.now()
    const TIMEOUT = 300000 // 5 minutes
    this.translations = this.translations.filter(t => (now - t.lastActive) < TIMEOUT)
  }
}
