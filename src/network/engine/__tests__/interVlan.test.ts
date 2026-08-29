import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Router, Layer3Switch, Layer2Switch, PC } from '../Devices'
import { createInterface } from '../NetworkInterface'
import { createPort } from '../PhysicalPort'

describe('Inter-VLAN Routing', () => {
  let engine: SimulationNetworkEngine

  beforeEach(() => {
    engine = new SimulationNetworkEngine()
  })

  it('routes traffic between VLANs using Router-on-a-Stick', () => {
    const pc1 = new PC('PC1'); engine.addDevice(pc1)
    const pc2 = new PC('PC2'); engine.addDevice(pc2)
    const sw1 = new Layer2Switch('SW1'); engine.addDevice(sw1)
    const r1 = new Router('R1'); engine.addDevice(r1)

    // PC1 setup (VLAN 10)
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    const pc1Intf = createInterface('PC1_Eth0_L', 'PC1', 'Ethernet0', 'Ethernet', 'PC1_Eth0')
    pc1Intf.ipAddress = '192.168.10.10'; pc1Intf.subnetMask = '255.255.255.0'
    pc1Intf.adminStatus = 'up'; pc1Intf.operStatus = 'up'; pc1.addInterface(pc1Intf)
    pc1.routingTable.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '192.168.10.1', metric: 1, administrativeDistance: 1, protocol: 'static' })

    // PC2 setup (VLAN 20)
    engine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))
    const pc2Intf = createInterface('PC2_Eth0_L', 'PC2', 'Ethernet0', 'Ethernet', 'PC2_Eth0')
    pc2Intf.ipAddress = '192.168.20.10'; pc2Intf.subnetMask = '255.255.255.0'
    pc2Intf.adminStatus = 'up'; pc2Intf.operStatus = 'up'; pc2.addInterface(pc2Intf)
    pc2.routingTable.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '192.168.20.1', metric: 1, administrativeDistance: 1, protocol: 'static' })

    // SW1 setup
    engine.registerPort(createPort('SW1_F0/1', 'SW1', 'FastEthernet0/1'))
    sw1.addInterface(createInterface('SW1_F0/1_L', 'SW1', 'FastEthernet0/1', 'FastEthernet', 'SW1_F0/1'))
    engine.registerPort(createPort('SW1_F0/2', 'SW1', 'FastEthernet0/2'))
    sw1.addInterface(createInterface('SW1_F0/2_L', 'SW1', 'FastEthernet0/2', 'FastEthernet', 'SW1_F0/2'))
    engine.registerPort(createPort('SW1_G0/1', 'SW1', 'GigabitEthernet0/1'))
    sw1.addInterface(createInterface('SW1_G0/1_L', 'SW1', 'GigabitEthernet0/1', 'GigabitEthernet', 'SW1_G0/1'))

    engine.executeCommand('SW1', 'enable')
    engine.executeCommand('SW1', 'conf t')
    engine.executeCommand('SW1', 'vlan 10')
    engine.executeCommand('SW1', 'vlan 20')
    engine.executeCommand('SW1', 'exit')

    engine.executeCommand('SW1', 'int f0/1')
    engine.executeCommand('SW1', 'switchport mode access')
    engine.executeCommand('SW1', 'switchport access vlan 10')
    engine.executeCommand('SW1', 'no shut')
    engine.executeCommand('SW1', 'exit')

    engine.executeCommand('SW1', 'int f0/2')
    engine.executeCommand('SW1', 'switchport mode access')
    engine.executeCommand('SW1', 'switchport access vlan 20')
    engine.executeCommand('SW1', 'no shut')
    engine.executeCommand('SW1', 'exit')

    engine.executeCommand('SW1', 'int g0/1')
    engine.executeCommand('SW1', 'switchport mode trunk')
    engine.executeCommand('SW1', 'switchport trunk allowed vlan all')
    engine.executeCommand('SW1', 'no shut')

    // R1 setup
    engine.registerPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0'))
    r1.addInterface(createInterface('R1_intf_G0/0', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', 'R1_G0/0'))
    
    // Configure physical interface
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'int g0/0')
    engine.executeCommand('R1', 'no shut')
    engine.executeCommand('R1', 'exit')
    
    // Configure Subinterfaces
    engine.executeCommand('R1', 'int g0/0.10')
    engine.executeCommand('R1', 'encapsulation dot1q 10')
    engine.executeCommand('R1', 'ip address 192.168.10.1 255.255.255.0')
    engine.executeCommand('R1', 'exit')
    
    engine.executeCommand('R1', 'int g0/0.20')
    engine.executeCommand('R1', 'encapsulation dot1q 20')
    engine.executeCommand('R1', 'ip address 192.168.20.1 255.255.255.0')

    // Connect them
    engine.connectCable('c1', 'PC1_Eth0', 'SW1_F0/1')
    engine.connectCable('c2', 'PC2_Eth0', 'SW1_F0/2')
    engine.connectCable('c3', 'SW1_G0/1', 'R1_G0/0')
    
    // Set link states explicitly since we mocked some ARPs
    for (const i of r1.interfaces.values()) { i.operStatus = 'up'; i.adminStatus = 'up' }
    r1.updateConnectedRoutes()

    r1.arpTable.set('192.168.10.10', { ipAddress: '192.168.10.10', macAddress: 'PC1_MAC', interfaceId: Array.from(r1.interfaces.values()).find(i => i.name === 'GigabitEthernet0/0.10')!.id, expiresAt: Infinity })
    r1.arpTable.set('192.168.20.10', { ipAddress: '192.168.20.10', macAddress: 'PC2_MAC', interfaceId: Array.from(r1.interfaces.values()).find(i => i.name === 'GigabitEthernet0/0.20')!.id, expiresAt: Infinity })

    // Mock MACs
    pc1Intf.macAddress = 'PC1_MAC'
    pc2Intf.macAddress = 'PC2_MAC'
    for (const i of r1.interfaces.values()) i.macAddress = 'R1_MAC'
    
    // Set link states explicitly since we mocked some ARPs
    for (const i of r1.interfaces.values()) { i.operStatus = 'up'; i.adminStatus = 'up' }
    r1.updateConnectedRoutes()

    let receivedPacket: any = null
    const originalReceive = pc2.receiveFrame.bind(pc2)
    pc2.receiveFrame = (portId, frame) => {
      if (frame.ethertype === 0x0800) {
        receivedPacket = frame.payload
      }
      originalReceive(portId, frame)
    }

    // Send packet PC1 -> PC2
    engine.transmitFrame('PC1', 'PC1_Eth0', {
      srcMac: 'PC1_MAC',
      dstMac: 'R1_MAC',
      ethertype: 0x0800,
      payload: {
        srcIp: '192.168.10.10',
        dstIp: '192.168.20.10',
        protocol: 'icmp',
        ttl: 64,
        payload: 'ping'
      }
    })

    expect(receivedPacket).toBeTruthy()
    expect(receivedPacket.srcIp).toBe('192.168.10.10')
    expect(receivedPacket.dstIp).toBe('192.168.20.10')
    expect(receivedPacket.ttl).toBe(63) // Router decremented TTL
  })

  it('routes traffic between SVIs on a Layer 3 Switch', () => {
    const pc1 = new PC('PC1'); engine.addDevice(pc1)
    const pc2 = new PC('PC2'); engine.addDevice(pc2)
    const sw1 = new Layer3Switch('SW1'); engine.addDevice(sw1)

    // PC1 setup (VLAN 10)
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    const pc1Intf = createInterface('PC1_Eth0_L', 'PC1', 'Ethernet0', 'Ethernet', 'PC1_Eth0')
    pc1Intf.ipAddress = '192.168.10.10'; pc1Intf.subnetMask = '255.255.255.0'
    pc1Intf.adminStatus = 'up'; pc1Intf.operStatus = 'up'; pc1.addInterface(pc1Intf)
    pc1.routingTable.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '192.168.10.1', metric: 1, administrativeDistance: 1, protocol: 'static' })

    // PC2 setup (VLAN 20)
    engine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))
    const pc2Intf = createInterface('PC2_Eth0_L', 'PC2', 'Ethernet0', 'Ethernet', 'PC2_Eth0')
    pc2Intf.ipAddress = '192.168.20.10'; pc2Intf.subnetMask = '255.255.255.0'
    pc2Intf.adminStatus = 'up'; pc2Intf.operStatus = 'up'; pc2.addInterface(pc2Intf)
    pc2.routingTable.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '192.168.20.1', metric: 1, administrativeDistance: 1, protocol: 'static' })

    // SW1 setup
    engine.registerPort(createPort('SW1_F0/1', 'SW1', 'FastEthernet0/1'))
    sw1.addInterface(createInterface('SW1_F0/1_L', 'SW1', 'FastEthernet0/1', 'FastEthernet', 'SW1_F0/1'))
    engine.registerPort(createPort('SW1_F0/2', 'SW1', 'FastEthernet0/2'))
    sw1.addInterface(createInterface('SW1_F0/2_L', 'SW1', 'FastEthernet0/2', 'FastEthernet', 'SW1_F0/2'))

    engine.executeCommand('SW1', 'enable')
    engine.executeCommand('SW1', 'conf t')
    engine.executeCommand('SW1', 'vlan 10')
    engine.executeCommand('SW1', 'vlan 20')
    engine.executeCommand('SW1', 'exit')

    engine.executeCommand('SW1', 'int f0/1')
    engine.executeCommand('SW1', 'switchport mode access')
    engine.executeCommand('SW1', 'switchport access vlan 10')
    engine.executeCommand('SW1', 'no shut')
    engine.executeCommand('SW1', 'exit')

    engine.executeCommand('SW1', 'int f0/2')
    engine.executeCommand('SW1', 'switchport mode access')
    engine.executeCommand('SW1', 'switchport access vlan 20')
    engine.executeCommand('SW1', 'no shut')
    engine.executeCommand('SW1', 'exit')

    // Configure SVIs
    engine.executeCommand('SW1', 'int vlan 10')
    engine.executeCommand('SW1', 'ip address 192.168.10.1 255.255.255.0')
    engine.executeCommand('SW1', 'no shut')
    engine.executeCommand('SW1', 'exit')
    
    engine.executeCommand('SW1', 'int vlan 20')
    engine.executeCommand('SW1', 'ip address 192.168.20.1 255.255.255.0')
    engine.executeCommand('SW1', 'no shut')
    engine.executeCommand('SW1', 'exit')

    // Connect them
    engine.connectCable('c1', 'PC1_Eth0', 'SW1_F0/1')
    engine.connectCable('c2', 'PC2_Eth0', 'SW1_F0/2')

    // MACs
    const svi = Array.from(sw1.interfaces.values()).find(i => i.type === 'svi')
    const sviMac = svi ? svi.macAddress : '00:00:00:11:11:11'
    
    pc1.arpTable.set('192.168.10.1', { ipAddress: '192.168.10.1', macAddress: sviMac, interfaceId: pc1Intf.id, expiresAt: Infinity })
    pc2.arpTable.set('192.168.20.1', { ipAddress: '192.168.20.1', macAddress: sviMac, interfaceId: pc2Intf.id, expiresAt: Infinity })
    
    if (svi) {
      sw1.arpTable.set('192.168.10.10', { ipAddress: '192.168.10.10', macAddress: 'PC1_MAC', interfaceId: Array.from(sw1.interfaces.values()).find(i => i.name === 'Vlan10')!.id, expiresAt: Infinity })
      sw1.arpTable.set('192.168.20.10', { ipAddress: '192.168.20.10', macAddress: 'PC2_MAC', interfaceId: Array.from(sw1.interfaces.values()).find(i => i.name === 'Vlan20')!.id, expiresAt: Infinity })
    }

    pc1Intf.macAddress = 'PC1_MAC'
    pc2Intf.macAddress = 'PC2_MAC'
    
    for (const i of sw1.interfaces.values()) { i.operStatus = 'up'; i.adminStatus = 'up' }
    sw1.updateConnectedRoutes()
    
    // Populate MAC table for SW1
    sw1.macTable.set('10-PC1_MAC', { macAddress: 'PC1_MAC', portId: 'SW1_F0/1', expiresAt: Infinity })
    sw1.macTable.set('20-PC2_MAC', { macAddress: 'PC2_MAC', portId: 'SW1_F0/2', expiresAt: Infinity })

    let receivedPacket: any = null
    const originalReceive = pc2.receiveFrame.bind(pc2)
    pc2.receiveFrame = (portId, frame) => {
      if (frame.ethertype === 0x0800) {
        receivedPacket = frame.payload
      }
      originalReceive(portId, frame)
    }

    // Send packet PC1 -> PC2
    engine.transmitFrame('PC1', 'PC1_Eth0', {
      srcMac: 'PC1_MAC',
      dstMac: sviMac,
      ethertype: 0x0800,
      payload: {
        srcIp: '192.168.10.10',
        dstIp: '192.168.20.10',
        protocol: 'icmp',
        ttl: 64,
        payload: 'ping'
      }
    })

    expect(receivedPacket).toBeTruthy()
    expect(receivedPacket.srcIp).toBe('192.168.10.10')
    expect(receivedPacket.dstIp).toBe('192.168.20.10')
    expect(receivedPacket.ttl).toBe(63) // Switch decremented TTL
  })
})
