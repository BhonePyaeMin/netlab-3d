/**
 * SimulationNetworkEngine.ts — Internal standalone network simulation engine.
 *
 * Maintains the global truth of all devices, ports, and links.
 * Later stages will use this to route packets and run protocols.
 */
import type { INetworkEngine } from './INetworkEngine'
import type { NetworkDevice }  from './NetworkDevice'
import type { PhysicalPort }   from './PhysicalPort'
import type { EthernetFrame }  from './DataPlane'
import { SimulationLink } from './SimulationLink'
import type { CapturedPacket } from '../types'

export class SimulationNetworkEngine implements INetworkEngine {
  private devices: Map<string, NetworkDevice> = new Map()
  private ports: Map<string, PhysicalPort> = new Map()
  private links: Map<string, SimulationLink> = new Map()
  private lastTickTime: number
  private packetIdCounter = 0
  
  public simulationState: 'running' | 'paused' | 'stopped' = 'running'
  public simulationSpeed: number = 1
  
  public globalLogs: Array<{ id: string, time: number, deviceId: string, message: string }> = []
  public currentTime: number = 0 // Logical time in ms

  public capturingCableId: string | null = null
  public onPacketCaptured: ((packet: CapturedPacket) => void) | null = null

  // Animation Tracing
  public animationMode: boolean = false
  public activeTrace: import('../types').PacketTrace | null = null

  constructor() {
    this.lastTickTime = Date.now()
    // Run simulation tick every 100ms for more responsive speeds
    setInterval(() => this.tick(), 100)
  }

  public now(): number {
    return this.currentTime
  }

  private tick() {
    const realNow = Date.now()
    const realDelta = realNow - this.lastTickTime
    this.lastTickTime = realNow

    if (this.simulationState !== 'running') return

    const scaledDelta = realDelta * this.simulationSpeed
    this.currentTime += scaledDelta

    for (const device of this.devices.values()) {
      device.tick(scaledDelta)
    }
  }

  public setSpeed(speed: number) {
    this.simulationSpeed = speed
  }

  public setState(state: 'running' | 'paused' | 'stopped') {
    this.simulationState = state
  }

  public resetSimulation() {
    this.currentTime = 0
    this.packetIdCounter = 0
    // Flush state on all devices
    for (const device of this.devices.values()) {
      device.macTable.clear()
      device.arpTable.clear()
      device.routingTable = []
      device.updateConnectedRoutes()
      device.pingCallbacks.clear()
      if (device.natProcess) device.natProcess.translations.clear()
    }
  }

  public addDevice(device: NetworkDevice): void {
    device.engine = this
    this.devices.set(device.id, device)
  }

  public getDevice(id: string): NetworkDevice | undefined {
    return this.devices.get(id)
  }

  public removeDevice(id: string): void {
    const device = this.devices.get(id)
    if (!device) return

    // Disconnect all ports
    for (const port of device.ports.values()) {
      if (port.connectedCableId) {
        this.disconnectCable(port.id)
      }
      this.ports.delete(port.id)
    }

    this.devices.delete(id)
  }

  public clear(): void {
    // Break all links
    for (const link of this.links.values()) {
      this.disconnectCable(link.cableId)
    }
    
    this.links.clear()
    this.ports.clear()
    this.devices.clear()
    this.activeTrace = null
    this.packetIdCounter = 0
  }

  public renameDevice(id: string, newHostname: string): void {
    const device = this.devices.get(id)
    if (device) {
      device.hostname = newHostname
    }
  }

  public moveDevice(id: string, x: number, y: number, z: number): void {
    const device = this.devices.get(id)
    if (device) {
      device.position = { x, y, z }
    }
  }

  public registerPort(port: PhysicalPort): void {
    this.ports.set(port.id, port)
    // Also attach to the device
    const device = this.devices.get(port.deviceId)
    if (device) {
      device.addPort(port)
    }
  }

  public getPort(id: string): PhysicalPort | undefined {
    return this.ports.get(id)
  }

  public getLink(cableId: string): SimulationLink | undefined {
    return this.links.get(cableId)
  }

  public getDevices(): NetworkDevice[] {
    return Array.from(this.devices.values())
  }

  public getPorts(): PhysicalPort[] {
    return Array.from(this.ports.values())
  }

  public getLinks(): SimulationLink[] {
    return Array.from(this.links.values())
  }

