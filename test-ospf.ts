import { simulationEngine } from './src/network/engine/globalEngine'
import { Router } from './src/network/engine/Devices'
import { IPMath } from './src/network/engine/IPMath'

// R1 <-> R2
const r1 = simulationEngine.getDevice('Router1') as Router
const r2 = simulationEngine.getDevice('Router2') as Router

console.log("Configuring R1")
r1.cliSession.executeCommand('enable')
r1.cliSession.executeCommand('conf t')
r1.cliSession.executeCommand('int g0/0')
r1.cliSession.executeCommand('ip address 10.0.0.1 255.255.255.0')
r1.cliSession.executeCommand('no shut')
r1.cliSession.executeCommand('exit')
r1.cliSession.executeCommand('router ospf 1')
r1.cliSession.executeCommand('network 10.0.0.0 0.0.0.255 area 0')
r1.cliSession.executeCommand('end')

console.log("Configuring R2")
r2.cliSession.executeCommand('enable')
r2.cliSession.executeCommand('conf t')
r2.cliSession.executeCommand('int g0/0')
r2.cliSession.executeCommand('ip address 10.0.0.2 255.255.255.0')
r2.cliSession.executeCommand('no shut')
r2.cliSession.executeCommand('exit')
r2.cliSession.executeCommand('int g0/1') // Loopback equivalent
r2.cliSession.executeCommand('ip address 20.0.0.1 255.255.255.0')
r2.cliSession.executeCommand('no shut')
r2.cliSession.executeCommand('exit')
r2.cliSession.executeCommand('router ospf 1')
r2.cliSession.executeCommand('network 10.0.0.0 0.0.0.255 area 0')
r2.cliSession.executeCommand('network 20.0.0.0 0.0.0.255 area 0')
r2.cliSession.executeCommand('end')

// Connect R1 G0/0 to R2 G0/0
console.log("Connecting R1 to R2")
simulationEngine.connectCable('CABLE1', 'Router1_G0/0', 'Router2_G0/0')

// Connect R2 G0/1 to Switch1 to bring interface UP
console.log("Connecting R2 to SW1")
simulationEngine.connectCable('CABLE2', 'Router2_G0/1', 'Switch1_F0/1')

console.log("Simulating time (15s)...")
setTimeout(() => {
  console.log("\n--- R1 Interfaces ---")
  console.log(r1.cliSession.executeCommand('show ip interface brief'))

  console.log("\n--- R1 OSPF Neighbors ---")
  console.log(r1.cliSession.executeCommand('show ip ospf neighbor'))
  
  console.log("\n--- R1 Routing Table ---")
  console.log(r1.cliSession.executeCommand('show ip route'))
  
  process.exit(0)
}, 15000)
