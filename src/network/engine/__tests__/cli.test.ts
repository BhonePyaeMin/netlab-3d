import { describe, it, expect, beforeEach } from 'vitest'
import { SimulationNetworkEngine } from '../SimulationNetworkEngine'
import { Router } from '../Devices'
import { createInterface } from '../NetworkInterface'

describe('Cisco CLI Parser Engine', () => {
  let engine: SimulationNetworkEngine
  let r1: Router

  beforeEach(() => {
    engine = new SimulationNetworkEngine()
    r1 = new Router('R1', 'Router')
    
    // Add some interfaces
    r1.addInterface(createInterface('R1_G0/0', 'R1', 'GigabitEthernet0/0', 'GigabitEthernet'))
    r1.addInterface(createInterface('R1_G0/1', 'R1', 'GigabitEthernet0/1', 'GigabitEthernet'))
    
    engine.addDevice(r1)
  })

  it('starts in User EXEC mode', () => {
    expect(engine.getPrompt('R1')).toBe('Router>')
  })

  it('navigates to Privileged EXEC mode', () => {
    engine.executeCommand('R1', 'enable')
    expect(engine.getPrompt('R1')).toBe('Router#')
  })

  it('navigates to Global Configuration mode', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    expect(engine.getPrompt('R1')).toBe('Router(config)#')
  })

  it('navigates to Interface Configuration mode', () => {
    engine.executeCommand('R1', 'en')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'interface G0/0')
    expect(engine.getPrompt('R1')).toBe('Router(config-if)#')
  })

  it('exits back through the hierarchy', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'configure terminal')
    engine.executeCommand('R1', 'interface G0/0')
    
    engine.executeCommand('R1', 'exit')
    expect(engine.getPrompt('R1')).toBe('Router(config)#')
    
    engine.executeCommand('R1', 'exit')
    expect(engine.getPrompt('R1')).toBe('Router#')
    
    engine.executeCommand('R1', 'disable')
    expect(engine.getPrompt('R1')).toBe('Router>')
  })

  it('changes the hostname', () => {
    engine.executeCommand('R1', 'enable')
    engine.executeCommand('R1', 'conf t')
    engine.executeCommand('R1', 'hostname CoreSwitch')
    
    expect(engine.getPrompt('R1')).toBe('CoreSwitch(config)#')
    expect(r1.hostname).toBe('CoreSwitch')
  })

  it('executes show ip interface brief', () => {
    engine.executeCommand('R1', 'enable')
    const output = engine.executeCommand('R1', 'show ip interface brief')
    
    expect(output).toContain('GigabitEthernet0/0')
    expect(output).toContain('unassigned')
    expect(output).toContain('administratively down')
  })

  it('saves configuration with write memory', () => {
    engine.executeCommand('R1', 'enable\nconf t\nhostname TestRouter\nend')
    const output = engine.executeCommand('R1', 'write memory')
    
    expect(output).toContain('Building configuration')
    expect(r1.startupConfig).toContain('hostname TestRouter')
  })
})
