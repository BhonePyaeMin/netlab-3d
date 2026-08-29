/**
 * SimulationLink.ts — Pure TypeScript model of a physical network link.
 */
import type { PhysicalPort } from './PhysicalPort'
import type { PortType } from './DeviceTypes'

export type LinkType = 'ethernet' | 'fastethernet' | 'gigabitethernet' | 'serial' | 'console' | 'fiber' | 'usb'

export class SimulationLink {
  public id: string
  public portAId: string
  public portBId: string
  public linkType: LinkType
  public status: 'up' | 'down'
  public bandwidthMbps: number
  public latencyMs: number
  public packetLossPercent: number

  constructor(
    id: string,
    portA: PhysicalPort,
    portB: PhysicalPort
  ) {
    this.id = id
    this.portAId = portA.id
    this.portBId = portB.id
    
    // Automatically negotiate link type based on the physical ports.
    this.linkType = this.negotiateLinkType(portA, portB)
    this.bandwidthMbps = this.negotiateBandwidth(portA, portB)
    
    // Default link characteristics
    this.status = 'up'
    this.latencyMs = 1 // 1ms default local latency
    this.packetLossPercent = 0
  }

  private negotiateLinkType(portA: PhysicalPort, portB: PhysicalPort): LinkType {
    if (portA.portType === 'console' || portB.portType === 'console') return 'console'
    if (portA.portType === 'serial' || portB.portType === 'serial') return 'serial'
    if (portA.portType === 'fiber' || portB.portType === 'fiber') return 'fiber'
    if (portA.portType === 'usb' || portB.portType === 'usb') return 'usb'
    
    // Ethernet auto-negotiation based on name strings (simplistic simulation)
    const combinedSpeeds = Math.min(portA.speedMbps, portB.speedMbps)
    
    if (combinedSpeeds >= 1000) return 'gigabitethernet'
    if (combinedSpeeds >= 100) return 'fastethernet'
    return 'ethernet'
  }

  private negotiateBandwidth(portA: PhysicalPort, portB: PhysicalPort): number {
    if (this.linkType === 'console' || this.linkType === 'usb') return 0
    if (this.linkType === 'serial') return 1.544 // T1 speed default for serial

    // For ethernet, take the lowest speed of the two ports
    return Math.min(portA.speedMbps, portB.speedMbps)
  }
}
