import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Router, Layer2Switch } from '../Devices'
import { createPort } from '../PhysicalPort'
import { createInterface } from '../NetworkInterface'

describe('SimulationNetworkEngine - Topology', () => {
  let engine: SimulationNetworkEngine

  beforeEach(() => {
    engine = new SimulationNetworkEngine()

    const r1 = new Router('Router1')
    const sw1 = new Layer2Switch('Switch1')
    
    engine.addDevice(r1)
    engine.addDevice(sw1)

    // Register ports
    engine.registerPort(createPort('Router1_G0/0', 'Router1', 'GigabitEthernet0/0', 'ethernet', 1000))
    engine.registerPort(createPort('Switch1_F0/1', 'Switch1', 'FastEthernet0/1', 'ethernet', 100))

    // Register logical interfaces
    r1.addInterface(createInterface('R1_G0/0', 'Router1', 'GigabitEthernet0/0', 'GigabitEthernet', 'Router1_G0/0'))
  })

  it('registers devices and ports correctly', () => {
    expect(engine.getDevice('Router1')).toBeDefined()
    expect(engine.getPort('Router1_G0/0')).toBeDefined()
    expect(engine.getPort('Switch1_F0/1')).toBeDefined()
  })

  it('updates port states when a cable is connected', () => {
    engine.connectCable('cable-1', 'Router1_G0/0', 'Switch1_F0/1')

    const p1 = engine.getPort('Router1_G0/0')!
    const p2 = engine.getPort('Switch1_F0/1')!

    expect(p1.connectedCableId).toBe('cable-1')
    expect(p1.remotePortId).toBe('Switch1_F0/1')
    expect(p1.linkDetected).toBe(true)

    expect(p2.connectedCableId).toBe('cable-1')
    expect(p2.remotePortId).toBe('Router1_G0/0')
    expect(p2.linkDetected).toBe(true)

    // Check SimulationLink
    const link = engine.getLink('cable-1')
    expect(link).toBeDefined()
    expect(link?.portAId).toBe('Router1_G0/0')
    expect(link?.portBId).toBe('Switch1_F0/1')
    
    // Gig to FastEthernet should negotiate down to fastethernet (100)
    expect(link?.linkType).toBe('fastethernet')
    expect(link?.bandwidthMbps).toBe(100)

    // Check logical interface cascaded status
    const r1 = engine.getDevice('Router1')!
    const intf = r1.getInterface('R1_G0/0')!
    expect(intf.operStatus).toBe('up')
  })

  it('updates port states when a cable is disconnected', () => {
    engine.connectCable('cable-1', 'Router1_G0/0', 'Switch1_F0/1')
    engine.disconnectCable('Router1_G0/0')

    const p1 = engine.getPort('Router1_G0/0')!
    const p2 = engine.getPort('Switch1_F0/1')!

    expect(p1.connectedCableId).toBeNull()
    expect(p1.remotePortId).toBeNull()
    expect(p1.linkDetected).toBe(false)

    expect(p2.connectedCableId).toBeNull()
    expect(p2.remotePortId).toBeNull()
    expect(p2.linkDetected).toBe(false)

    expect(engine.getLink('cable-1')).toBeUndefined()

    // Check logical interface cascaded status
    const r1 = engine.getDevice('Router1')!
    const intf = r1.getInterface('R1_G0/0')!
    expect(intf.operStatus).toBe('down')
  })

  it('cascades device removal to connected cables', () => {
    engine.connectCable('cable-1', 'Router1_G0/0', 'Switch1_F0/1')
    expect(engine.getLink('cable-1')).toBeDefined()
    
    engine.removeDevice('Switch1')

    // Device should be gone
    expect(engine.getDevice('Switch1')).toBeUndefined()
    
    // Switch port should be gone from global lookup
    expect(engine.getPort('Switch1_F0/1')).toBeUndefined()
    
    // Link should be destroyed
    expect(engine.getLink('cable-1')).toBeUndefined()

    // Router 1 port should be disconnected and down
    const p1 = engine.getPort('Router1_G0/0')!
    expect(p1.connectedCableId).toBeNull()
    expect(p1.linkDetected).toBe(false)
  })

  it('updates device position and hostname', () => {
    engine.renameDevice('Router1', 'CoreRouter')
    expect(engine.getDevice('Router1')?.hostname).toBe('CoreRouter')

    engine.moveDevice('Router1', 10, 20, 30)
    expect(engine.getDevice('Router1')?.position).toEqual({ x: 10, y: 20, z: 30 })
  })
})
