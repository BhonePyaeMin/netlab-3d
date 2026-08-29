import { describe, it, expect } from 'vitest'
import { simulationEngine } from './src/network/engine/globalEngine'
import { PC, Layer2Switch, Router } from './src/network/engine/Devices'
import { NetworkStore } from './src/network/NetworkStore'
import { createInterface } from './src/network/engine/NetworkInterface'

describe('Packet Animation Trace', () => {
  it('collects hop decisions when animation mode is enabled', () => {
    // Enable animation mode
    NetworkStore.setAnimationMode(true)

    const sw1 = simulationEngine.getDevice('Switch1') as Layer2Switch;
    const pc1 = simulationEngine.getDevice('PC1') as PC;
    const r1 = simulationEngine.getDevice('Router1') as Router;

    const pc1Port = Array.from(pc1.ports.values())[0];
    const r1Port = Array.from(r1.ports.values())[0];
    
    // Add logic interfaces
    const sw1_f01 = createInterface('Switch1_F0/1_L', 'Switch1', 'FastEthernet0/1', 'FastEthernet', 'Switch1_F0/1')
    sw1_f01.adminStatus = 'up'
    sw1_f01.operStatus = 'up'
    sw1.addInterface(sw1_f01)

    const sw1_f02 = createInterface('Switch1_F0/2_L', 'Switch1', 'FastEthernet0/2', 'FastEthernet', 'Switch1_F0/2')
    sw1_f02.adminStatus = 'up'
    sw1_f02.operStatus = 'up'
    sw1.addInterface(sw1_f02)

    simulationEngine.connectCable('c1', pc1Port.id, 'Switch1_F0/1');
    simulationEngine.connectCable('c2', r1Port.id, 'Switch1_F0/2');

    // Simulate ping from PC1 to Router1
    simulationEngine.executeCommand('PC1', 'ip 192.168.1.10 255.255.255.0');
    simulationEngine.executeCommand('Router1', 'enable\nconfigure terminal\ninterface GigabitEthernet0/0\nip address 192.168.1.1 255.255.255.0\nno shutdown\nexit\nend');
    
    // Send ping
    simulationEngine.executeCommand('PC1', 'ping 192.168.1.1');
    
    // A trace should be automatically saved
    const trace = NetworkStore.getSnapshot().activeTrace;
    expect(trace).toBeDefined();
    
    if (trace) {
      expect(trace.hops.length).toBeGreaterThan(0);
      
      // Hop 0: PC transmitting
      expect(trace.hops[0].deviceId).toBe('PC1');
      expect(trace.hops[0].action).toBe('forward');

      // Hop 1: Switch forwarding
      expect(trace.hops[1].deviceId).toBe('Switch1');
      expect(trace.hops[1].decisions.length).toBeGreaterThan(0);

      // We should see MAC lookups or Flooding decisions in the switch
      const switchDecisions = trace.hops[1].decisions.join(' ');
      expect(switchDecisions).toMatch(/MAC lookup/);
    }
  });
});
