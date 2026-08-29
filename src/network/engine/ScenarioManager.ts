import { simulationEngine } from './globalEngine'
import { PC, Layer2Switch, Router } from './Devices'
import { createInterface } from './NetworkInterface'
import { createPort } from './PhysicalPort'
import { NetworkStore } from '../NetworkStore'

export interface TroubleshootingScenario {
  id: string
  title: string
  description: string
  setup: () => void
  checkSuccess: () => boolean
}

export const Scenarios: TroubleshootingScenario[] = [
  {
    id: 'wrong-subnet',
    title: 'Wrong Subnet Mask',
    description: 'PC1 cannot ping its gateway (Router1). Diagnose the IP configuration and fix it.',
    setup: () => {
      simulationEngine.clear()
      
      const pc1 = new PC('PC1', 'PC1')
      const sw1 = new Layer2Switch('Switch1', 'Switch1')
      const r1 = new Router('Router1', 'Router1')
      
      pc1.position = { x: -3, y: 0, z: 0 }
      sw1.position = { x: 0, y: 0, z: 0 }
      r1.position = { x: 3, y: 0, z: 0 }
      
      simulationEngine.addDevice(pc1)
      simulationEngine.addDevice(sw1)
      simulationEngine.addDevice(r1)

      // Ports
      simulationEngine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
      simulationEngine.registerPort(createPort('Switch1_F0/1', 'Switch1', 'FastEthernet0/1'))
      simulationEngine.registerPort(createPort('Switch1_F0/2', 'Switch1', 'FastEthernet0/2'))
      simulationEngine.registerPort(createPort('Router1_G0/0', 'Router1', 'GigabitEthernet0/0'))

      // Interfaces
      pc1.addInterface(createInterface('PC1_Ethernet0', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0'))
      r1.addInterface(createInterface('Router1_GigabitEthernet0/0', 'Router1', 'GigabitEthernet0/0', 'GigabitEthernet', 'Router1_G0/0'))

      // Connect
      simulationEngine.connectCable('c1', 'PC1_Eth0', 'Switch1_F0/1')
      simulationEngine.connectCable('c2', 'Switch1_F0/2', 'Router1_G0/0')

      // Configure Router
      simulationEngine.executeCommand('Router1', 'enable\nconfigure terminal\ninterface GigabitEthernet0/0\nip address 192.168.1.1 255.255.255.0\nno shutdown\nexit\nend')
      
      // Configure PC with wrong subnet (/26 instead of /24) - placing it in 192.168.1.64 network
      simulationEngine.executeCommand('PC1', 'ip 192.168.1.100 255.255.255.192 192.168.1.1')
    },
    checkSuccess: () => {
      const pc1 = simulationEngine.getDevice('PC1') as PC
      if (!pc1) return false
      const intf = Array.from(pc1.interfaces.values())[0]
      return intf?.ipAddress === '192.168.1.100' && intf?.subnetMask === '255.255.255.0'
    }
  },
  {
    id: 'shutdown-interface',
    title: 'Shutdown Interface',
    description: 'Connectivity between PC1 and Router1 is down. Find out why and fix it.',
    setup: () => {
      simulationEngine.clear()
      const pc1 = new PC('PC1', 'PC1')
      const sw1 = new Layer2Switch('Switch1', 'Switch1')
      const r1 = new Router('Router1', 'Router1')
      
      pc1.position = { x: -3, y: 0, z: 0 }
      sw1.position = { x: 0, y: 0, z: 0 }
      r1.position = { x: 3, y: 0, z: 0 }
      
      simulationEngine.addDevice(pc1)
      simulationEngine.addDevice(sw1)
      simulationEngine.addDevice(r1)

      // Ports
      simulationEngine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
      simulationEngine.registerPort(createPort('Switch1_F0/1', 'Switch1', 'FastEthernet0/1'))
      simulationEngine.registerPort(createPort('Switch1_F0/2', 'Switch1', 'FastEthernet0/2'))
      simulationEngine.registerPort(createPort('Router1_G0/0', 'Router1', 'GigabitEthernet0/0'))

      // Interfaces
      pc1.addInterface(createInterface('PC1_Ethernet0', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0'))
      r1.addInterface(createInterface('Router1_GigabitEthernet0/0', 'Router1', 'GigabitEthernet0/0', 'GigabitEthernet', 'Router1_G0/0'))

      simulationEngine.connectCable('c1', 'PC1_Eth0', 'Switch1_F0/1')
      simulationEngine.connectCable('c2', 'Switch1_F0/2', 'Router1_G0/0')

      // Fault: Admin down
      simulationEngine.executeCommand('Router1', 'enable\nconfigure terminal\ninterface GigabitEthernet0/0\nip address 192.168.1.1 255.255.255.0\nshutdown\nexit\nend')
      simulationEngine.executeCommand('PC1', 'ip 192.168.1.10 255.255.255.0 192.168.1.1')
    },
    checkSuccess: () => {
      const r1 = simulationEngine.getDevice('Router1') as Router
      if (!r1) return false
      const intf = Array.from(r1.interfaces.values()).find(i => i.name.includes('GigabitEthernet0/0'))
      return intf?.adminStatus === 'up'
    }
  },
  {
    id: 'wrong-vlan',
    title: 'Wrong Access VLAN',
    description: 'PC1 and PC2 cannot ping each other. They are supposed to be on VLAN 10.',
    setup: () => {
      simulationEngine.clear()
      const pc1 = new PC('PC1', 'PC1')
      const pc2 = new PC('PC2', 'PC2')
      const sw1 = new Layer2Switch('Switch1', 'Switch1')
      
      pc1.position = { x: -3, y: 1, z: 0 }
      pc2.position = { x: 3, y: 1, z: 0 }
      sw1.position = { x: 0, y: 0, z: 0 }
      
      simulationEngine.addDevice(pc1)
      simulationEngine.addDevice(pc2)
      simulationEngine.addDevice(sw1)

      // Ports
      simulationEngine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
      simulationEngine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))
      simulationEngine.registerPort(createPort('Switch1_F0/1', 'Switch1', 'FastEthernet0/1'))
      simulationEngine.registerPort(createPort('Switch1_F0/2', 'Switch1', 'FastEthernet0/2'))

      // Interfaces
      pc1.addInterface(createInterface('PC1_Ethernet0', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0'))
      pc2.addInterface(createInterface('PC2_Ethernet0', 'PC2', 'Ethernet0', 'FastEthernet', 'PC2_Eth0'))

      simulationEngine.connectCable('c1', 'PC1_Eth0', 'Switch1_F0/1')
      simulationEngine.connectCable('c2', 'PC2_Eth0', 'Switch1_F0/2')

      simulationEngine.executeCommand('PC1', 'ip 10.0.0.1 255.255.255.0')
      simulationEngine.executeCommand('PC2', 'ip 10.0.0.2 255.255.255.0')
      
      // Fault: PC1 in VLAN 20, PC2 in VLAN 10
      simulationEngine.executeCommand('Switch1', 'enable\nconfigure terminal\nvlan 10\nname Clients\nvlan 20\nname Servers\nexit\ninterface FastEthernet0/2\nswitchport mode access\nswitchport access vlan 10\ninterface FastEthernet0/1\nswitchport mode access\nswitchport access vlan 20\nend')
    },
    checkSuccess: () => {
      const sw1 = simulationEngine.getDevice('Switch1') as Layer2Switch
      if (!sw1) return false
      const f01 = Array.from(sw1.interfaces.values()).find(i => i.name.includes('FastEthernet0/1'))
      const f02 = Array.from(sw1.interfaces.values()).find(i => i.name.includes('FastEthernet0/2'))
      return f01?.accessVlan === 10 && f02?.accessVlan === 10
    }
  },
  {
    id: 'missing-route',
    title: 'Missing Static Route',
    description: 'PC1 (192.168.1.10) cannot ping PC2 (192.168.2.10). A route is missing.',
    setup: () => {
      simulationEngine.clear()
      const pc1 = new PC('PC1', 'PC1')
      const pc2 = new PC('PC2', 'PC2')
      const r1 = new Router('R1', 'R1')
      const r2 = new Router('R2', 'R2')
      
      pc1.position = { x: -4, y: 0, z: 0 }
      r1.position = { x: -1, y: 0, z: 0 }
      r2.position = { x: 1, y: 0, z: 0 }
      pc2.position = { x: 4, y: 0, z: 0 }
      
      simulationEngine.addDevice(pc1)
      simulationEngine.addDevice(pc2)
      simulationEngine.addDevice(r1)
      simulationEngine.addDevice(r2)

      // Ports
      simulationEngine.registerPort(createPort('PC1_Eth0', 'PC1', 'Ethernet0'))
      simulationEngine.registerPort(createPort('PC2_Eth0', 'PC2', 'Ethernet0'))
      simulationEngine.registerPort(createPort('R1_G0/0', 'R1', 'GigabitEthernet0/0'))
      simulationEngine.registerPort(createPort('R1_G0/1', 'R1', 'GigabitEthernet0/1'))
      simulationEngine.registerPort(createPort('R2_G0/0', 'R2', 'GigabitEthernet0/0'))
      simulationEngine.registerPort(createPort('R2_G0/1', 'R2', 'GigabitEthernet0/1'))

      // Interfaces
      pc1.addInterface(createInterface('PC1_Ethernet0', 'PC1', 'Ethernet0', 'FastEthernet', 'PC1_Eth0'))
      pc2.addInterface(createInterface('PC2_Ethernet0', 'PC2', 'Ethernet0', 'FastEthernet', 'PC2_Eth0'))
      r1.addInterface(createInterface('R1_GigabitEthernet0/0', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet', 'R1_G0/0'))
      r1.addInterface(createInterface('R1_GigabitEthernet0/1', 'R1', 'GigabitEthernet0/1', 'GigabitEthernet', 'R1_G0/1'))
      r2.addInterface(createInterface('R2_GigabitEthernet0/0', 'R2', 'GigabitEthernet0/0', 'GigabitEthernet', 'R2_G0/0'))
      r2.addInterface(createInterface('R2_GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1', 'GigabitEthernet', 'R2_G0/1'))

      simulationEngine.connectCable('c1', 'PC1_Eth0', 'R1_G0/0')
      simulationEngine.connectCable('c2', 'R1_G0/1', 'R2_G0/1')
      simulationEngine.connectCable('c3', 'R2_G0/0', 'PC2_Eth0')

      simulationEngine.executeCommand('PC1', 'ip 192.168.1.10 255.255.255.0 192.168.1.1')
      simulationEngine.executeCommand('PC2', 'ip 192.168.2.10 255.255.255.0 192.168.2.1')
      
      simulationEngine.executeCommand('R1', 'enable\nconf t\nint g0/0\nip add 192.168.1.1 255.255.255.0\nno shut\nint g0/1\nip add 10.0.0.1 255.255.255.252\nno shut\nend')
      simulationEngine.executeCommand('R2', 'enable\nconf t\nint g0/0\nip add 192.168.2.1 255.255.255.0\nno shut\nint g0/1\nip add 10.0.0.2 255.255.255.252\nno shut\nend')
      
      // R2 has route back, R1 is missing the route to 192.168.2.0
      simulationEngine.executeCommand('R2', 'enable\nconf t\nip route 192.168.1.0 255.255.255.0 10.0.0.1\nend')
    },
    checkSuccess: () => {
      const r1 = simulationEngine.getDevice('R1') as Router
      if (!r1) return false
      return r1.staticRoutes.some(r => r.network === '192.168.2.0' && r.mask === '255.255.255.0' && (r.nextHop === '10.0.0.2' || !!r.outgoingInterfaceId))
    }
  }
]