  public connectCable(cableId: string, portAId: string, portBId: string): void {
    const portA = this.ports.get(portAId)
    const portB = this.ports.get(portBId)

    if (portA && portB) {
      // Create and store link
      const link = new SimulationLink(cableId, portA, portB)
      this.links.set(cableId, link)

      portA.connectedCableId = cableId
      portA.remotePortId = portBId
      portA.linkDetected = true

      portB.connectedCableId = cableId
      portB.remotePortId = portAId
      portB.linkDetected = true

      const devA = this.devices.get(portA.deviceId)
      const devB = this.devices.get(portB.deviceId)
      if (devA) devA.log(`%PHYS-5-CABLE: Cable connected on ${portA.name}`)
      if (devB) devB.log(`%PHYS-5-CABLE: Cable connected on ${portB.name}`)

      this.triggerLinkStateChange(portA, true)
      this.triggerLinkStateChange(portB, true)
    }
  }

  public disconnectCable(portId: string): void {
    const port = this.ports.get(portId)
    if (!port) return

    const remotePortId = port.remotePortId
    const cableId = port.connectedCableId
    
    if (cableId) {
      this.links.delete(cableId)
    }

    if (remotePortId) {
      const remotePort = this.ports.get(remotePortId)
      if (remotePort) {
        const remoteDevice = this.devices.get(remotePort.deviceId)
        if (remoteDevice) remoteDevice.log(`%PHYS-5-CABLE: Cable disconnected on ${remotePort.name}`)
        
        remotePort.connectedCableId = null
        remotePort.remotePortId = null
        remotePort.linkDetected = false
        this.triggerLinkStateChange(remotePort, false)
      }
    }

    const device = this.devices.get(port.deviceId)
    if (device) device.log(`%PHYS-5-CABLE: Cable disconnected on ${port.name}`)

    port.connectedCableId = null
    port.remotePortId = null
    port.linkDetected = false
    this.triggerLinkStateChange(port, false)
  }

  private triggerLinkStateChange(port: PhysicalPort, isUp: boolean) {
    const device = this.devices.get(port.deviceId)
    if (!device) return

    const stateStr = isUp ? 'up' : 'down'
    device.log(`%LINK-3-UPDOWN: Interface ${port.name}, changed state to ${stateStr}`)

    // Find associated logical interface and cascade the operStatus
    for (const intf of device.interfaces.values()) {
      if (intf.connectedPortId === port.id || intf.parentPortId === port.id) {
        intf.operStatus = isUp ? 'up' : 'down'
      }
    }
    device.updateConnectedRoutes()
  }

  public getPrompt(deviceId: string): string {
    const device = this.devices.get(deviceId)
    return device ? device.cliSession.getPrompt() : `${deviceId}>`
  }

  public getHelp(deviceId: string, command: string): string {
    const device = this.devices.get(deviceId)
    return device ? device.cliSession.getHelp(command) : ''
  }

  public autoComplete(deviceId: string, command: string): string {
    const device = this.devices.get(deviceId)
    return device ? device.cliSession.autoComplete(command) : command
  }

  public executeCommand(deviceId: string, command: string): string {
    const device = this.devices.get(deviceId)
    if (!device) return `% Error: Unknown device`
    
    let lastOutput = ''
    const lines = command.split('\n')
    for (const line of lines) {
      if (line.trim()) {
        const out = device.cliSession.executeCommand(line)
        if (out) lastOutput += out + '\n'
      }
    }
    return lastOutput.trim()
  }

  public transmitFrame(sourceDeviceId: string, sourcePortId: string, frame: EthernetFrame): void {
    const srcDevice = this.devices.get(sourceDeviceId)
    if (!srcDevice || srcDevice.status !== 'RUNNING') return

    const sourcePort = this.ports.get(sourcePortId)
    if (!sourcePort) return
    
    // Ensure the port belongs to the source device
    if (sourcePort.deviceId !== sourceDeviceId) return

    // Ensure the port is actually up and linked
    if (!sourcePort.linkDetected || !sourcePort.remotePortId) return

    const remotePort = this.ports.get(sourcePort.remotePortId)
    if (!remotePort) return

    const isRootTrace = this.animationMode && !this.activeTrace
    if (isRootTrace) {
      this.activeTrace = {
        id: `trace-${this.now()}`,
        timestamp: this.now(),
        protocol: 'Unknown',
        hops: []
      }
      const p = this.interceptFrame(frame, sourcePort.connectedCableId!, true)
      if (p) {
        this.activeTrace.protocol = p.protocol
        this.activeTrace.srcIp = p.srcIp
        this.activeTrace.dstIp = p.dstIp
      }
    }

    if (this.activeTrace) {
      this.activeTrace.hops.push({
        deviceId: sourceDeviceId,
        outgoingPortId: sourcePort.id,
        decisions: [`Transmitted from ${sourcePort.name}`],
        action: 'forward'
      })
    }

    const remoteDevice = this.devices.get(remotePort.deviceId)
    if (!remoteDevice || remoteDevice.status !== 'RUNNING') {
      if (isRootTrace) this.activeTrace = null
      return
    }

    // Deliver the frame to the remote device
    remoteDevice.receiveFrame(remotePort.id, frame)

    if (isRootTrace) {
      // The synchronous stack is complete! Commit the trace.
      // We must dynamically import NetworkStore to avoid circular dependencies if needed,
      // but actually we can just emit it or require it.
      import('../NetworkStore').then(({ NetworkStore }) => {
        NetworkStore.setActiveTrace(this.activeTrace)
        this.activeTrace = null
      })
    }

    // Intercept for Packet Sniffer
    if (this.capturingCableId && sourcePort.connectedCableId === this.capturingCableId) {
      this.interceptFrame(frame, sourcePort.connectedCableId)
    }
  }

