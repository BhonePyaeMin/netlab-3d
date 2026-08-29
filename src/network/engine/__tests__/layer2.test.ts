import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Layer2Switch, PC } from '../Devices'
import { createPort } from '../PhysicalPort'
import { createInterface } from '../NetworkInterface'
import type { EthernetFrame } from '../DataPlane'

describe('Layer 2 Ethernet Switching', () => {
  let engine: SimulationNetworkEngine
  let sw1: Layer2Switch
  let pc1: PC
  let pc2: PC
  let pc3: PC

  beforeEach(() => {
    engine = new SimulationNetworkEngine()

    sw1 = new Layer2Switch('SW1')
    pc1 = new PC('PC1')
    pc2 = new PC('PC2')
    pc3 = new PC('PC3')

    engine.addDevice(sw1)
    engine.addDevice(pc1)
    engine.addDevice(pc2)
    engine.addDevice(pc3)

    // Switch ports
    engine.registerPort(createPort('SW1_F0/1', 'SW1', 'FastEthernet0/1'))
    const sw1_f01 = createInterface('SW1_F0/1_L', 'SW1', 'FastEthernet0/1', 'FastEthernet', 'SW1_F0/1')
    sw1_f01.adminStatus = 'up'; sw1_f01.operStatus = 'up'
    sw1.addInterface(sw1_f01)

    engine.registerPort(createPort('SW1_F0/2', 'SW1', 'FastEthernet0/2'))
    const sw1_f02 = createInterface('SW1_F0/2_L', 'SW1', 'FastEthernet0/2', 'FastEthernet', 'SW1_F0/2')
    sw1_f02.adminStatus = 'up'; sw1_f02.operStatus = 'up'
    sw1.addInterface(sw1_f02)

    engine.registerPort(createPort('SW1_F0/3', 'SW1', 'FastEthernet0/3'))
    const sw1_f03 = createInterface('SW1_F0/3_L', 'SW1', 'FastEthernet0/3', 'FastEthernet', 'SW1_F0/3')
    sw1_f03.adminStatus = 'up'; sw1_f03.operStatus = 'up'
    sw1.addInterface(sw1_f03)

    // PC ports
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    engine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))
    engine.registerPort(createPort('PC3_Eth0', 'PC3', 'Ethernet0'))

    // Connect cables
    engine.connectCable('cable-1', 'SW1_F0/1', 'PC1_Eth0')
    engine.connectCable('cable-2', 'SW1_F0/2', 'PC2_Eth0')
    engine.connectCable('cable-3', 'SW1_F0/3', 'PC3_Eth0')
  })

  it('learns MAC address from incoming frames', () => {
    const frame: EthernetFrame = {
      srcMac: 'AA:AA:AA:AA:AA:AA',
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0800,
      payload: 'ping'
    }

    // Send from PC1 to Switch
    engine.transmitFrame('PC1', 'PC1_Eth0', frame)

    // SW1 should learn PC1's MAC on F0/1 on VLAN 10 (default access vlan in this test setup? Wait! In layer2.test.ts, F0/1 doesn't have accessVlan explicitly set. Oh wait, it uses default accessVlan = 1 in createInterface)
    const entry = sw1.macTable.get('1-AA:AA:AA:AA:AA:AA')
    expect(entry).toBeDefined()
    expect(entry?.portId).toBe('SW1_F0/1')
  })

  it('floods unknown unicast frames', () => {
    let pc2Received = 0
    let pc3Received = 0

    // Mock receive on PCs
    pc2.receiveFrame = () => { pc2Received++ }
    pc3.receiveFrame = () => { pc3Received++ }

    const frame: EthernetFrame = {
      srcMac: 'AA:AA:AA:AA:AA:AA',
      dstMac: 'BB:BB:BB:BB:BB:BB', // Unknown
      ethertype: 0x0800,
      payload: 'ping'
    }

    engine.transmitFrame('PC1', 'PC1_Eth0', frame)

    // Both PC2 and PC3 should receive it because BB is unknown
    expect(pc2Received).toBe(1)
    expect(pc3Received).toBe(1)
  })

  it('forwards known unicast frames', () => {
    let pc2Received = 0
    let pc3Received = 0
    pc2.receiveFrame = () => { pc2Received++ }
    pc3.receiveFrame = () => { pc3Received++ }

    // PC2 speaks first to populate the switch MAC table
    engine.transmitFrame('PC2', 'PC2_Eth0', {
      srcMac: 'BB:BB:BB:BB:BB:BB',
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0806,
      payload: 'arp'
    })

    // Reset counters after broadcast ARP
    pc2Received = 0
    pc3Received = 0

    // Now PC1 sends specifically to PC2
    engine.transmitFrame('PC1', 'PC1_Eth0', {
      srcMac: 'AA:AA:AA:AA:AA:AA',
      dstMac: 'BB:BB:BB:BB:BB:BB',
      ethertype: 0x0800,
      payload: 'ping'
    })

    // PC2 should receive the ping, PC3 should NOT
    // (Note: PC2Received is 1 because we overwrote receiveFrame after it sent the ARP? No, it's 1 because it received PC1's ping. The broadcast ARP from PC2 went to PC1 and PC3, not PC2)
    expect(pc2Received).toBe(1)
    expect(pc3Received).toBe(0) // Did not flood!
  })
})
