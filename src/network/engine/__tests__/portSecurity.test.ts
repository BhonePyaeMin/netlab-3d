import { describe, it, expect } from 'vitest'
import { simulationEngine } from './src/network/engine/globalEngine'
import { PC, Layer2Switch } from './src/network/engine/Devices'
import { createInterface } from './src/network/engine/NetworkInterface'

describe('Switch Port Security', () => {
  it('enforces port security with different violation modes', () => {
    const sw1 = simulationEngine.getDevice('Switch1') as Layer2Switch;
    const pc1 = simulationEngine.getDevice('PC1') as PC;
    const pc2 = simulationEngine.getDevice('PC2') as PC;

    // Connect PC1 -> SW1_F0/1 and PC2 -> SW1_F0/2
    const pc1Port = Array.from(pc1.ports.values())[0];
    const pc2Port = Array.from(pc2.ports.values())[0];
    // Create and add logical interface for Switch1_F0/1
    const sw1_f01 = createInterface('Switch1_F0/1_L', 'Switch1', 'FastEthernet0/1', 'FastEthernet', 'Switch1_F0/1')
    sw1_f01.adminStatus = 'up'
    sw1_f01.operStatus = 'up'
    sw1.addInterface(sw1_f01)
    
    simulationEngine.connectCable('cable1', pc1Port.id, 'Switch1_F0/1');
    simulationEngine.connectCable('cable2', pc2Port.id, 'Switch1_F0/2');

    // Configure Port Security on SW1_F0/1
    simulationEngine.executeCommand('Switch1', 'enable');
    simulationEngine.executeCommand('Switch1', 'configure terminal');
    simulationEngine.executeCommand('Switch1', 'interface FastEthernet0/1');
    simulationEngine.executeCommand('Switch1', 'switchport mode access');
    simulationEngine.executeCommand('Switch1', 'switchport port-security');
    simulationEngine.executeCommand('Switch1', 'switchport port-security maximum 1');
    simulationEngine.executeCommand('Switch1', 'switchport port-security violation restrict');
    simulationEngine.executeCommand('Switch1', 'end');

    // Check show command
    let out = simulationEngine.executeCommand('Switch1', 'show port-security interface FastEthernet0/1');
    expect(out).toContain('Port Security              : Enabled');
    expect(out).toContain('Violation Mode             : Restrict');
    expect(out).toContain('Maximum MAC Addresses      : 1');

    // Send a frame from PC1 (should be learned)
    simulationEngine.executeCommand('PC1', 'ip 192.168.1.10 255.255.255.0');
    simulationEngine.executeCommand('PC2', 'ip 192.168.1.20 255.255.255.0');
    simulationEngine.executeCommand('PC1', 'ping 192.168.1.20');
    simulationEngine.tick(100);

    out = simulationEngine.executeCommand('Switch1', 'show port-security interface FastEthernet0/1');
    expect(out).toContain('Total MAC Addresses        : 1');
    expect(out).toContain('Security Violation Count   : 0');

    // Change PC1 MAC address to simulate a violation
    const pc1Intf = Array.from(pc1.interfaces.values())[0];
    pc1Intf.macAddress = '00:11:22:33:44:55';

    // Send another frame from the new MAC on the same restricted port
    simulationEngine.executeCommand('PC1', 'ping 192.168.1.20');
    simulationEngine.tick(100);

    // Violation count should increment
    out = simulationEngine.executeCommand('Switch1', 'show port-security interface FastEthernet0/1');
    expect(out).toContain('Security Violation Count   : 1');
    
    // Test global show port-security
    let globalOut = simulationEngine.executeCommand('Switch1', 'show port-security');
    expect(globalOut).toContain('FastEthernet0/1');
    expect(globalOut).toContain('Restrict');
  });
});
