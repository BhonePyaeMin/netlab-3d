import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Router, PC } from '../Devices'
import { createInterface } from '../NetworkInterface'
import { createPort } from '../PhysicalPort'
import type { EthernetFrame, IPv4Packet } from '../DataPlane'

describe('Static Routing', () => {
  let engine: SimulationNetworkEngine
  let r1: Router
  let r2: Router
  let pc1: PC
  let pc2: PC

  beforeEach(() => {
    engine = new SimulationNetworkEngine()

    r1 = new Router('R1')
    r2 = new Router('R2')
    pc1 = new PC('PC1')
    pc2 = new PC('PC2')

    engine.addDevice(r1)
    engine.addDevice(r2)
    engine.addDevice(pc1)
    engine.addDevice(pc2)

    // PC1 Config
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    const pc1Intf = createInterface('PC1_Eth0_L', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0')
    pc1Intf.ipAddress = '10.0.1.10'
    pc1Intf.subnetMask = '255.255.255.0'
    pc1Intf.adminStatus = 'up'
    pc1Intf.operStatus = 'up'
    pc1.addInterface(pc1Intf)

    // PC2 Config
    engine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))
    const pc2Intf = createInterface('PC2_Eth0_L', 'PC2', 'Ethernet0', 'FastEthernet', 'PC2_Eth0')
    pc2Intf.ipAddress = '10.0.2.10'
    pc2Intf.subnetMask = '255.255.255.0'
    pc2Intf.adminStatus = 'up'
    pc2Intf.operStatus = 'up'
    pc2.addInterface(pc2Intf)

    // R1 Config
    engine.registerPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0')) // Connects to PC1
    const r1g0 = createInterface('R1_G0/0_L', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', 'R1_G0/0')
    r1g0.ipAddress = '10.0.1.1'
    r1g0.subnetMask = '255.255.255.0'
    r1g0.adminStatus = 'up'
    r1g0.operStatus = 'up'
    r1.addInterface(r1g0)

    engine.registerPort(createPort('R1_G0/1', 'R1', 'GigabitEthernet0/1')) // Connects to R2
    const r1g1 = createInterface('R1_G0/1_L', 'R1', 'GigabitEthernet0/1', 'GigabitEthernet', 'R1_G0/1')
    r1g1.ipAddress = '192.168.1.1'
    r1g1.subnetMask = '255.255.255.252'
    r1g1.adminStatus = 'up'
    r1g1.operStatus = 'up'
    r1.addInterface(r1g1)

    // R2 Config
    engine.registerPort(createPort('R2_G0/0', 'R2', 'GigabitEthernet0/0')) // Connects to R1
    const r2g0 = createInterface('R2_G0/0_L', 'R2', 'GigabitEthernet0/0', 'GigabitEthernet', 'R2_G0/0')
    r2g0.ipAddress = '192.168.1.2'
    r2g0.subnetMask = '255.255.255.252'
    r2g0.adminStatus = 'up'
    r2g0.operStatus = 'up'
    r2.addInterface(r2g0)

    engine.registerPort(createPort('R2_G0/1', 'R2', 'GigabitEthernet0/1')) // Connects to PC2
    const r2g1 = createInterface('R2_G0/1_L', 'R2', 'GigabitEthernet0/1', 'GigabitEthernet', 'R2_G0/1')
    r2g1.ipAddress = '10.0.2.1'
    r2g1.subnetMask = '255.255.255.0'
    r2g1.adminStatus = 'up'
    r2g1.operStatus = 'up'
    r2.addInterface(r2g1)

    // Connections
    engine.connectCable('c1', 'PC1_Eth0', 'R1_G0/0')
    engine.connectCable('c2', 'R1_G0/1', 'R2_G0/0')
    engine.connectCable('c3', 'R2_G0/1', 'PC2_Eth0')

    // Force connected route update
    r1.updateConnectedRoutes()
    r2.updateConnectedRoutes()
  })

  it('Static routes are added and evaluated via CLI', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    
    // Add route via next hop
    engine.executeCommand('R1', 'ip route 10.0.2.0 255.255.255.0 192.168.1.2')
    
    // Check route is in staticRoutes
    expect(r1.staticRoutes.length).toBe(1)
    expect(r1.staticRoutes[0].network).toBe('10.0.2.0')
    expect(r1.staticRoutes[0].nextHop).toBe('192.168.1.2')
    expect(r1.staticRoutes[0].administrativeDistance).toBe(1)

    // Check route is active in routingTable because next hop is reachable
    const activeRoute = r1.routingTable.find(r => r.network === '10.0.2.0')
    expect(activeRoute).toBeDefined()
    
    // Remove route
    engine.executeCommand('R1', 'no ip route 10.0.2.0 255.255.255.0 192.168.1.2')
    expect(r1.staticRoutes.length).toBe(0)
    expect(r1.routingTable.find(r => r.network === '10.0.2.0')).toBeUndefined()
  })

  it('Static route disappears when exit interface goes down', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'ip route 10.0.2.0 255.255.255.0 GigabitEthernet0/1')
    
    expect(r1.routingTable.find(r => r.network === '10.0.2.0')).toBeDefined()

    // Shut down interface
    engine.executeCommand('R1', 'int g0/1')
    engine.executeCommand('R1', 'shutdown')

    // Route should disappear from active routing table, but remain in config (staticRoutes)
    expect(r1.routingTable.find(r => r.network === '10.0.2.0')).toBeUndefined()
    expect(r1.staticRoutes.find(r => r.network === '10.0.2.0')).toBeDefined()
  })

  it('Router forwards packet using longest prefix match', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    
    // Default route via R2
    engine.executeCommand('R1', 'ip route 0.0.0.0 0.0.0.0 192.168.1.2')
    
    // Specific route to 10.0.2.0 via R2
    engine.executeCommand('R1', 'ip route 10.0.2.0 255.255.255.0 192.168.1.2')

    // Seed ARP tables so routing doesn't drop due to unresolved ARP
    r1.arpTable.set('192.168.1.2', { ipAddress: '192.168.1.2', macAddress: 'R2_MAC', interfaceId: 'R1_G0/1_L', expiresAt: Infinity })
    r2.arpTable.set('10.0.2.10', { ipAddress: '10.0.2.10', macAddress: 'PC2_MAC', interfaceId: 'R2_G0/1_L', expiresAt: Infinity })

    let r2Received = false
    r2.receiveFrame = (portId, frame) => {
      if (frame.ethertype === 0x0800) {
        r2Received = true
      }
    }

    const pc1Intf = pc1.getInterface('PC1_Eth0_L')!
    const r1Intf = r1.getInterface('R1_G0/0_L')!

    const packet: IPv4Packet = {
      srcIp: '10.0.1.10',
      dstIp: '10.0.2.10',
      protocol: 1, // ICMP
      ttl: 64,
      payload: 'ping'
    }

    const frame: EthernetFrame = {
      srcMac: pc1Intf.macAddress,
      dstMac: r1Intf.macAddress,
      ethertype: 0x0800,
      payload: packet
    }

    // Transmit from PC1 to R1
    engine.transmitFrame('PC1', 'PC1_Eth0', frame)

    // R1 should receive it, route it to R2
    expect(r2Received).toBe(true)
  })
})
