import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Router } from '../Devices'
import { createInterface } from '../NetworkInterface'
import { createPort } from '../PhysicalPort'

describe('Layer 3 Configuration', () => {
  let engine: SimulationNetworkEngine
  let r1: Router

  beforeEach(() => {
    engine = new SimulationNetworkEngine()

    r1 = new Router('R1')
    engine.addDevice(r1)
    
    // R1 ports & interfaces
    engine.registerPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0'))
    const intf = createInterface('R1_G0/0_L', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', 'R1_G0/0')
    r1.addInterface(intf)
  })

  it('assigns an IP address and mask via CLI', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'interface G0/0')
    
    engine.executeCommand('R1', 'ip address 192.168.1.1 255.255.255.0')

    const intf = r1.getInterface('R1_G0/0_L')
    expect(intf?.ipAddress).toBe('192.168.1.1')
    expect(intf?.subnetMask).toBe('255.255.255.0')
  })

  it('assigns an IP address using CIDR notation via CLI', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'interface G0/0')
    
    engine.executeCommand('R1', 'ip address 10.0.0.1/8')

    const intf = r1.getInterface('R1_G0/0_L')
    expect(intf?.ipAddress).toBe('10.0.0.1')
    expect(intf?.subnetMask).toBe('255.0.0.0')
  })

  it('removes IP address via CLI', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'interface G0/0')
    engine.executeCommand('R1', 'ip address 192.168.1.1 255.255.255.0')
    engine.executeCommand('R1', 'no ip address')

    const intf = r1.getInterface('R1_G0/0_L')
    expect(intf?.ipAddress).toBeNull()
    expect(intf?.subnetMask).toBeNull()
  })

  it('updates the routing table when interface comes up', () => {
    // Interface starts admin down
    const intf = r1.getInterface('R1_G0/0_L')
    expect(intf?.adminStatus).toBe('down')

    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'interface G0/0')
    engine.executeCommand('R1', 'ip address 192.168.1.1 255.255.255.0')
    
    // Table should be empty because interface is down
    expect(r1.routingTable.length).toBe(0)

    // Force link detection so `no shutdown` brings operStatus to up
    const p = r1.getPort('R1_G0/0')
    if (p) p.linkDetected = true

    engine.executeCommand('R1', 'no shutdown')

    // Table should have a connected route for 192.168.1.0
    expect(r1.routingTable.length).toBe(1)
    expect(r1.routingTable[0].network).toBe('192.168.1.0')
    expect(r1.routingTable[0].mask).toBe('255.255.255.0')
    expect(r1.routingTable[0].protocol).toBe('connected')
    
    // Shutting it down removes the route
    engine.executeCommand('R1', 'shutdown')
    expect(r1.routingTable.length).toBe(0)
  })

  it('show ip interface brief displays updated IP and status', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'interface G0/0')
    engine.executeCommand('R1', 'ip address 192.168.1.1 255.255.255.0')
    
    const p = r1.getPort('R1_G0/0')
    if (p) p.linkDetected = true

    engine.executeCommand('R1', 'no shutdown')
    engine.executeCommand('R1', 'end')

    const out = engine.executeCommand('R1', 'show ip interface brief')
    expect(out).toContain('GigabitEthernet0/0')
    expect(out).toContain('192.168.1.1')
    expect(out).toContain('up')
  })
})
