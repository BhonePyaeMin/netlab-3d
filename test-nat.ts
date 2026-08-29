import { SimulationNetworkEngine } from './src/network/engine/SimulationNetworkEngine'
import { Router, PC, Server } from './src/network/engine/Devices'
import type { IPv4Packet, UDPPacket, Frame } from './src/network/engine/DataPlane'
import type { PhysicalPort } from './src/network/engine/PhysicalPort'

const engine = new SimulationNetworkEngine()

const pc = new PC('PC1')
const r1 = new Router('R1')
const srv = new Server('SRV1')

engine.addDevice(pc)
engine.addDevice(r1)
engine.addDevice(srv)

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

// Setup PC Interface
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
  mtu: 1500,
  speed: 1000,
  duplex: 'auto' as any,
  description: '',
  switchportMode: 'access' as any,
  accessVlan: 1,
  trunkNativeVlan: 1,
  trunkAllowedVlans: 'all' as any,
  connectedPortId: 'PC1_P0'
}
pc.interfaces.set(pcIntf.id, pcIntf)
const pcPort = makePort('PC1_P0', 'PC1')
engine.registerPort(pcPort)

// Setup R1 LAN Interface (Inside)
const r1LanIntf = {
  ...pcIntf,
  id: 'R1_g0/0',
  deviceId: 'R1',
  name: 'GigabitEthernet0/0',
  macAddress: '00:00:00:00:00:R1',
  ipAddress: '192.168.1.1',
  connectedPortId: 'R1_P0',
  natZone: 'inside' as any
}
r1.interfaces.set(r1LanIntf.id, r1LanIntf)
const r1LanPort = makePort('R1_P0', 'R1')
engine.registerPort(r1LanPort)

// Setup R1 WAN Interface (Outside)
const r1WanIntf = {
  ...r1LanIntf,
  id: 'R1_g0/1',
  name: 'GigabitEthernet0/1',
  macAddress: '00:00:00:00:00:R2',
  ipAddress: '203.0.113.1', // Public IP
  connectedPortId: 'R1_P1',
  natZone: 'outside' as any
}
r1.interfaces.set(r1WanIntf.id, r1WanIntf)
const r1WanPort = makePort('R1_P1', 'R1')
engine.registerPort(r1WanPort)

// Setup Server Interface
const srvIntf = {
  ...r1WanIntf,
  id: 'SRV1_eth0',
  deviceId: 'SRV1',
  name: 'eth0',
  macAddress: '00:00:00:00:00:S1',
  ipAddress: '203.0.113.100',
  connectedPortId: 'SRV1_P0',
  natZone: undefined
}
srv.interfaces.set(srvIntf.id, srvIntf)
const srvPort = makePort('SRV1_P0', 'SRV1')
engine.registerPort(srvPort)

// Connect PC1 <-> R1 <-> SRV1
engine.connectCable('cable1', 'PC1_P0', 'R1_P0')
engine.connectCable('cable2', 'R1_P1', 'SRV1_P0')


// Setup routing
pc.staticRoutes.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '192.168.1.1', outgoingInterfaceId: null, metric: 1, administrativeDistance: 1, protocol: 'static' })
pc.updateConnectedRoutes()

r1.updateConnectedRoutes() // R1 learns connected routes for 192.168.1.0/24 and 203.0.113.0/24

srv.staticRoutes.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '203.0.113.1', outgoingInterfaceId: null, metric: 1, administrativeDistance: 1, protocol: 'static' })
srv.updateConnectedRoutes()

// Configure PAT on R1 using CLIEngine to ensure CLI works
console.log(r1.cliSession.executeCommand('enable'))
console.log(r1.cliSession.executeCommand('configure terminal'))
console.log(r1.cliSession.executeCommand('ip nat inside source list 1 interface GigabitEthernet0/1 overload'))
console.log(r1.cliSession.executeCommand('interface GigabitEthernet0/0'))
console.log(r1.cliSession.executeCommand('ip nat inside'))
console.log(r1.cliSession.executeCommand('exit'))
console.log(r1.cliSession.executeCommand('interface GigabitEthernet0/1'))
console.log(r1.cliSession.executeCommand('ip nat outside'))
console.log(r1.cliSession.executeCommand('exit'))
console.log(r1.cliSession.executeCommand('end'))

// Setup ARP tables statically for simulation speed
pc.arpTable.set('192.168.1.1', { ipAddress: '192.168.1.1', macAddress: '00:00:00:00:00:R1', interfaceId: pcIntf.id, expiresAt: Date.now() + 100000 })
r1.arpTable.set('203.0.113.100', { ipAddress: '203.0.113.100', macAddress: '00:00:00:00:00:S1', interfaceId: r1WanIntf.id, expiresAt: Date.now() + 100000 })
srv.arpTable.set('203.0.113.1', { ipAddress: '203.0.113.1', macAddress: '00:00:00:00:00:R2', interfaceId: srvIntf.id, expiresAt: Date.now() + 100000 })

// Have PC1 send a UDP packet to SRV1
const udpPacket: UDPPacket = {
  srcPort: 54321,
  dstPort: 80,
  length: 20,
  checksum: 0,
  payload: 'Hello Server'
}
const ipPacket: IPv4Packet = {
  version: 4,
  ihl: 5,
  tos: 0,
  totalLength: 40,
  identification: 100,
  flags: 0,
  fragmentOffset: 0,
  ttl: 64,
  protocol: 17, // UDP
  headerChecksum: 0,
  srcIp: '192.168.1.10',
  dstIp: '203.0.113.100',
  payload: udpPacket
}
const frame: Frame = {
  srcMac: '00:00:00:00:00:11',
  dstMac: '00:00:00:00:00:R1', // to R1
  ethertype: 0x0800,
  payload: ipPacket
}

// Add a hook to SRV1 to see if it received translated packet
let receivedSrcIp = ''
const originalReceive = srv.receiveFrame.bind(srv)
srv.receiveFrame = (portId, rcvFrame: any) => {
  if (rcvFrame.ethertype === 0x0800) {
    const ip = rcvFrame.payload as IPv4Packet
    console.log(`\n[SRV1] Received packet from: ${ip.srcIp}:${(ip.payload as UDPPacket).srcPort}`)
    receivedSrcIp = ip.srcIp
  }
  originalReceive(portId, rcvFrame)
}

console.log('Sending UDP packet from PC1 -> SRV1 (should be NATted by R1)')
pc.engine?.transmitFrame(pc.id, pcIntf.connectedPortId!, frame)

setTimeout(() => {
  console.log('\n--- Router R1 NAT Translations ---')
  console.log(r1.cliSession.executeCommand('show ip nat translations'))
  
  console.log('\n--- Router R1 NAT Statistics ---')
  console.log(r1.cliSession.executeCommand('show ip nat statistics'))
  
  if (receivedSrcIp === '203.0.113.1') {
    console.log('\n✅ NAT PAT test SUCCESS: Server received packet from Router\'s outside IP.')
  } else {
    console.log('\n❌ NAT PAT test FAILED: Server received packet from incorrect IP:', receivedSrcIp)
  }
  process.exit(0)
}, 1000)
