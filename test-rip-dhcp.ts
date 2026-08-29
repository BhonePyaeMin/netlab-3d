import { simulationEngine } from './src/network/engine/globalEngine'
import { Router, PC } from './src/network/engine/Devices'

// Setup R1 (DHCP Server & RIPv2 Router) <-> R2 (RIPv2 Router)
// Also PC1 <-> R1 (gets IP via DHCP)

const r1 = simulationEngine.getDevice('Router1') as Router
const r2 = simulationEngine.getDevice('Router2') as Router
const pc = simulationEngine.getDevice('PC1') as PC

console.log("Configuring R1...")
r1.cliSession.executeCommand('enable')
r1.cliSession.executeCommand('conf t')

// G0/0 to R2
r1.cliSession.executeCommand('int g0/0')
r1.cliSession.executeCommand('ip address 10.0.0.1 255.255.255.0')
r1.cliSession.executeCommand('no shut')
r1.cliSession.executeCommand('exit')

// G0/1 to PC1
r1.cliSession.executeCommand('int g0/1')
r1.cliSession.executeCommand('ip address 192.168.1.1 255.255.255.0')
r1.cliSession.executeCommand('no shut')
r1.cliSession.executeCommand('exit')

// RIPv2
r1.cliSession.executeCommand('router rip')
r1.cliSession.executeCommand('version 2')
r1.cliSession.executeCommand('no auto-summary')
r1.cliSession.executeCommand('network 10.0.0.0')
r1.cliSession.executeCommand('network 192.168.1.0')
r1.cliSession.executeCommand('exit')

// DHCP Pool
r1.cliSession.executeCommand('ip dhcp excluded-address 192.168.1.1 192.168.1.10')
r1.cliSession.executeCommand('ip dhcp pool MY-POOL')
r1.cliSession.executeCommand('network 192.168.1.0 255.255.255.0')
r1.cliSession.executeCommand('default-router 192.168.1.1')
r1.cliSession.executeCommand('dns-server 8.8.8.8')
r1.cliSession.executeCommand('end')

console.log("Configuring R2...")
r2.cliSession.executeCommand('enable')
r2.cliSession.executeCommand('conf t')

// G0/0 to R1
r2.cliSession.executeCommand('int g0/0')
r2.cliSession.executeCommand('ip address 10.0.0.2 255.255.255.0')
r2.cliSession.executeCommand('no shut')
r2.cliSession.executeCommand('exit')

// G0/1 Stub Network
r2.cliSession.executeCommand('int g0/1')
r2.cliSession.executeCommand('ip address 172.16.1.1 255.255.255.0')
r2.cliSession.executeCommand('no shut')
r2.cliSession.executeCommand('exit')

// RIPv2
r2.cliSession.executeCommand('router rip')
r2.cliSession.executeCommand('version 2')
r2.cliSession.executeCommand('no auto-summary')
r2.cliSession.executeCommand('network 10.0.0.0')
r2.cliSession.executeCommand('network 172.16.0.0')
r2.cliSession.executeCommand('end')

console.log("Router1 Ports:", Array.from(r1.ports.keys()))
console.log("PC1 Ports:", Array.from(pc.ports.keys()))

// Connect Cables
console.log("Connecting cables...")
simulationEngine.connectCable('CABLE1', 'Router1_G0/0', 'Router2_G0/0')
const pcPortId = Array.from(pc.ports.keys())[0]
simulationEngine.connectCable('CABLE2', 'Router1_G0/1', pcPortId)
simulationEngine.connectCable('CABLE3', 'Router2_G0/1', 'Switch1_F0/1')

console.log("Simulating time (35s)...")
setTimeout(() => {
  console.log("\n--- PC IP Configuration ---")
  pc.cliSession.executeCommand('enable')
  console.log(pc.cliSession.executeCommand('show ip interface brief'))

  console.log("\n--- R1 DHCP Bindings ---")
  console.log(r1.cliSession.executeCommand('show ip dhcp binding'))

  console.log("\n--- R1 DHCP Pool Stats ---")
  console.log(r1.cliSession.executeCommand('show ip dhcp pool'))

  console.log("\n--- R1 Protocols ---")
  console.log(r1.cliSession.executeCommand('show ip protocols'))

  console.log("\n--- R1 Routing Table (RIP) ---")
  console.log(r1.cliSession.executeCommand('show ip route rip'))

  process.exit(0)
}, 35000)