  private interceptFrame(frame: EthernetFrame, cableId: string, returnOnly: boolean = false): CapturedPacket | undefined {
    if (!this.onPacketCaptured && !returnOnly) return

    let vlan = 1
    let innerFrame = frame
    let size = 14 // Ethernet header

    if (frame.ethertype === 0x8100) {
      vlan = frame.payload.vlanId
      innerFrame = {
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        ethertype: frame.payload.ethertype,
        payload: frame.payload.payload
      }
      size += 4 // 802.1Q tag
    }

    let srcIp: string | undefined
    let dstIp: string | undefined
    let protocol = 'Unknown'
    let ttl: number | undefined
    let srcPort: number | undefined
    let dstPort: number | undefined

    if (innerFrame.ethertype === 0x0806) { // ARP
      protocol = 'ARP'
      size += 28
      srcIp = innerFrame.payload.senderIp
      dstIp = innerFrame.payload.targetIp
    } else if (innerFrame.ethertype === 0x0800) { // IPv4
      const ipPacket = innerFrame.payload
      srcIp = ipPacket.srcIp
      dstIp = ipPacket.dstIp
      ttl = ipPacket.ttl
      size += 20 // IPv4 header

      if (ipPacket.protocol === 1) {
        protocol = 'ICMP'
        size += 8 + (ipPacket.payload.payload?.length || 0)
      } else if (ipPacket.protocol === 6) {
        protocol = 'TCP'
        srcPort = ipPacket.payload.srcPort
        dstPort = ipPacket.payload.dstPort
        size += 20
      } else if (ipPacket.protocol === 17) {
        srcPort = ipPacket.payload.srcPort
        dstPort = ipPacket.payload.dstPort
        size += 8
        if (srcPort === 67 || dstPort === 67) {
          protocol = 'DHCP'
          size += 300
        } else if (srcPort === 53 || dstPort === 53) {
          protocol = 'DNS'
          size += 100
        } else if (srcPort === 520 || dstPort === 520) {
          protocol = 'RIP'
          size += 50
        } else {
          protocol = 'UDP'
          size += ipPacket.payload.length || 0
        }
      } else if (ipPacket.protocol === 89) {
        protocol = 'OSPF'
        size += ipPacket.payload.packetLength || 64
      } else {
        protocol = 'IPv4'
      }
    } else if (innerFrame.ethertype === 0x86DD) { // IPv6
      const ipv6Packet = innerFrame.payload
      srcIp = ipv6Packet.srcIp
      dstIp = ipv6Packet.dstIp
      ttl = ipv6Packet.hopLimit
      size += 40

      if (ipv6Packet.nextHeader === 58) {
        protocol = 'ICMPv6'
        size += 8
      } else if (ipv6Packet.nextHeader === 6) {
        protocol = 'TCP'
        srcPort = ipv6Packet.payload.srcPort
        dstPort = ipv6Packet.payload.dstPort
        size += 20
      } else if (ipv6Packet.nextHeader === 17) {
        protocol = 'UDP'
        srcPort = ipv6Packet.payload.srcPort
        dstPort = ipv6Packet.payload.dstPort
        size += 8
      } else {
        protocol = 'IPv6'
      }
    }

    const captured: CapturedPacket = {
      id: ++this.packetIdCounter,
      timestamp: this.now(),
      cableId,
      srcMac: innerFrame.srcMac,
      dstMac: innerFrame.dstMac,
      srcIp,
      dstIp,
      protocol,
      vlan,
      ttl,
      srcPort,
      dstPort,
      size
    }

    if (returnOnly) return captured

    this.onPacketCaptured(captured)
  }
}
