import { describe, it, expect, beforeEach } from 'vitest'
import { Scenarios } from './src/network/engine/ScenarioManager'
import { simulationEngine } from './src/network/engine/globalEngine'
import { NetworkStore } from './src/network/NetworkStore'

describe('ScenarioManager', () => {
  beforeEach(() => {
    simulationEngine.clear()
    NetworkStore.setActiveScenarioId(null)
  })

  it('Wrong Subnet Scenario: fails initially, succeeds after fix', () => {
    const sc = Scenarios.find(s => s.id === 'wrong-subnet')
    expect(sc).toBeDefined()
    if (!sc) return
    
    // Load scenario
    sc.setup()
    
    // Initial check should fail
    expect(sc.checkSuccess()).toBe(false)
    
    // Fix it
    simulationEngine.executeCommand('PC1', 'ip 192.168.1.100 255.255.255.0 192.168.1.1')
    
    // Should now succeed
    expect(sc.checkSuccess()).toBe(true)
  })

  it('Shutdown Interface Scenario: fails initially, succeeds after fix', () => {
    const sc = Scenarios.find(s => s.id === 'shutdown-interface')
    if (!sc) return
    sc.setup()
    expect(sc.checkSuccess()).toBe(false)
    
    // Fix it
    simulationEngine.executeCommand('Router1', 'enable\nconf t\nint g0/0\nno shut\nend')
    expect(sc.checkSuccess()).toBe(true)
  })
})
