import { describe, it, expect, beforeEach } from 'vitest'
import { simulationEngine } from './src/network/engine/globalEngine'
import { ProjectManager } from './src/network/engine/ProjectManager'
import { PC, Router } from './src/network/engine/Devices'
import { createInterface } from './src/network/engine/NetworkInterface'
import { createPort } from './src/network/engine/PhysicalPort'

describe('ProjectManager', () => {
  beforeEach(() => {
    simulationEngine.clear()
  })

  it('exports and imports a network project restoring all state', () => {
    // 1. Setup a mini topology
    const pc = new PC('PC1')
    const r1 = new Router('R1')
    
    simulationEngine.addDevice(pc)
    simulationEngine.addDevice(r1)

    simulationEngine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    simulationEngine.registerPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0'))

    pc.addInterface(createInterface('PC1_Ethernet0', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0'))
    r1.addInterface(createInterface('R1_GigabitEthernet0/0', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', 'R1_G0/0'))

    simulationEngine.connectCable('c1', 'PC1_Eth0', 'R1_G0/0')

    // Configure the devices
    simulationEngine.executeCommand('R1', 'enable\nconfigure terminal\ninterface GigabitEthernet0/0\nip address 192.168.1.1 255.255.255.0\nno shutdown\nexit\nend')
    simulationEngine.executeCommand('PC1', 'ip 192.168.1.10 255.255.255.0 192.168.1.1')

    // 2. Export Project
    const jsonStr = ProjectManager.exportProject()
    expect(jsonStr).toContain('PC1')
    expect(jsonStr).toContain('192.168.1.10') // Verify IP made it into running config
    expect(jsonStr).toContain('192.168.1.1')  // Verify R1 IP made it in
    expect(jsonStr).toContain('c1')           // Cable id

    // 3. Clear engine explicitly
    simulationEngine.clear()
    expect(simulationEngine.getDevices().length).toBe(0)
    expect(simulationEngine.getPorts().length).toBe(0)

    // 4. Import Project
    ProjectManager.importProject(jsonStr)

    // 5. Verify Restore
    expect(simulationEngine.getDevices().length).toBe(2)
    expect(simulationEngine.getPorts().length).toBe(2)
    expect(simulationEngine.getLinks().length).toBe(1)
    
    const restoredPc = simulationEngine.getDevice('PC1')
    expect(restoredPc).toBeDefined()
    
    const restoredR1 = simulationEngine.getDevice('R1')
    expect(restoredR1).toBeDefined()

    // Verify configurations applied
    const r1Intf = restoredR1!.getInterface('R1_GigabitEthernet0/0')
    expect(r1Intf?.ipAddress).toBe('192.168.1.1')
    expect(r1Intf?.operStatus).toBe('up')

    const pcIntf = restoredPc!.getInterface('PC1_Ethernet0')
    expect(pcIntf?.ipAddress).toBe('192.168.1.10')
  })
})
