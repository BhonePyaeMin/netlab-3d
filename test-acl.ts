import { SimulationNetworkEngine } from './src/network/engine/SimulationNetworkEngine'
import { Router, PC, Server } from './src/network/engine/Devices'
import type { PhysicalPort } from './src/network/engine/PhysicalPort'

const engine = new SimulationNetworkEngine()

const pc = new PC('PC1')
const r1 = new Router('R1')

engine.addDevice(pc)
engine.addDevice(r1)

function makePort(id: string, deviceId: string): PhysicalPort {
  return {
    id,
    deviceId,
    type: 'rj45',
    linkDetected: true,
    speed: 1000,
    duplex: 'auto',
    cableId: null
  }
}

// PC
const pcIntf = {
  id: 'PC1_eth0',
  deviceId: 'PC1',
  name: 'eth0',
  type: 'physical' as any,
  macAddress: '00:00:00:00:00:11',
  ipAddress: '192.168.1.10',
  subnetMask: '255.255.255.0',
  ipv6Addresses: [],
  adminStatus: 'up' as any,
  operStatus: 'up' as any,
  connectedPortId: 'PC1_P1'
}

// R1 Inside
const r1IntfIn = {
  id: 'R1_g0_0',
  deviceId: 'R1',
  name: 'GigabitEthernet0/0',
  type: 'physical' as any,
  macAddress: '00:00:00:00:01:01',
  ipAddress: '192.168.1.1',
  subnetMask: '255.255.255.0',
  ipv6Addresses: [],
  adminStatus: 'up' as any,
  operStatus: 'up' as any,
  connectedPortId: 'R1_P1'
}

engine.registerPort(makePort('PC1_P1', 'PC1'))
pc.addInterface(pcIntf)

engine.registerPort(makePort('R1_P1', 'R1'))
r1.addInterface(r1IntfIn)

pc.engine = engine
r1.engine = engine

engine.connectCable('cable1', 'PC1_P1', 'R1_P1')

// Add default route on PC to R1
pc.staticRoutes.push({
  network: '0.0.0.0',
  mask: '0.0.0.0',
  nextHop: '192.168.1.1',
  outgoingInterfaceId: 'PC1_eth0',
  metric: 1,
  administrativeDistance: 1,
  protocol: 'static'
})

// Initialize routes
pc.updateConnectedRoutes()
r1.updateConnectedRoutes()

console.log('PC Routing Table:', pc.routingTable)

console.log('--- Executing ping without ACL (should be success) ---')
console.log(pc.cliSession.executeCommand('ping 192.168.1.1'))

// Now add ACL on router to deny ICMP from PC1
console.log('\n--- Configuring ACL 100 to deny ICMP from PC1 ---')
r1.cliSession.executeCommand('enable')
r1.cliSession.executeCommand('conf t')
r1.cliSession.executeCommand('access-list 100 deny icmp host 192.168.1.10 any')
r1.cliSession.executeCommand('access-list 100 permit ip any any') // allow other traffic
r1.cliSession.executeCommand('interface GigabitEthernet0/0')
r1.cliSession.executeCommand('ip access-group 100 in')
r1.cliSession.executeCommand('exit')
r1.cliSession.executeCommand('exit')

console.log(r1.cliSession.executeCommand('show access-lists'))

console.log('\n--- Executing ping with ACL (should fail) ---')
console.log(pc.cliSession.executeCommand('ping 192.168.1.1'))

// Verify ACL matched
console.log('\n--- Verify ACL Hit Counters ---')
console.log(r1.cliSession.executeCommand('show access-lists'))
