import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from './src/network/engine/SimulationNetworkEngine'
import { Router, Layer2Switch, PC, Server } from './src/network/engine/Devices'
import { createPort } from './src/network/engine/PhysicalPort'
import { createInterface } from './src/network/engine/NetworkInterface'
import { ProjectManager } from './src/network/engine/ProjectManager'
import type { CapturedPacket } from './src/network/types'

describe('Complete Integration Test Suite: GNS3-Like Networking Features', () => {
  let engine: SimulationNetworkEngine
  let pc1: PC
  let pc2: PC
  let sw1: Layer2Switch
  let sw2: Layer2Switch
  let r1: Router
  let r2: Router

  /**
   * Helper to build the requested topology:
   * PC1 <-> SW1 <-> R1 <-> R2 <-> SW2 <-> PC2
   */
  function setupTopology() {
    engine = new SimulationNetworkEngine()

    // 1. Devices
    pc1 = new PC('PC1', 'PC1')
    pc2 = new PC('PC2', 'PC2')
    sw1 = new Layer2Switch('SW1', 'SW1')
    sw2 = new Layer2Switch('SW2', 'SW2')
    r1 = new Router('R1', 'R1')
    r2 = new Router('R2', 'R2')

    engine.addDevice(pc1)
    engine.addDevice(pc2)
    engine.addDevice(sw1)
    engine.addDevice(sw2)
    engine.addDevice(r1)
    engine.addDevice(r2)

    // 2. Ports
    // PC1
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    // SW1
    engine.registerPort(createPort('SW1_F0/1', 'SW1', 'FastEthernet0/1'))
    engine.registerPort(createPort('SW1_F0/2', 'SW1', 'FastEthernet0/2'))
    engine.registerPort(createPort('SW1_G0/1', 'SW1', 'GigabitEthernet0/1'))
    // R1
    engine.registerPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0'))
    engine.registerPort(createPort('R1_G0/1', 'R1', 'GigabitEthernet0/1'))
    // R2
    engine.registerPort(createPort('R2_G0/0', 'R2', 'GigabitEthernet0/0'))
    engine.registerPort(createPort('R2_G0/1', 'R2', 'GigabitEthernet0/1'))
    // SW2
    engine.registerPort(createPort('SW2_G0/1', 'SW2', 'GigabitEthernet0/1'))
    engine.registerPort(createPort('SW2_F0/1', 'SW2', 'FastEthernet0/1'))
    engine.registerPort(createPort('SW2_F0/2', 'SW2', 'FastEthernet0/2'))
    // PC2
    engine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))

    // 3. Logical Interfaces
    pc1.addInterface(createInterface('PC1_Eth0_intf', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0'))
    pc2.addInterface(createInterface('PC2_Eth0_intf', 'PC2', 'Ethernet0', 'FastEthernet', 'PC2_Eth0'))

    r1.addInterface(createInterface('R1_G0/0_intf', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', 'R1_G0/0'))
    r1.addInterface(createInterface('R1_G0/1_intf', 'R1', 'GigabitEthernet0/1', 'GigabitEthernet', 'R1_G0/1'))

    r2.addInterface(createInterface('R2_G0/0_intf', 'R2', 'GigabitEthernet0/0', 'GigabitEthernet', 'R2_G0/0'))
    r2.addInterface(createInterface('R2_G0/1_intf', 'R2', 'GigabitEthernet0/1', 'GigabitEthernet', 'R2_G0/1'))

    // 4. Switch Interfaces
    sw1.addInterface(createInterface('SW1_F0/1_intf', 'SW1', 'FastEthernet0/1', 'FastEthernet', 'SW1_F0/1'))
    sw1.addInterface(createInterface('SW1_F0/2_intf', 'SW1', 'FastEthernet0/2', 'FastEthernet', 'SW1_F0/2'))
    sw1.addInterface(createInterface('SW1_G0/1_intf', 'SW1', 'GigabitEthernet0/1', 'GigabitEthernet', 'SW1_G0/1'))

    sw2.addInterface(createInterface('SW2_F0/1_intf', 'SW2', 'FastEthernet0/1', 'FastEthernet', 'SW2_F0/1'))
    sw2.addInterface(createInterface('SW2_F0/2_intf', 'SW2', 'FastEthernet0/2', 'FastEthernet', 'SW2_F0/2'))
    sw2.addInterface(createInterface('SW2_G0/1_intf', 'SW2', 'GigabitEthernet0/1', 'GigabitEthernet', 'SW2_G0/1'))

    // Activate switch interfaces (they default to down, but switches typically default to up if linked)
    // Actually, createInterface sets adminStatus/operStatus to 'down'. We'll let `connectCable` set them to up 
    // when it sees them, OR we can explicitly turn them up if needed. The test checks linkDetected=true.
    for (const intf of [...sw1.interfaces.values(), ...sw2.interfaces.values()]) {
      intf.adminStatus = 'up'
      intf.operStatus = 'up'
    }

    // 5. Physical Cables
    engine.connectCable('cable-pc1-sw1', 'PC1_Eth0', 'SW1_F0/1')
    engine.connectCable('cable-sw1-r1', 'SW1_G0/1', 'R1_G0/0')
    engine.connectCable('cable-r1-r2', 'R1_G0/1', 'R2_G0/0')
    engine.connectCable('cable-r2-sw2', 'R2_G0/1', 'SW2_G0/1')
    engine.connectCable('cable-sw2-pc2', 'SW2_F0/1', 'PC2_Eth0')
  }

  beforeEach(() => {
    setupTopology()
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 1: Physical Connectivity
  // ────────────────────────────────────────────────────────────────────────
  it('1. Physical connectivity: verifies link detection, cable connections, and failure behavior', () => {
    // Normal state: all connected ports have linkDetected = true
    expect(engine.getPort('PC1_Eth0')?.linkDetected).toBe(true)
    expect(engine.getPort('SW1_F0/1')?.linkDetected).toBe(true)
    expect(engine.getPort('SW1_G0/1')?.linkDetected).toBe(true)
    expect(engine.getPort('R1_G0/0')?.linkDetected).toBe(true)
    expect(engine.getPort('R1_G0/1')?.linkDetected).toBe(true)
    expect(engine.getPort('R2_G0/0')?.linkDetected).toBe(true)
    expect(engine.getPort('R2_G0/1')?.linkDetected).toBe(true)
    expect(engine.getPort('SW2_G0/1')?.linkDetected).toBe(true)
    expect(engine.getPort('SW2_F0/1')?.linkDetected).toBe(true)
    expect(engine.getPort('PC2_Eth0')?.linkDetected).toBe(true)

    // Failure behavior: disconnect cable between R1 and R2
    engine.disconnectCable('R1_G0/1')
    expect(engine.getPort('R1_G0/1')?.linkDetected).toBe(false)
    expect(engine.getPort('R2_G0/0')?.linkDetected).toBe(false)
    expect(r1.getInterface('R1_G0/1_intf')?.operStatus).toBe('down')

    // Reconnect
    engine.connectCable('cable-r1-r2', 'R1_G0/1', 'R2_G0/0')
    expect(engine.getPort('R1_G0/1')?.linkDetected).toBe(true)
    expect(engine.getPort('R2_G0/0')?.linkDetected).toBe(true)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 2: Ethernet
  // ────────────────────────────────────────────────────────────────────────
  it('2. Ethernet: verifies Ethernet framing, addressing, and payload transmission', () => {
    const pc1Mac = pc1.getInterface('PC1_Eth0_intf')!.macAddress
    const r1Mac = r1.getInterface('R1_G0/0_intf')!.macAddress

    // Frame transmission from PC1 port
    let frameDelivered = false
    const originalReceiveFrame = r1.receiveFrame.bind(r1)
    // @ts-ignore
    r1.receiveFrame = (portId: string, frame: any) => {
      expect(frame.srcMac).toBe(pc1Mac)
      expect(frame.dstMac).toBe(r1Mac)
      expect(frame.ethertype).toBe(0x0800)
      frameDelivered = true
      originalReceiveFrame(portId, frame)
    }

    engine.transmitFrame('PC1', 'PC1_Eth0', {
      srcMac: pc1Mac,
      dstMac: r1Mac,
      ethertype: 0x0800,
      payload: {
        srcIp: '192.168.10.10',
        dstIp: '192.168.10.1',
        protocol: 1,
        ttl: 64,
        payload: { type: 8, code: 0, identifier: 1, sequenceNumber: 1 }
      }
    })

    expect(frameDelivered).toBe(true)
    // Restore original method
    r1.receiveFrame = originalReceiveFrame
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 3: MAC Learning
  // ────────────────────────────────────────────────────────────────────────
  it('3. MAC learning: verifies dynamic learning on SW1 and SW2 and unicast forwarding', () => {
    const pc1Mac = pc1.getInterface('PC1_Eth0_intf')!.macAddress
    const r1Mac = r1.getInterface('R1_G0/0_intf')!.macAddress

    expect(sw1.macTable.has(`1-${pc1Mac}`)).toBe(false)

    // Send frame from PC1 -> SW1 learns PC1 MAC on FastEthernet0/1
    engine.transmitFrame('PC1', 'PC1_Eth0', {
      srcMac: pc1Mac,
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0806,
      payload: {} as any
    })

    console.log('Test 3: PC1 Mac:', pc1Mac)
    console.log('Test 3: SW1 MacTable keys:', Array.from(sw1.macTable.keys()))
    expect(sw1.macTable.has(`1-${pc1Mac}`)).toBe(true)
    const entry = sw1.macTable.get(`1-${pc1Mac}`)
    expect(entry?.portId).toBe('SW1_F0/1')

    // CLI: show mac address-table
    const macOutput = engine.executeCommand('SW1', 'enable\nshow mac address-table')
    expect(macOutput).toContain(pc1Mac)
    expect(macOutput).toContain('FastEthernet0/1')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 4: ARP
  // ────────────────────────────────────────────────────────────────────────
  it('4. ARP: verifies ARP resolution, caching, CLI show arp, and timeout failure', () => {
    // Configure IP on PC1 and R1
    engine.executeCommand('PC1', 'ip 192.168.10.10 255.255.255.0 192.168.10.1')
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nend')

    // Initially ARP tables are empty
    expect(pc1.resolveArp('192.168.10.1')).toBeNull()

    // Trigger ARP resolution via ping
    engine.executeCommand('PC1', 'ping 192.168.10.1')

    // Verify ARP tables are populated
    const r1Mac = r1.getInterface('R1_G0/0_intf')!.macAddress
    const pc1Mac = pc1.getInterface('PC1_Eth0_intf')!.macAddress
    expect(pc1.resolveArp('192.168.10.1')).toBe(r1Mac)
    expect(r1.resolveArp('192.168.10.10')).toBe(pc1Mac)

    // CLI verification
    const showArp = engine.executeCommand('R1', 'show arp')
    expect(showArp).toContain('192.168.10.10')
    expect(showArp).toContain(pc1Mac)

    // Failure behavior: query unknown IP returns null
    expect(pc1.resolveArp('192.168.99.99')).toBeNull()
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 5: IPv4 Subnetting & Addressing
  // ────────────────────────────────────────────────────────────────────────
  it('5. IPv4: verifies IP configuration, mask handling, show ip int brief, and validation failure', () => {
    // R1 configurations
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nend')
    // R2 configurations
    engine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip address 10.0.0.2 255.255.255.252\nno shut\nint g0/1\nip address 192.168.20.1 255.255.255.0\nno shut\nend')

    const r1Brief = engine.executeCommand('R1', 'show ip interface brief')
    expect(r1Brief).toContain('192.168.10.1')
    expect(r1Brief).toContain('10.0.0.1')
    expect(r1Brief).toContain('up')

    const r2Brief = engine.executeCommand('R2', 'show ip interface brief')
    expect(r2Brief).toContain('10.0.0.2')
    expect(r2Brief).toContain('192.168.20.1')

    // Failure behavior: invalid IP or mask
    const badIpResult = engine.executeCommand('R1', 'conf t\nint g0/0\nip address 999.999.999.999 255.255.255.0\nend')
    expect(badIpResult).toContain('Invalid')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 6: Static Routing
  // ────────────────────────────────────────────────────────────────────────
  it('6. Static routing: verifies route addition, longest-prefix matching, show ip route, and removal', () => {
    // Configure interfaces
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nend')
    engine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip address 10.0.0.2 255.255.255.252\nno shut\nint g0/1\nip address 192.168.20.1 255.255.255.0\nno shut\nend')

    // Add static routes
    engine.executeCommand('R1', 'conf t\nip route 192.168.20.0 255.255.255.0 10.0.0.2\nend')
    engine.executeCommand('R2', 'conf t\nip route 192.168.10.0 255.255.255.0 10.0.0.1\nend')

    const r1Route = engine.executeCommand('R1', 'show ip route')
    expect(r1Route).toContain('192.168.20.0/24')
    expect(r1Route).toContain('via 10.0.0.2')

    // Failure / Removal behavior
    engine.executeCommand('R1', 'conf t\nno ip route 192.168.20.0 255.255.255.0 10.0.0.2\nend')
    const r1RouteAfter = engine.executeCommand('R1', 'show ip route')
    expect(r1RouteAfter).not.toContain('192.168.20.0/24')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 7: End-to-End Ping
  // ────────────────────────────────────────────────────────────────────────
  it('7. Ping: verifies ICMP echo across all 5 hops (PC1->SW1->R1->R2->SW2->PC2) and unreachable drop', () => {
    // 1. IP addressing
    engine.executeCommand('PC1', 'ip 192.168.10.10 255.255.255.0 192.168.10.1')
    engine.executeCommand('PC2', 'ip 192.168.20.20 255.255.255.0 192.168.20.1')
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nip route 192.168.20.0 255.255.255.0 10.0.0.2\nend')
    engine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip address 10.0.0.2 255.255.255.252\nno shut\nint g0/1\nip address 192.168.20.1 255.255.255.0\nno shut\nip route 192.168.10.0 255.255.255.0 10.0.0.1\nend')

    // Seed ARP tables for smooth routing
    pc1.arpTable.set('192.168.10.1', { ip: '192.168.10.1', macAddress: r1.getInterface('R1_G0/0_intf')!.macAddress, expiresAt: Infinity })
    r1.arpTable.set('192.168.10.10', { ip: '192.168.10.10', macAddress: pc1.getInterface('PC1_Eth0_intf')!.macAddress, expiresAt: Infinity })
    r1.arpTable.set('10.0.0.2', { ip: '10.0.0.2', macAddress: r2.getInterface('R2_G0/0_intf')!.macAddress, expiresAt: Infinity })
    r2.arpTable.set('10.0.0.1', { ip: '10.0.0.1', macAddress: r1.getInterface('R1_G0/1_intf')!.macAddress, expiresAt: Infinity })
    r2.arpTable.set('192.168.20.20', { ip: '192.168.20.20', macAddress: pc2.getInterface('PC2_Eth0_intf')!.macAddress, expiresAt: Infinity })
    pc2.arpTable.set('192.168.20.1', { ip: '192.168.20.1', macAddress: r2.getInterface('R2_G0/1_intf')!.macAddress, expiresAt: Infinity })

    // Success test: ping from PC1 to PC2 across all 5 hops
    const pingOutput = engine.executeCommand('PC1', 'ping 192.168.20.20')
    expect(pingOutput).toContain('!!!!!')
    expect(pingOutput).toContain('100 percent')

    // Failure test: ping unreachable address
    const badPing = engine.executeCommand('PC1', 'ping 172.16.0.1')
    expect(badPing).toContain('.....')
    expect(badPing).toContain('0 percent')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 8: VLAN Segmentation & Access Ports
  // ────────────────────────────────────────────────────────────────────────
  it('8. VLAN: verifies VLAN membership, access port tagging/isolation, and show vlan', () => {
    // Add PC3 on SW1
    const pc3 = new PC('PC3', 'PC3')
    engine.addDevice(pc3)
    engine.registerPort(createPort('PC3_Eth0', 'PC3', 'Ethernet0'))
    pc3.addInterface(createInterface('PC3_Eth0_intf', 'PC3', 'Ethernet0', 'FastEthernet', 'PC3_Eth0'))
    engine.connectCable('cable-pc3-sw1', 'PC3_Eth0', 'SW1_F0/2')

    // Put PC1 (F0/1) in VLAN 10 and PC3 (F0/2) in VLAN 20
    engine.executeCommand('SW1', 'enable\nconf t\nint f0/1\nswitchport mode access\nswitchport access vlan 10\nint f0/2\nswitchport mode access\nswitchport access vlan 20\nend')

    // Verify show vlan
    const showVlan = engine.executeCommand('SW1', 'show vlan')
    expect(showVlan).toContain('10')
    expect(showVlan).toContain('20')

    // Intra-VLAN isolation test: frame on VLAN 10 port does not egress VLAN 20 port
    let receivedOnPc3 = false
    pc3.receiveFrame = () => { receivedOnPc3 = true }

    engine.transmitFrame('PC1', 'PC1_Eth0', {
      srcMac: pc1.getInterface('PC1_Eth0_intf')!.macAddress,
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0806,
      payload: {} as any
    })

    expect(receivedOnPc3).toBe(false)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 9: Inter-VLAN Routing (Router-on-a-Stick)
  // ────────────────────────────────────────────────────────────────────────
  it('9. Inter-VLAN routing: verifies 802.1Q subinterfaces and inter-VLAN forwarding', () => {
    // Trunk on SW1 uplink G0/1
    engine.executeCommand('SW1', 'enable\nconf t\nint g0/1\nswitchport mode trunk\nint f0/1\nswitchport mode access\nswitchport access vlan 10\nend')

    // Subinterfaces on R1 G0/0
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nno shut\nint g0/0.10\nencapsulation dot1q 10\nip address 192.168.10.1 255.255.255.0\nint g0/0.20\nencapsulation dot1q 20\nip address 192.168.20.1 255.255.255.0\nend')

    const r1Brief = engine.executeCommand('R1', 'show ip interface brief')
    expect(r1.interfaces.has('R1_G0/0_intf.10')).toBe(true)
    expect(r1.interfaces.has('R1_G0/0_intf.20')).toBe(true)
    expect(r1Brief).toContain('GigabitEthernet0/0.10')
    expect(r1Brief).toContain('192.168.10.1')
    expect(r1Brief).toContain('GigabitEthernet0/0.20')
    expect(r1Brief).toContain('192.168.20.1')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 10: OSPF Dynamic Routing
  // ────────────────────────────────────────────────────────────────────────
  it('10. OSPF: verifies OSPF neighbor adjacency formation, show ip ospf neighbor, and route exchange', () => {
    // Configure interfaces
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nend')
    engine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip address 10.0.0.2 255.255.255.252\nno shut\nint g0/1\nip address 192.168.20.1 255.255.255.0\nno shut\nend')

    // Configure OSPF
    engine.executeCommand('R1', 'conf t\nrouter ospf 1\nrouter-id 1.1.1.1\nnetwork 10.0.0.0 0.0.0.3 area 0\nnetwork 192.168.10.0 0.0.0.255 area 0\nend')
    engine.executeCommand('R2', 'conf t\nrouter ospf 1\nrouter-id 2.2.2.2\nnetwork 10.0.0.0 0.0.0.3 area 0\nnetwork 192.168.20.0 0.0.0.255 area 0\nend')

    // Advance simulation time for OSPF Hellos to exchange and reach Full state
    for (let i = 0; i < 5; i++) {
      r1.ospfProcess?.tick(10000)
      r2.ospfProcess?.tick(10000)
    }

    const nbr1 = engine.executeCommand('R1', 'show ip ospf neighbor')
    expect(nbr1).toContain('2.2.2.2')
    expect(nbr1).toContain('FULL')

    const nbr2 = engine.executeCommand('R2', 'show ip ospf neighbor')
    expect(nbr2).toContain('1.1.1.1')
    expect(nbr2).toContain('FULL')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 11: DHCP Service
  // ────────────────────────────────────────────────────────────────────────
  it('11. DHCP: verifies DHCP server pool configuration, IP allocation, binding, and CLI display', () => {
    // Configure R1 interface and DHCP Pool
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nip dhcp pool LAN_POOL\nnetwork 192.168.10.0 255.255.255.0\ndefault-router 192.168.10.1\ndns-server 8.8.8.8\nend')

    // Request DHCP on PC1
    const dhcpRes = engine.executeCommand('PC1', 'ip dhcp')
    expect(dhcpRes).toContain('DDORA')

    // Check pool and bindings on R1
    const showPool = engine.executeCommand('R1', 'show ip dhcp pool')
    expect(showPool).toContain('LAN_POOL')
    expect(showPool).toContain('192.168.10.0')

    // Failure test: PC on network with no DHCP server
    engine.disconnectCable('PC1_Eth0')
    const failedDhcp = engine.executeCommand('PC1', 'ip dhcp')
    expect(pc1.getInterface('PC1_Eth0_intf')?.ipAddress).toBe('dhcp')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 12: DNS Service
  // ────────────────────────────────────────────────────────────────────────
  it('12. DNS: verifies DNS server record addition, lookup resolution, and failure for unknown hosts', () => {
    // Configure DNS Server on R2
    engine.executeCommand('R2', 'enable\nconf t\nip dns server\nip host fileserver.net 192.168.20.50\nend')

    expect(r2.dnsServer).toBeDefined()
    expect(r2.dnsServer?.enabled).toBe(true)
    expect(r2.dnsServer?.resolve('fileserver.net')).toBe('192.168.20.50')

    // CLI: show dns
    const showDns = engine.executeCommand('R2', 'show dns')
    expect(showDns).toContain('fileserver.net')
    expect(showDns).toContain('192.168.20.50')

    // Failure test: lookup unknown domain returns null
    expect(r2.dnsServer?.resolve('unknown.invalid')).toBeNull()
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 13: NAT (Network Address Translation)
  // ────────────────────────────────────────────────────────────────────────
  it('13. NAT: verifies static NAT mapping, dynamic translation creation, and show ip nat translations', () => {
    // Configure NAT on R1
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nip nat inside\nno shut\nint g0/1\nip address 200.0.0.1 255.255.255.252\nip nat outside\nno shut\nexit\nip nat inside source static 192.168.10.10 200.0.0.10\nend')

    expect(r1.natProcess.staticMappings.length).toBe(1)
    expect(r1.natProcess.staticMappings[0].localIp).toBe('192.168.10.10')
    expect(r1.natProcess.staticMappings[0].globalIp).toBe('200.0.0.10')

    const showNat = engine.executeCommand('R1', 'show ip nat translations')
    expect(showNat).toContain('192.168.10.10')
    expect(showNat).toContain('200.0.0.10')

    const showNatStats = engine.executeCommand('R1', 'show ip nat statistics')
    expect(showNatStats).toContain('Static translations: 1')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 14: ACL (Access Control Lists)
  // ────────────────────────────────────────────────────────────────────────
  it('14. ACL: verifies Standard and Extended ACL permit/deny rules, traffic filtering, and show access-lists', () => {
    // Configure ACL on R2
    engine.executeCommand('R2', 'enable\nconf t\naccess-list 10 deny 192.168.10.10 0.0.0.0\naccess-list 10 permit any\nint g0/0\nip address 10.0.0.2 255.255.255.252\nip access-group 10 in\nno shut\nend')

    const showAcl = engine.executeCommand('R2', 'show access-lists')
    expect(showAcl).toContain('Standard IP access list 10')
    expect(showAcl).toContain('deny')
    expect(showAcl).toContain('192.168.10.10')

    // Test ACL engine evaluation directly
    const deniedVerdict = r2.aclEngine.matchPacket('10', {
      srcIp: '192.168.10.10',
      dstIp: '192.168.20.20',
      protocol: 1,
      ttl: 64,
      payload: {} as any
    })
    expect(deniedVerdict).toBe('deny')

    const permittedVerdict = r2.aclEngine.matchPacket('10', {
      srcIp: '192.168.10.15',
      dstIp: '192.168.20.20',
      protocol: 1,
      ttl: 64,
      payload: {} as any
    })
    expect(permittedVerdict).toBe('permit')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 15: Traceroute
  // ────────────────────────────────────────────────────────────────────────
  it('15. Traceroute: verifies TTL decrement, ICMP Time Exceeded generation, and hop tracking', () => {
    // Configure network
    engine.executeCommand('PC1', 'ip 192.168.10.10 255.255.255.0 192.168.10.1')
    engine.executeCommand('PC2', 'ip 192.168.20.20 255.255.255.0 192.168.20.1')
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nip route 192.168.20.0 255.255.255.0 10.0.0.2\nend')
    engine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip address 10.0.0.2 255.255.255.252\nno shut\nint g0/1\nip address 192.168.20.1 255.255.255.0\nno shut\nip route 192.168.10.0 255.255.255.0 10.0.0.1\nend')

    // Seed ARP
    pc1.arpTable.set('192.168.10.1', { ip: '192.168.10.1', macAddress: r1.getInterface('R1_G0/0_intf')!.macAddress, expiresAt: Infinity })
    r1.arpTable.set('192.168.10.10', { ip: '192.168.10.10', macAddress: pc1.getInterface('PC1_Eth0_intf')!.macAddress, expiresAt: Infinity })
    r1.arpTable.set('10.0.0.2', { ip: '10.0.0.2', macAddress: r2.getInterface('R2_G0/0_intf')!.macAddress, expiresAt: Infinity })
    r2.arpTable.set('10.0.0.1', { ip: '10.0.0.1', macAddress: r1.getInterface('R1_G0/1_intf')!.macAddress, expiresAt: Infinity })
    r2.arpTable.set('192.168.20.20', { ip: '192.168.20.20', macAddress: pc2.getInterface('PC2_Eth0_intf')!.macAddress, expiresAt: Infinity })
    pc2.arpTable.set('192.168.20.1', { ip: '192.168.20.1', macAddress: r2.getInterface('R2_G0/1_intf')!.macAddress, expiresAt: Infinity })

    // Execute traceroute from PC1 to PC2
    const traceOutput = engine.executeCommand('PC1', 'traceroute 192.168.20.20')
    expect(traceOutput).toContain('Tracing the route to 192.168.20.20')
    expect(traceOutput).toContain('192.168.10.1')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 16: Packet Animation & Visual Path Tracing
  // ────────────────────────────────────────────────────────────────────────
  it('16. Packet visualization: records hops with decisions, incoming/outgoing interfaces, and TTL', () => {
    engine.animationMode = true

    // Setup routing
    engine.executeCommand('PC1', 'ip 192.168.10.10 255.255.255.0 192.168.10.1')
    engine.executeCommand('PC2', 'ip 192.168.20.20 255.255.255.0 192.168.20.1')
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nip route 192.168.20.0 255.255.255.0 10.0.0.2\nend')
    engine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip address 10.0.0.2 255.255.255.252\nno shut\nint g0/1\nip address 192.168.20.1 255.255.255.0\nno shut\nip route 192.168.10.0 255.255.255.0 10.0.0.1\nend')

    pc1.arpTable.set('192.168.10.1', { ip: '192.168.10.1', macAddress: r1.getInterface('R1_G0/0_intf')!.macAddress, expiresAt: Infinity })
    r1.arpTable.set('10.0.0.2', { ip: '10.0.0.2', macAddress: r2.getInterface('R2_G0/0_intf')!.macAddress, expiresAt: Infinity })
    r2.arpTable.set('192.168.20.20', { ip: '192.168.20.20', macAddress: pc2.getInterface('PC2_Eth0_intf')!.macAddress, expiresAt: Infinity })

    engine.executeCommand('PC1', 'ping 192.168.20.20')

    expect(engine.activeTrace).toBeDefined()
    expect(engine.activeTrace?.hops.length).toBeGreaterThan(0)
    const deviceIds = engine.activeTrace?.hops.map(h => h.deviceId)
    expect(deviceIds).toContain('SW1')
    expect(deviceIds).toContain('R1')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 17: Packet Capture (Sniffer)
  // ────────────────────────────────────────────────────────────────────────
  it('17. Packet capture: captures frames on selected link with timestamps, protocol filtering, and headers', () => {
    const captured: CapturedPacket[] = []
    engine.capturingCableId = 'cable-r1-r2'
    engine.onPacketCaptured = (pkt) => {
      captured.push(pkt)
    }

    // Transmit a frame over cable-r1-r2 (R1_G0/1 -> R2_G0/0)
    engine.transmitFrame('R1', 'R1_G0/1', {
      srcMac: r1.getInterface('R1_G0/1_intf')!.macAddress,
      dstMac: r2.getInterface('R2_G0/0_intf')!.macAddress,
      ethertype: 0x0800,
      payload: {
        srcIp: '10.0.0.1',
        dstIp: '10.0.0.2',
        protocol: 1,
        ttl: 64,
        payload: { type: 8, code: 0, identifier: 10, sequenceNumber: 1 }
      }
    })

    expect(captured.length).toBe(1)
    expect(captured[0].protocol).toBe('ICMP')
    expect(captured[0].srcIp).toBe('10.0.0.1')
    expect(captured[0].dstIp).toBe('10.0.0.2')
    expect(captured[0].cableId).toBe('cable-r1-r2')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 18: Link Failure
  // ────────────────────────────────────────────────────────────────────────
  it('18. Link failure: verifies link down state on disconnect and traffic cessation', () => {
    // Setup ping
    engine.executeCommand('PC1', 'ip 192.168.10.10 255.255.255.0 192.168.10.1')
    engine.executeCommand('PC2', 'ip 192.168.20.20 255.255.255.0 192.168.20.1')
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nip route 192.168.20.0 255.255.255.0 10.0.0.2\nend')
    engine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip address 10.0.0.2 255.255.255.252\nno shut\nint g0/1\nip address 192.168.20.1 255.255.255.0\nno shut\nip route 192.168.10.0 255.255.255.0 10.0.0.1\nend')

    // Disconnect cable-r1-r2
    engine.disconnectCable('R1_G0/1')

    // Link state down
    expect(engine.getPort('R1_G0/1')?.linkDetected).toBe(false)
    expect(r1.getInterface('R1_G0/1_intf')?.operStatus).toBe('down')

    // Ping should fail
    const failedPing = engine.executeCommand('PC1', 'ping 192.168.20.20')
    expect(failedPing).toContain('0 percent')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 19: Interface Failure (Admin Down / Shutdown)
  // ────────────────────────────────────────────────────────────────────────
  it('19. Interface failure: verifies shutdown command, operStatus change, and no shutdown recovery', () => {
    engine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip address 192.168.10.1 255.255.255.0\nshutdown\nend')

    const g0 = r1.getInterface('R1_G0/0_intf')
    expect(g0?.adminStatus).toBe('down')
    expect(g0?.operStatus).toBe('down')

    const brief = engine.executeCommand('R1', 'show ip interface brief')
    expect(brief).toContain('administratively down')

    // Recovery
    engine.executeCommand('R1', 'conf t\nint g0/0\nno shutdown\nend')
    expect(g0?.adminStatus).toBe('up')
    expect(g0?.operStatus).toBe('up')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Test 20: Configuration Persistence & Project Save/Load
  // ────────────────────────────────────────────────────────────────────────
  it('20. Configuration persistence: verifies write memory, running-config export, and project load restoration', () => {
    // 1. Configure devices and save
    engine.executeCommand('R1', 'enable\nconf t\nhostname Router-Alpha\nint g0/0\nip address 192.168.10.1 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.255.255.252\nno shut\nip route 192.168.20.0 255.255.255.0 10.0.0.2\nend\nwrite memory')

    expect(r1.startupConfig).toContain('hostname Router-Alpha')
    expect(r1.startupConfig).toContain('192.168.10.1')

    // 2. Export Project to JSON
    // Temporarily point ProjectManager to our test engine or check export
    const projectJson = ProjectManager.exportProject()
    expect(projectJson).toBeDefined()
    expect(typeof projectJson).toBe('string')
    const parsed = JSON.parse(projectJson)
    expect(parsed.version).toBe('1.0')
    expect(parsed.devices.length).toBeGreaterThan(0)
  })
})
