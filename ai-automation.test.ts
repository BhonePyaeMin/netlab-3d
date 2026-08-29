import { describe, it, expect } from 'vitest'
import { simulationEngine } from './src/network/engine/globalEngine'
import { PC, Router } from './src/network/engine/Devices'

describe('AI Dashboard Network Configuration Automation', () => {
  it('automates device discovery, configuration, and verification', () => {
    console.log('--- AI Dashboard Network Configuration Automation ---\n')

    // 1. Identify Target Devices
    const pc1 = simulationEngine.getDevice('PC1') as PC
    const r1 = simulationEngine.getDevice('Router1') as Router
    
    expect(pc1).toBeDefined()
    expect(r1).toBeDefined()

    // Ensure they are connected for this test without destroying other topology
    const pc1Port = Array.from(pc1.ports.values())[0]
    if (!pc1Port.connectedCableId) {
      console.log('Connecting PC1 to Router1 for testing...')
      simulationEngine.connectCable('cable-pc1-r1', pc1Port.id, 'Router1_G0/0')
    }

    // 2. Detect actual interface connected to PC1
    const pc1ConnectedPortId = pc1Port.remotePortId
    expect(pc1ConnectedPortId).toBeTruthy()
    
    const connectedPort = simulationEngine.getPort(pc1ConnectedPortId!)
    expect(connectedPort?.deviceId).toBe('Router1')

    // Find logical interface on R1 that maps to this physical port
    const r1Interface = Array.from(r1.interfaces.values()).find(i => i.connectedPortId === pc1ConnectedPortId)
    expect(r1Interface).toBeDefined()

    const r1InterfaceName = r1Interface!.name
    console.log(`Detected connected interface on R1: ${r1InterfaceName}\n`)

    // 3. Configure PC1 (VPCS)
    console.log('--- Configuring PC1 ---')
    console.log(simulationEngine.executeCommand('PC1', 'ip 192.168.10.10 255.255.255.0 192.168.10.1'))
    console.log(simulationEngine.executeCommand('PC1', 'save')) // New save command
    
    // 4. Configure R1 (Cisco)
    console.log('\n--- Configuring Router1 ---')
    simulationEngine.executeCommand('Router1', 'enable')
    simulationEngine.executeCommand('Router1', 'configure terminal')
    simulationEngine.executeCommand('Router1', `interface ${r1InterfaceName}`)
    simulationEngine.executeCommand('Router1', 'ip address 192.168.10.1 255.255.255.0')
    simulationEngine.executeCommand('Router1', 'no shutdown')
    simulationEngine.executeCommand('Router1', 'end')
    console.log(simulationEngine.executeCommand('Router1', 'write memory'))

    // 5. Verification
    console.log('\n--- Verifying Configuration ---')
    console.log('\n[PC1] show ip:')
    const showIp = simulationEngine.executeCommand('PC1', 'show ip')
    console.log(showIp)
    expect(showIp).toContain('192.168.10.10')
    expect(showIp).toContain('192.168.10.1')

    console.log('\n[Router1] show ip interface brief:')
    const showInt = simulationEngine.executeCommand('Router1', 'show ip interface brief')
    console.log(showInt)
    expect(showInt).toContain('192.168.10.1')

    // 6. Connectivity Test
    console.log('\n--- Connectivity Test ---')
    console.log('[PC1] ping 192.168.10.1')
    
    // Advance simulation time to let ARP and ping complete
    const pingOutput = simulationEngine.executeCommand('PC1', 'ping 192.168.10.1')
    simulationEngine.tick(100)
    
    console.log(pingOutput)
    expect(pingOutput).toContain('!!!')
  })
})

