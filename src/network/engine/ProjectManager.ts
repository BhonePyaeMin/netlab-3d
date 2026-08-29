import { simulationEngine } from './globalEngine'
import { Router, Layer2Switch, PC, Server } from './Devices'
import { createPort } from './PhysicalPort'
import { createInterface } from './NetworkInterface'

export interface SerializedProject {
  version: string
  devices: {
    id: string
    hostname: string
    deviceType: string
    position: { x: number; y: number; z: number }
    runningConfig: string
  }[]
  ports: {
    id: string
    deviceId: string
    name: string
    type?: string
  }[]
  interfaces: {
    id: string
    deviceId: string
    name: string
    type: string
    connectedPortId?: string
    parentPortId?: string
  }[]
  links: {
    cableId: string
    portAId: string
    portBId: string
  }[]
}

export class ProjectManager {
  static exportProject(): string {
    const devices = simulationEngine.getDevices().map(d => ({
      id: d.id,
      hostname: d.hostname,
      deviceType: d.deviceType,
      position: d.position,
      runningConfig: d.generateRunningConfig()
    }))

    const ports = simulationEngine.getPorts().map(p => ({
      id: p.id,
      deviceId: p.deviceId,
      name: p.name,
      type: p.type
    }))

    const interfaces: any[] = []
    for (const d of simulationEngine.getDevices()) {
      for (const i of d.interfaces.values()) {
        interfaces.push({
          id: i.id,
          deviceId: d.id,
          name: i.name,
          type: i.type,
          connectedPortId: i.connectedPortId,
          parentPortId: i.parentPortId
        })
      }
    }

    const links = simulationEngine.getLinks().map(l => ({
      cableId: l.id,
      portAId: l.portAId,
      portBId: l.portBId
    }))

    const project: SerializedProject = {
      version: '1.0',
      devices,
      ports,
      interfaces,
      links
    }

    return JSON.stringify(project, null, 2)
  }

  static importProject(jsonString: string) {
    const project: SerializedProject = JSON.parse(jsonString)
    
    // 1. Clear Engine
    simulationEngine.clear()

    // 2. Re-instantiate Devices
    for (const d of project.devices) {
      let device;
      switch (d.deviceType) {
        case 'router': device = new Router(d.id, d.hostname); break;
        case 'switch': device = new Layer2Switch(d.id, d.hostname); break;
        case 'pc': device = new PC(d.id, d.hostname); break;
        case 'server': device = new Server(d.id, d.hostname); break;
        default: throw new Error(`Unknown device type: ${d.deviceType}`);
      }
      device.position = d.position
      simulationEngine.addDevice(device)
    }

    // 3. Re-create physical ports
    for (const p of project.ports) {
      const port = createPort(p.id, p.deviceId, p.name, p.type as any)
      simulationEngine.registerPort(port)
    }

    // 4. Re-create logical interfaces
    for (const i of project.interfaces) {
      const device = simulationEngine.getDevice(i.deviceId)
      if (device) {
        // If it's a subinterface we pass parentPortId, if physical we pass connectedPortId
        const portId = i.type === 'subinterface' ? i.parentPortId : i.connectedPortId
        const intf = createInterface(i.id, i.deviceId, i.name, i.type as any, portId)
        device.addInterface(intf)
      }
    }

    // 5. Connect cables
    for (const l of project.links) {
      simulationEngine.connectCable(l.cableId, l.portAId, l.portBId)
    }

    // 6. Apply configurations
    for (const d of project.devices) {
      if (d.runningConfig) {
        simulationEngine.executeCommand(d.id, 'enable')
        simulationEngine.executeCommand(d.id, 'configure terminal')
        simulationEngine.executeCommand(d.id, d.runningConfig)
      }
    }
  }
}
