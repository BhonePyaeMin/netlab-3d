/**
 * NeighborDiscovery.ts — CDP and LLDP Neighbor Discovery for the Simulator.
 *
 * Instead of actually transmitting CDP/LLDP frames, we leverage the fact that
 * the simulation engine has direct access to the physical topology. We walk the
 * port→remotePortId→remoteDevice graph to build the neighbor table, which
 * accurately reflects the actual wired topology (just like a real device would
 * learn over CDP/LLDP).
 */
import type { NetworkDevice } from './NetworkDevice'
import type { DeviceType } from './DeviceTypes'

export interface CdpNeighbor {
  deviceId: string          // Remote device hostname
  localPortId: string       // Our local port ID (physical port)
  localPortName: string     // Our local port display name
  remotePortId: string      // Remote port ID
  remotePortName: string    // Remote port display name
  platform: string          // Remote device platform string
  capabilities: string[]    // ['R'] = Router, ['S'] = Switch, ['H'] = Host
  softwareVersion: string   // IOS version string
  ipAddress: string | null  // Remote device mgmt IP
  holdTime: number          // Seconds before entry expires (180s default)
  nativeVlan: number | null
  duplex: string
}

export interface LldpNeighbor {
  systemName: string        // Remote hostname
  systemDescription: string
  chassisId: string         // Remote MAC address
  portId: string            // Remote port ID
  portDescription: string   // Remote port description
  localPortId: string       // Our local port ID
  localPortName: string     // Our local port name
  capabilities: string[]
  managementAddress: string | null
  ttl: number               // Default 120s
}

/** Map DeviceType to CDP platform string */
function getCdpPlatform(deviceType: DeviceType): string {
  switch (deviceType) {
    case 'router':       return 'Cisco IOS Software, C2900'
    case 'layer3switch': return 'Cisco IOS Software, C3750'
    case 'layer2switch': return 'Cisco IOS Software, C2960'
    case 'pc':           return 'PC'
    case 'server':       return 'Server'
    case 'firewall':     return 'Cisco ASA'
    case 'accesspoint':  return 'Cisco AIR-AP'
    case 'hub':          return 'Cisco Hub'
    default:             return 'Unknown Platform'
  }
}

/** Map DeviceType to CDP capabilities list */
function getCdpCapabilities(deviceType: DeviceType): string[] {
  switch (deviceType) {
    case 'router':       return ['R']
    case 'layer3switch': return ['R', 'S']
    case 'layer2switch': return ['S']
    case 'accesspoint':  return ['T']   // Trans-Bridge
    case 'hub':          return ['H']
    case 'pc':           return ['H']
    case 'server':       return ['H']
    case 'firewall':     return ['R', 'S']
    default:             return ['H']
  }
}

/** Map DeviceType to LLDP system description */
function getLldpSysDesc(deviceType: DeviceType): string {
  switch (deviceType) {
    case 'router':       return 'Cisco IOS Software, Version 15.1 - Router'
    case 'layer3switch': return 'Cisco IOS Software, Version 15.0 - L3 Switch'
    case 'layer2switch': return 'Cisco IOS Software, Version 12.2 - L2 Switch'
    case 'pc':           return 'End Station - PC'
    case 'server':       return 'End Station - Server'
    case 'firewall':     return 'Cisco Adaptive Security Appliance'
    case 'accesspoint':  return 'Cisco Wireless Access Point'
    default:             return 'Network Device'
  }
}

/** Map DeviceType to LLDP system capabilities */
function getLldpCapabilities(deviceType: DeviceType): string[] {
  switch (deviceType) {
    case 'router':       return ['Router']
    case 'layer3switch': return ['Bridge', 'Router']
    case 'layer2switch': return ['Bridge']
    case 'accesspoint':  return ['WLAN-AP', 'Bridge']
    case 'hub':          return ['Repeater']
    default:             return ['Station']
  }
}

/** Expand abbreviated capability codes to full strings for detail view */
export function expandCdpCapabilities(caps: string[]): string {
  const map: Record<string, string> = {
    R: 'Router', S: 'Switch', H: 'Host',
    T: 'Trans-Bridge', B: 'Source-Route-Bridge',
    I: 'IGMP', r: 'Repeater'
  }
  return caps.map(c => map[c] || c).join(', ')
}

