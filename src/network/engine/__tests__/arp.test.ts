import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Router, Layer2Switch, PC } from '../Devices'
import { createInterface } from '../NetworkInterface'
import { createPort } from '../PhysicalPort'
import type { EthernetFrame } from '../DataPlane'

describe('ARP Simulation', () => {
  let engine: SimulationNetworkEngine
  let r1: Router
  let sw1: Layer2Switch
  let pc1: PC

  beforeEach(() => {
    engine = new SimulationNetworkEngine()

    r1 = new Router('R1')
    sw1 = new Layer2Switch('SW1')
    pc1 = new PC('PC1')

    engine.addDevice(r1)
    engine.addDevice(sw1)
    engine.addDevice(pc1)

    // PC1 Config
    engine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
    const pcIntf = createInterface('PC1_Eth0_L', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0')
    pcIntf.ipAddress = '192.168.1.10'
    pcIntf.subnetMask = '255.255.255.0'
    pcIntf.adminStatus = 'up'
    pcIntf.operStatus = 'up'
    pc1.addInterface(pcIntf)

    // SW1 Config
    engine.registerPort(createPort('SW1_F0/1', 'SW1', 'FastEthernet0/1'))
    const sw1_f01 = createInterface('SW1_F0/1_L', 'SW1', 'FastEthernet0/1', 'FastEthernet', 'SW1_F0/1')
    sw1_f01.adminStatus = 'up'; sw1_f01.operStatus = 'up'
    sw1.addInterface(sw1_f01)

    engine.registerPort(createPort('SW1_F0/2', 'SW1', 'FastEthernet0/2'))
    const sw1_f02 = createInterface('SW1_F0/2_L', 'SW1', 'FastEthernet0/2', 'FastEthernet', 'SW1_F0/2')
    sw1_f02.adminStatus = 'up'; sw1_f02.operStatus = 'up'
    sw1.addInterface(sw1_f02)

    // R1 Config
    engine.registerPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0'))
    const rIntf = createInterface('R1_G0/0_L', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', 'R1_G0/0')
    rIntf.ipAddress = '192.168.1.1'
    rIntf.subnetMask = '255.255.255.0'
    rIntf.adminStatus = 'up'
    rIntf.operStatus = 'up'
    r1.addInterface(rIntf)

    // Connect them
    engine.connectCable('c1', 'PC1_Eth0', 'SW1_F0/1')
    engine.connectCable('c2', 'SW1_F0/2', 'R1_G0/0')
  })

  it('Router generates an ARP Reply when it receives an ARP Request for its IP', () => {
    let pcReceivedReply = false

    // Override PC1's receive to check for the reply
    pc1.receiveFrame = (portId, frame) => {
      if (frame.ethertype === 0x0806) {
        const arp = frame.payload
        if (arp.operation === 'reply' && arp.senderIp === '192.168.1.1') {
          pcReceivedReply = true
        }
      }
    }

    const pcIntf = pc1.getInterface('PC1_Eth0_L')!
    
    // PC1 sends ARP Request for 192.168.1.1
    const arpRequest: EthernetFrame = {
      srcMac: pcIntf.macAddress,
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0806,
      payload: {
        operation: 'request',
        senderMac: pcIntf.macAddress,
        senderIp: pcIntf.ipAddress,
        targetMac: '00:00:00:00:00:00',
        targetIp: '192.168.1.1'
      }
    }

    engine.transmitFrame('PC1', 'PC1_Eth0', arpRequest)

    // Router should have received it and added PC1 to its ARP cache
    const routerEntry = r1.arpTable.get('192.168.1.10')
    expect(routerEntry).toBeDefined()
    expect(routerEntry?.macAddress).toBe(pcIntf.macAddress)

    // Router should have sent a reply, which was forwarded by SW1, and received by PC1
    expect(pcReceivedReply).toBe(true)
  })

  it('Router does not reply if ARP Request is for a different IP', () => {
    const pcIntf = pc1.getInterface('PC1_Eth0_L')!
    let routerTransmitted = false

    const originalTransmit = engine.transmitFrame.bind(engine)
    engine.transmitFrame = (src, port, frame) => {
      if (src === 'R1') routerTransmitted = true
      originalTransmit(src, port, frame)
    }
    
    const arpRequest: EthernetFrame = {
      srcMac: pcIntf.macAddress,
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0806,
      payload: {
        operation: 'request',
        senderMac: pcIntf.macAddress,
        senderIp: pcIntf.ipAddress,
        targetMac: '00:00:00:00:00:00',
        targetIp: '192.168.1.99' // Different IP
      }
    }

    engine.transmitFrame('PC1', 'PC1_Eth0', arpRequest)

    // Router learns the MAC still (dynamic learning)
    expect(r1.arpTable.get('192.168.1.10')).toBeDefined()

    // But it does not send a reply
    expect(routerTransmitted).toBe(false)
  })

  it('show arp CLI command displays correctly', () => {
    // Populate an entry
    r1.arpTable.set('192.168.1.10', {
      ipAddress: '192.168.1.10',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      interfaceId: 'R1_G0/0_L',
      expiresAt: Date.now() + 14400000
    })

    engine.executeCommand('R1', 'enable')
    const out = engine.executeCommand('R1', 'show arp')

    expect(out).toContain('192.168.1.10')
    expect(out).toContain('AA:BB:CC:DD:EE:FF')
    expect(out).toContain('GigabitEthernet0/0')
    expect(out).toContain('-') // Age is 0 minutes, so '-'
  })
})
