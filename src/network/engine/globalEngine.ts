import { SimulationNetworkEngine } from './SimulationNetworkEngine'
import { Router, Layer2Switch, PC, Server } from './Devices'
import { createPort } from './PhysicalPort'
import { createInterface } from './NetworkInterface'
import { NetworkStore } from '../NetworkStore'

export const simulationEngine = new SimulationNetworkEngine()


/**
 * Seed the global simulation engine with the physical topology
 * that matches the 3D lab environment.
 */
export function initTopology() {
  // Use spawnDeviceToEngine for all initial devices to properly initialize ports, interfaces, and 3D positioning
  spawnDeviceToEngine('Router', [-4, 0.75, -1.8], 'Router1')
  spawnDeviceToEngine('Router', [-4, 0.75, 4.5], 'Router2')
  
  spawnDeviceToEngine('Switch', [4, 0.75, -1.8], 'Switch1')
  spawnDeviceToEngine('Switch', [4, 0.75, 4.5], 'Switch2')
  
  spawnDeviceToEngine('PC', [0, 0.75, -1.8], 'PC1')
  spawnDeviceToEngine('PC', [0, 0.75, 4.5], 'PC2')
  


  // Spawn 5 cables on the desks
  const colors = ['#ff3333', '#3366ff', '#33cc33', '#ff9900', '#9900ff']
  const cablePositions: [number, number, number][] = [
    [-4.5, 0.78, -1.8], [-4.5, 0.78, 4.5], [-0.5, 0.78, -1.8], [-0.5, 0.78, 4.5], [3.5, 0.78, -1.8]
  ]
  cablePositions.forEach((pos, i) => {
    NetworkStore.spawnCable({
      id: `cable-init-${i}`,
      color: colors[i],
      status: 'coiled',
      endpointA: null,
      endpointB: null,
      spawnPosition: pos
    })
  })

  console.log('[NetLab Engine] Topology initialized.')
}

/**
 * Bridge captured packets from the engine into the reactive store.
 *
 * This lives here rather than in NetworkStore's constructor because the two
 * modules import each other: whichever is the entry of the graph sees the
 * other's exports as undefined while its own body runs. By the time this
 * deferred callback fires, both module bodies have finished evaluating.
 */
function wirePacketCapture() {
  simulationEngine.onPacketCaptured = (packet) => {
    NetworkStore.addCapturedPacket(packet)
  }
}

// Automatically initialize on import, delayed to avoid circular dependency
setTimeout(() => {
  wirePacketCapture()
  initTopology()
}, 0)

const deviceCounters: Record<string, number> = { Router: 0, Switch: 0, PC: 0, Server: 0 }

/**
 * Spawns a new device dynamically from the UI, adds it to the simulation engine, 
 * creates its physical interfaces/ports, registers the ports with the NetworkStore,
 * and then registers the device itself for 3D rendering.
 */
export function spawnDeviceToEngine(type: 'Router' | 'Switch' | 'PC', position: [number, number, number], exactId?: string): string {
  let nextId = exactId
  if (!nextId) {
    deviceCounters[type]++
    const prefix = { Router: 'R', Switch: 'SW', PC: 'PC' }[type]
    nextId = `${prefix}${deviceCounters[type]}`
  }

  let device: import('./NetworkDevice').NetworkDevice
  
  // Define ports configuration array for the device model
  const portsConfig: { prefix: string; labelFormat: string; type: 'GigabitEthernet' | 'FastEthernet' | 'Ethernet'; count: number; startIndex: number }[] = []
  let hasConsole = false
  
  if (type === 'Router') {
    device = new Router(nextId, nextId)
    portsConfig.push({ prefix: 'GigabitEthernet0/', labelFormat: 'Gi0/', type: 'GigabitEthernet', count: 5, startIndex: 0 })
    hasConsole = true
  } else if (type === 'Switch') {
    device = new Layer2Switch(nextId, nextId)
    portsConfig.push({ prefix: 'FastEthernet0/', labelFormat: 'Fa0/', type: 'FastEthernet', count: 8, startIndex: 1 })
  } else if (type === 'PC') {
    device = new PC(nextId, nextId)
    portsConfig.push({ prefix: 'Ethernet', labelFormat: 'Eth', type: 'Ethernet', count: 2, startIndex: 0 })
  } else {
    return nextId
  }
  
  simulationEngine.addDevice(device)
  
  if (hasConsole) {
    const conPort = { id: `${nextId}_CON`, deviceId: nextId, portType: 'console' as const, connectedCableId: null, label: `${nextId} Console`, worldPosition: position }
    device.addPort(conPort as any)
    NetworkStore.registerPort(conPort)
  }
  
  for (const config of portsConfig) {
    for (let i = 0; i < config.count; i++) {
      const idx = config.startIndex + i
      const pName = `${config.prefix}${idx}`
      const pId = `${nextId}_${pName.replace('/', '_')}`
      const pLabel = `${nextId} ${config.labelFormat}${idx}`
      
      // Register physical port with engine & UI
      const physicalPort = { id: pId, deviceId: nextId, portType: 'ethernet' as const, connectedCableId: null, label: pLabel, worldPosition: position }
      device.addPort(physicalPort as any)
      NetworkStore.registerPort(physicalPort)
      
      // Add logical interface
      const intf = createInterface(pId, nextId, pName, config.type, pId)
      // Dynamic devices are spawned 'down' unconfigured, just like real hardware
      device.addInterface(intf)
    }
  }
  
  // Register with 3D scene
  NetworkStore.spawnDynamicDevice(nextId, type, position)
  
  return nextId
}