/**
 * Build the CDP neighbor table for a given device by walking the physical topology.
 * This mirrors what a real device would learn via CDP multicast frames.
 */
export function buildCdpNeighbors(device: NetworkDevice): CdpNeighbor[] {
  const neighbors: CdpNeighbor[] = []

  for (const port of device.ports.values()) {
    if (!port.linkDetected || !port.remotePortId) continue

    const engine = device.engine
    if (!engine) continue

    const remotePort = engine.getPort(port.remotePortId)
    if (!remotePort) continue

    const remoteDevice = engine.getDevice(remotePort.deviceId)
    if (!remoteDevice) continue

    // Get management IP: first up interface with an IPv4 address
    let mgmtIp: string | null = null
    for (const intf of remoteDevice.interfaces.values()) {
      if (intf.ipAddress && intf.operStatus === 'up') {
        mgmtIp = intf.ipAddress
        break
      }
    }

    // Get local interface name matching this port
    let localIntfName = port.name
    for (const intf of device.interfaces.values()) {
      if (intf.connectedPortId === port.id || intf.parentPortId === port.id) {
        localIntfName = intf.name
        break
      }
    }

    // Get remote interface name matching the remote port
    let remoteIntfName = remotePort.name
    for (const intf of remoteDevice.interfaces.values()) {
      if (intf.connectedPortId === remotePort.id || intf.parentPortId === remotePort.id) {
        remoteIntfName = intf.name
        break
      }
    }

    neighbors.push({
      deviceId: remoteDevice.hostname,
      localPortId: port.id,
      localPortName: localIntfName,
      remotePortId: remotePort.id,
      remotePortName: remoteIntfName,
      platform: getCdpPlatform(remoteDevice.deviceType),
      capabilities: getCdpCapabilities(remoteDevice.deviceType),
      softwareVersion: `Cisco IOS Software, Version 15.1(4)M4`,
      ipAddress: mgmtIp,
      holdTime: 160, // ~27 minutes into a 180s hold time
      nativeVlan: 1,
      duplex: 'full',
    })
  }

  return neighbors
}

/**
 * Build the LLDP neighbor table for a given device by walking the physical topology.
 */
export function buildLldpNeighbors(device: NetworkDevice): LldpNeighbor[] {
  const neighbors: LldpNeighbor[] = []

  for (const port of device.ports.values()) {
    if (!port.linkDetected || !port.remotePortId) continue

    const engine = device.engine
    if (!engine) continue

    const remotePort = engine.getPort(port.remotePortId)
    if (!remotePort) continue

    const remoteDevice = engine.getDevice(remotePort.deviceId)
    if (!remoteDevice) continue

    // Management IP
    let mgmtIp: string | null = null
    for (const intf of remoteDevice.interfaces.values()) {
      if (intf.ipAddress && intf.operStatus === 'up') {
        mgmtIp = intf.ipAddress
        break
      }
    }

    // Chassis ID: use MAC from first interface, or construct from device id
    let chassisId = '00:00:00:00:00:00'
    const firstIntf = Array.from(remoteDevice.interfaces.values())[0]
    if (firstIntf) chassisId = firstIntf.macAddress

    // Local port display name
    let localIntfName = port.name
    for (const intf of device.interfaces.values()) {
      if (intf.connectedPortId === port.id || intf.parentPortId === port.id) {
        localIntfName = intf.name
        break
      }
    }

    // Remote port display name and description
    let remotePortName = remotePort.name
    let remotePortDesc = ''
    for (const intf of remoteDevice.interfaces.values()) {
      if (intf.connectedPortId === remotePort.id || intf.parentPortId === remotePort.id) {
        remotePortName = intf.name
        remotePortDesc = intf.description || intf.name
        break
      }
    }

    neighbors.push({
      systemName: remoteDevice.hostname,
      systemDescription: getLldpSysDesc(remoteDevice.deviceType),
      chassisId,
      portId: remotePortName,
      portDescription: remotePortDesc || remotePortName,
      localPortId: port.id,
      localPortName: localIntfName,
      capabilities: getLldpCapabilities(remoteDevice.deviceType),
      managementAddress: mgmtIp,
      ttl: 110,
    })
  }

  return neighbors
}
