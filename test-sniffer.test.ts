import { describe, it, expect } from 'vitest'
import { simulationEngine } from './src/network/engine/globalEngine'
import { PC, Layer2Switch } from './src/network/engine/Devices'
import { NetworkStore } from './src/network/NetworkStore'
import { createInterface } from './src/network/engine/NetworkInterface'

describe('Packet Sniffer', () => {
  it('intercepts and decodes packets traversing a selected link', () => {
    const sw1 = simulationEngine.getDevice('Switch1') as Layer2Switch;
    const pc1 = simulationEngine.getDevice('PC1') as PC;
    const pc2 = simulationEngine.getDevice('PC2') as PC;

    const pc1Port = Array.from(pc1.ports.values())[0];
    const pc2Port = Array.from(pc2.ports.values())[0];
    
    // Add logic interfaces
    const sw1_f01 = createInterface('Switch1_F0/1_L', 'Switch1', 'FastEthernet0/1', 'FastEthernet', 'Switch1_F0/1')
    sw1_f01.adminStatus = 'up'
    sw1_f01.operStatus = 'up'
    sw1.addInterface(sw1_f01)

    const sw1_f02 = createInterface('Switch1_F0/2_L', 'Switch1', 'FastEthernet0/2', 'FastEthernet', 'Switch1_F0/2')
    sw1_f02.adminStatus = 'up'
    sw1_f02.operStatus = 'up'
    sw1.addInterface(sw1_f02)

    simulationEngine.connectCable('capture-cable', pc1Port.id, 'Switch1_F0/1');
    simulationEngine.connectCable('other-cable', pc2Port.id, 'Switch1_F0/2');

    // Enable packet capture on the cable between PC1 and SW1
    NetworkStore.setCapturingCable('capture-cable');

    // Simulate ping
    simulationEngine.executeCommand('PC1', 'ip 192.168.99.10 255.255.255.0');
    simulationEngine.executeCommand('PC2', 'ip 192.168.99.20 255.255.255.0');
    simulationEngine.executeCommand('PC1', 'ping 192.168.99.20');
    
    // Allow packets to propagate
    simulationEngine.tick(100);
    simulationEngine.tick(100);

    const packets = NetworkStore.getSnapshot().capturedPackets;
    expect(packets.length).toBeGreaterThan(0);

    const arpPackets = packets.filter(p => p.protocol === 'ARP');
    const icmpPackets = packets.filter(p => p.protocol === 'ICMP');

    expect(arpPackets.length).toBeGreaterThan(0);
    expect(icmpPackets.length).toBeGreaterThan(0);

    const icmpRequest = icmpPackets.find(p => p.srcIp === '192.168.99.10')!;
    expect(icmpRequest).toBeDefined();
    expect(icmpRequest.dstIp).toBe('192.168.99.20');
    expect(icmpRequest.size).toBeGreaterThan(40); // 14(Eth) + 20(IP) + 8(ICMP)

    // Stop capture
    NetworkStore.setCapturingCable(null);
    expect(NetworkStore.getSnapshot().capturedPackets.length).toBe(0);
  });
});
