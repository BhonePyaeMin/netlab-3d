import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { PC } from '../Devices'
import { createInterface } from '../NetworkInterface'
import { createPort } from '../PhysicalPort'

describe('VPCS CLI Parser (PC specific commands)', () => {
  let engine: SimulationNetworkEngine
  let pc1: PC

  beforeEach(() => {
    engine = new SimulationNetworkEngine()
    pc1 = new PC('PC1')
    
    // Add port and interface
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    pc1.addInterface(createInterface('PC1_Eth0_Intf', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0'))
    
    engine.addDevice(pc1)
  })

  it('configures IP using CIDR format', () => {
    const out = engine.executeCommand('PC1', 'ip 192.168.10.10/24 192.168.10.1')
    expect(out).toContain('Checking for duplicate IPv4 address')
    
    const intf = pc1.getInterface('PC1_Eth0_Intf')!
    expect(intf.ipAddress).toBe('192.168.10.10')
    expect(intf.subnetMask).toBe('255.255.255.0')
    expect(pc1.defaultGateway).toBe('192.168.10.1')
    
    // Ensure default route is added
    const defRoute = pc1.staticRoutes.find(r => r.network === '0.0.0.0' && r.mask === '0.0.0.0')
    expect(defRoute).toBeDefined()
    expect(defRoute?.nextHop).toBe('192.168.10.1')
  })

  it('configures IP using subnet mask format', () => {
    const out = engine.executeCommand('PC1', 'ip 192.168.10.10 255.255.255.0 192.168.10.1')
    expect(out).toContain('Checking for duplicate IPv4 address')
    
    const intf = pc1.getInterface('PC1_Eth0_Intf')!
    expect(intf.ipAddress).toBe('192.168.10.10')
    expect(intf.subnetMask).toBe('255.255.255.0')
    expect(pc1.defaultGateway).toBe('192.168.10.1')
  })

  it('handles the show ip command', () => {
    engine.executeCommand('PC1', 'ip 192.168.10.10/24 192.168.10.1')
    
    const out1 = engine.executeCommand('PC1', 'show ip')
    expect(out1).toContain('NAME        : PC1')
    expect(out1).toContain('IP/MASK     : 192.168.10.10/24')
    expect(out1).toContain('GATEWAY     : 192.168.10.1')
    // We don't have a guaranteed mock MAC here, but let's check it renders it
    expect(out1).toContain('MAC         :')
    
    // Check just 'ip' alone acts like 'show ip'
    const out2 = engine.executeCommand('PC1', 'ip')
    expect(out2).toBe(out1)
  })

  it('configures IP via DHCP', () => {
    const out = engine.executeCommand('PC1', 'ip dhcp')
    expect(out).toContain('DDORA')
    
    const intf = pc1.getInterface('PC1_Eth0_Intf')!
    expect(intf.ipAddress).toBe('dhcp')
    expect(intf.subnetMask).toBeUndefined()
    expect(pc1.defaultGateway).toBeNull()
  })

  it('rejects invalid IP configurations', () => {
    expect(engine.executeCommand('PC1', 'ip 999.999.999.999/24 192.168.10.1')).toBe('Invalid IP address')
    expect(engine.executeCommand('PC1', 'ip 192.168.1.1 999.999.999.999 192.168.1.254')).toBe('Invalid subnet mask')
    expect(engine.executeCommand('PC1', 'ip 192.168.1.1/24 999.999.999.999')).toBe('Invalid gateway')
    expect(engine.executeCommand('PC1', 'ip 192.168.1.1/99 192.168.1.254')).toBe('Invalid subnet mask')
  })

  it('rejects non-VPCS commands', () => {
    expect(engine.executeCommand('PC1', 'conf t')).toContain('Invalid input detected')
    expect(engine.executeCommand('PC1', 'show run')).toContain('Invalid input detected')
  })
})
