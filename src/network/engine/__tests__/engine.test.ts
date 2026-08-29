import { describe, it, expect } from 'vitest'
import { Router }               from '../Devices'
import { createPort }           from '../PhysicalPort'
import { createInterface }      from '../NetworkInterface'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'

describe('Stage 1: Core Device Architecture', () => {

  it('instantiates a router with a unique ID and hostname', () => {
    const r1 = new Router('R1')
    expect(r1.id).toBe('R1')
    expect(r1.hostname).toBe('R1')
    expect(r1.deviceType).toBe('router')
    expect(r1.status).toBe('RUNNING')
  })

  it('binds physical ports and logical interfaces to a device', () => {
    const r1 = new Router('R1')

    // Create port
    const g00Port = createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0')
    r1.addPort(g00Port)

    // Create logical intf
    const g00Intf = createInterface('R1_intf_G0/0', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', g00Port.id)
    r1.addInterface(g00Intf)

    expect(r1.ports.get('R1_G0/0')?.name).toBe('GigabitEthernet0/0')
    expect(r1.interfaces.get('R1_intf_G0/0')?.type).toBe('physical')

    // Test default values of interface
    expect(g00Intf.macAddress).toBeDefined()
    expect(g00Intf.adminStatus).toBe('down')
    expect(g00Intf.operStatus).toBe('down')
    expect(g00Intf.speed).toBe(1000)
    expect(g00Intf.ipAddress).toBeNull()
  })

  it('manages device logs', () => {
    const r1 = new Router('R1')
    r1.log('%SYS-5-CONFIG_I: Configured from console by console')
    expect(r1.logs.length).toBe(1)
    expect(r1.logs[0]).toContain('SYS-5-CONFIG_I')
  })

  it('engine correctly connects physical ports and triggers link detection', () => {
    const engine = new SimulationNetworkEngine()

    const r1 = new Router('R1')
    const sw1 = new Router('SW1') // just using router for test simplicity

    engine.addDevice(r1)
    engine.addDevice(sw1)

    const r1Port = createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0')
    const sw1Port = createPort('SW1_F0/1', 'SW1', 'FastEthernet0/1')

    engine.registerPort(r1Port)
    engine.registerPort(sw1Port)

    // Initially down
    expect(r1Port.linkDetected).toBe(false)

    // Connect
    engine.connectCable('cable-1', r1Port.id, sw1Port.id)

    expect(r1Port.linkDetected).toBe(true)
    expect(r1Port.remotePortId).toBe('SW1_F0/1')
    expect(r1Port.connectedCableId).toBe('cable-1')

    expect(sw1Port.linkDetected).toBe(true)
    expect(sw1Port.remotePortId).toBe('R1_G0/0')

    // Verify logs were emitted to both devices
    expect(r1.logs.some(l => l.includes('%LINK-3-UPDOWN: Interface GigabitEthernet0/0, changed state to up'))).toBe(true)
    expect(sw1.logs.some(l => l.includes('%LINK-3-UPDOWN: Interface FastEthernet0/1, changed state to up'))).toBe(true)

    // Disconnect
    engine.disconnectCable(r1Port.id)

    expect(r1Port.linkDetected).toBe(false)
    expect(sw1Port.linkDetected).toBe(false)
    expect(r1.logs.some(l => l.includes('changed state to down'))).toBe(true)
    expect(sw1.logs.some(l => l.includes('changed state to down'))).toBe(true)
  })
})

describe('GNS3 Node Architecture', () => {
  it('correctly returns filtered port lists based on portType and name', () => {
    const r1 = new Router('R1')
    r1.addPort(createPort('R1_CON', 'R1', 'Console', 'console'))
    r1.addPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0', 'ethernet'))
    r1.addPort(createPort('R1_E0/0', 'R1', 'Ethernet0/0', 'ethernet'))
    r1.addPort(createPort('R1_S0/0/0', 'R1', 'Serial0/0/0', 'serial'))

    expect(r1.getConsolePort()?.name).toBe('Console')
    expect(r1.getGigabitEthernetPorts().length).toBe(1)
    expect(r1.getGigabitEthernetPorts()[0].name).toBe('GigabitEthernet0/0')
    expect(r1.getEthernetPorts().length).toBe(1)
    expect(r1.getEthernetPorts()[0].name).toBe('Ethernet0/0')
    expect(r1.getSerialPorts().length).toBe(1)
    expect(r1.getSerialPorts()[0].name).toBe('Serial0/0/0')
  })

  it('correctly filters unique MAC addresses', () => {
    const r1 = new Router('R1')
    const i1 = createInterface('int1', 'R1', 'G0/0', 'GigabitEthernet')
    const i2 = createInterface('int2', 'R1', 'G0/1', 'GigabitEthernet')
    
    // Force MACs
    i1.macAddress = 'AA:BB:CC:DD:EE:01'
    i2.macAddress = 'AA:BB:CC:DD:EE:02'
    
    r1.addInterface(i1)
    r1.addInterface(i2)

    const macs = r1.getMacAddresses()
    expect(macs).toEqual(['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02'])
  })
})
