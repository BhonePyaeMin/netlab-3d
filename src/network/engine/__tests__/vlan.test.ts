import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Layer2Switch, PC } from '../Devices'
import { createInterface } from '../NetworkInterface'
import { createPort } from '../PhysicalPort'
import type { EthernetFrame } from '../DataPlane'

describe('VLAN and Trunking', () => {
  let engine: SimulationNetworkEngine
  let sw1: Layer2Switch
  let sw2: Layer2Switch
  let pc1: PC
  let pc2: PC
  let pc3: PC

  beforeEach(() => {
    engine = new SimulationNetworkEngine()

    sw1 = new Layer2Switch('SW1')
    sw2 = new Layer2Switch('SW2')
    pc1 = new PC('PC1') // VLAN 10 on SW1
    pc2 = new PC('PC2') // VLAN 10 on SW2
    pc3 = new PC('PC3') // VLAN 20 on SW1

    engine.addDevice(sw1)
    engine.addDevice(sw2)
    engine.addDevice(pc1)
    engine.addDevice(pc2)
    engine.addDevice(pc3)

    // PCs
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    const pc1i = createInterface('PC1_Eth0_L', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0')
    pc1i.adminStatus = 'up'; pc1i.operStatus = 'up'; pc1.addInterface(pc1i)

    engine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))
    const pc2i = createInterface('PC2_Eth0_L', 'PC2', 'Ethernet0', 'FastEthernet', 'PC2_Eth0')
    pc2i.adminStatus = 'up'; pc2i.operStatus = 'up'; pc2.addInterface(pc2i)

    engine.registerPort(createPort('PC3_Eth0', 'PC3', 'Ethernet0'))
    const pc3i = createInterface('PC3_Eth0_L', 'PC3', 'Ethernet0', 'FastEthernet', 'PC3_Eth0')
    pc3i.adminStatus = 'up'; pc3i.operStatus = 'up'; pc3.addInterface(pc3i)

    // SW1
    engine.registerPort(createPort('SW1_F0/1', 'SW1', 'FastEthernet0/1'))
    const sw1_f01 = createInterface('SW1_F0/1_L', 'SW1', 'FastEthernet0/1', 'FastEthernet', 'SW1_F0/1')
    sw1_f01.switchportMode = 'access'
    sw1_f01.accessVlan = 10
    sw1_f01.adminStatus = 'up'; sw1_f01.operStatus = 'up'
    sw1.addInterface(sw1_f01)

    engine.registerPort(createPort('SW1_F0/2', 'SW1', 'FastEthernet0/2'))
    const sw1_f02 = createInterface('SW1_F0/2_L', 'SW1', 'FastEthernet0/2', 'FastEthernet', 'SW1_F0/2')
    sw1_f02.switchportMode = 'access'
    sw1_f02.accessVlan = 20
    sw1_f02.adminStatus = 'up'; sw1_f02.operStatus = 'up'
    sw1.addInterface(sw1_f02)

    engine.registerPort(createPort('SW1_G0/1', 'SW1', 'GigabitEthernet0/1'))
    const sw1_g01 = createInterface('SW1_G0/1_L', 'SW1', 'GigabitEthernet0/1', 'GigabitEthernet', 'SW1_G0/1')
    sw1_g01.switchportMode = 'trunk'
    sw1_g01.adminStatus = 'up'; sw1_g01.operStatus = 'up'
    sw1.addInterface(sw1_g01)

    // SW2
    engine.registerPort(createPort('SW2_F0/1', 'SW2', 'FastEthernet0/1'))
    const sw2_f01 = createInterface('SW2_F0/1_L', 'SW2', 'FastEthernet0/1', 'FastEthernet', 'SW2_F0/1')
    sw2_f01.switchportMode = 'access'
    sw2_f01.accessVlan = 10
    sw2_f01.adminStatus = 'up'; sw2_f01.operStatus = 'up'
    sw2.addInterface(sw2_f01)

    engine.registerPort(createPort('SW2_G0/1', 'SW2', 'GigabitEthernet0/1'))
    const sw2_g01 = createInterface('SW2_G0/1_L', 'SW2', 'GigabitEthernet0/1', 'GigabitEthernet', 'SW2_G0/1')
    sw2_g01.switchportMode = 'trunk'
    sw2_g01.adminStatus = 'up'; sw2_g01.operStatus = 'up'
    sw2.addInterface(sw2_g01)

    // Connections
    engine.connectCable('c1', 'PC1_Eth0', 'SW1_F0/1') // VLAN 10
    engine.connectCable('c2', 'PC3_Eth0', 'SW1_F0/2') // VLAN 20
    engine.connectCable('c3', 'SW1_G0/1', 'SW2_G0/1') // Trunk
    engine.connectCable('c4', 'SW2_F0/1', 'PC2_Eth0') // VLAN 10
  })

  it('Isolates broadcast traffic within the same VLAN', () => {
    let pc3Received = false
    pc3.receiveFrame = () => { pc3Received = true }

    // PC1 sends a broadcast
    const frame: EthernetFrame = {
      srcMac: 'AA:AA:AA:AA:AA:AA',
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0806, // ARP
      payload: {}
    }

    engine.transmitFrame('PC1', 'PC1_Eth0', frame)

    // PC3 is on VLAN 20, PC1 is on VLAN 10. PC3 should not receive it.
    expect(pc3Received).toBe(false)
  })

  it('Forwards tagged traffic across trunks to the same VLAN', () => {
    let pc2Received = false
    let receivedFrame: EthernetFrame | null = null

    pc2.receiveFrame = (portId, frame) => {
      pc2Received = true
      receivedFrame = frame
    }

    // PC1 sends a broadcast
    const frame: EthernetFrame = {
      srcMac: 'AA:AA:AA:AA:AA:AA',
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0806,
      payload: { hello: 'world' }
    }

    engine.transmitFrame('PC1', 'PC1_Eth0', frame)

    // PC2 is on VLAN 10 on SW2. It should receive it.
    expect(pc2Received).toBe(true)

    // The frame should arrive at PC2 untagged (VLAN tag stripped by access port)
    expect(receivedFrame?.ethertype).toBe(0x0806)
    expect(receivedFrame?.payload.hello).toBe('world')
  })

  it('CLI commands correctly configure VLANs', () => {
    engine.executeCommand('SW1', 'enable')
    engine.executeCommand('SW1', 'conf t')
    
    // Create VLAN
    engine.executeCommand('SW1', 'vlan 30')
    engine.executeCommand('SW1', 'name Sales')
    engine.executeCommand('SW1', 'exit')
    
    // Assign to port
    engine.executeCommand('SW1', 'int f0/1')
    engine.executeCommand('SW1', 'switchport mode access')
    engine.executeCommand('SW1', 'switchport access vlan 30')
    engine.executeCommand('SW1', 'end')

    const out = engine.executeCommand('SW1', 'show vlan brief')
    expect(out).toContain('30')
    expect(out).toContain('Sales')
    expect(out).toContain('FastEthernet0/1')
  })

  it('CLI commands correctly configure Trunk ports', () => {
    engine.executeCommand('SW1', 'enable')
    engine.executeCommand('SW1', 'conf t')
    engine.executeCommand('SW1', 'int g0/1')
    engine.executeCommand('SW1', 'switchport mode trunk')
    engine.executeCommand('SW1', 'switchport trunk allowed vlan 10,20')
    engine.executeCommand('SW1', 'switchport trunk native vlan 99')
    engine.executeCommand('SW1', 'end')

    const out = engine.executeCommand('SW1', 'show interfaces trunk')
    expect(out).toContain('GigabitEthernet0/1')
    expect(out).toContain('802.1q')
    expect(out).toContain('99') // native vlan
    expect(out).toContain('10,20') // allowed vlans
  })
})
