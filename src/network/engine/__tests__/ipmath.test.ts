import { describe, it, expect } from 'vitest'
import { IPMath } from '../IPMath'

describe('IPMath Utilities', () => {
  it('validates IP addresses correctly', () => {
    expect(IPMath.validateIp('192.168.1.1')).toBe(true)
    expect(IPMath.validateIp('10.0.0.0')).toBe(true)
    expect(IPMath.validateIp('255.255.255.255')).toBe(true)
    expect(IPMath.validateIp('256.1.1.1')).toBe(false)
    expect(IPMath.validateIp('192.168.1')).toBe(false)
    expect(IPMath.validateIp('abc.def.ghi.jkl')).toBe(false)
  })

  it('validates Subnet Masks correctly', () => {
    expect(IPMath.validateMask('255.255.255.0')).toBe(true)
    expect(IPMath.validateMask('255.255.255.128')).toBe(true)
    expect(IPMath.validateMask('255.255.0.0')).toBe(true)
    expect(IPMath.validateMask('0.0.0.0')).toBe(true)
    expect(IPMath.validateMask('255.0.255.0')).toBe(false) // Non-contiguous
    expect(IPMath.validateMask('255.255.255.1')).toBe(false) // Non-contiguous
    expect(IPMath.validateMask('256.0.0.0')).toBe(false)
  })

  it('calculates network addresses', () => {
    expect(IPMath.getNetworkAddress('192.168.1.50', '255.255.255.0')).toBe('192.168.1.0')
    expect(IPMath.getNetworkAddress('10.1.2.3', '255.0.0.0')).toBe('10.0.0.0')
    expect(IPMath.getNetworkAddress('172.16.5.100', '255.255.255.128')).toBe('172.16.5.0')
    expect(IPMath.getNetworkAddress('172.16.5.150', '255.255.255.128')).toBe('172.16.5.128')
  })

  it('calculates broadcast addresses', () => {
    expect(IPMath.getBroadcastAddress('192.168.1.50', '255.255.255.0')).toBe('192.168.1.255')
    expect(IPMath.getBroadcastAddress('10.1.2.3', '255.0.0.0')).toBe('10.255.255.255')
    expect(IPMath.getBroadcastAddress('172.16.5.100', '255.255.255.128')).toBe('172.16.5.127')
  })

  it('calculates wildcard masks', () => {
    expect(IPMath.getWildcardMask('255.255.255.0')).toBe('0.0.0.255')
    expect(IPMath.getWildcardMask('255.255.240.0')).toBe('0.0.15.255')
  })

  it('converts prefixes to masks', () => {
    expect(IPMath.prefixToMask(24)).toBe('255.255.255.0')
    expect(IPMath.prefixToMask(8)).toBe('255.0.0.0')
    expect(IPMath.prefixToMask(0)).toBe('0.0.0.0')
    expect(IPMath.prefixToMask(32)).toBe('255.255.255.255')
  })

  it('calculates usable hosts', () => {
    expect(IPMath.calculateHosts('255.255.255.0')).toBe(254)
    expect(IPMath.calculateHosts('255.255.255.128')).toBe(126)
    expect(IPMath.calculateHosts('255.255.255.252')).toBe(2)
    expect(IPMath.calculateHosts('255.255.255.255')).toBe(0)
  })

  it('checks if IPs are in the same subnet', () => {
    expect(IPMath.isSameSubnet('192.168.1.10', '192.168.1.20', '255.255.255.0')).toBe(true)
    expect(IPMath.isSameSubnet('192.168.1.10', '192.168.2.20', '255.255.255.0')).toBe(false)
    expect(IPMath.isSameSubnet('172.16.5.10', '172.16.5.150', '255.255.255.128')).toBe(false)
  })
})
