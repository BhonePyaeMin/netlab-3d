/**
 * NetworkInterface.ts — Logical interface on a network device.
 *
 * An interface represents a logical connection point, e.g. GigabitEthernet0/0.
 * It contains IP addressing, MAC address, and administrative status.
 * It connects to exactly one PhysicalPort.
 */
import type { InterfaceType, AdminStatus, OperStatus, Duplex } from './DeviceTypes'
import { IPMath } from './IPMath'

export interface NetworkInterface {
  /** Unique logical ID, e.g. "Router1_GigabitEthernet0/0" */
  readonly id: string

  /** Device this interface belongs to */
  readonly deviceId: string

  /** Formal interface name, e.g. "GigabitEthernet0/0" */
  readonly name: string

  /** Hardware type (e.g. GigabitEthernet, Loopback, Vlan) */
  readonly type: InterfaceType

  /** MAC address of this interface (if applicable) */
  macAddress: string

  /** Primary IPv4 address (null if unconfigured) */
  ipAddress: string | null

  /** Subnet mask in dot-decimal format (null if unconfigured) */
  subnetMask: string | null

  /** IPv6 addresses assigned to this interface (format: ip/prefix) */
  ipv6Addresses: string[]

  /** IPv6 Link-Local address */
  ipv6LinkLocal: string | null

  /** Admin state (configured by user) */
  adminStatus: AdminStatus

  /** Operational state (line protocol) */
  operStatus: OperStatus

  /** Speed in Mbps */
  speed: number

  /** Duplex setting */
  duplex: Duplex

  /** Maximum Transmission Unit */
  mtu: number

  /** User-configured description */
  description: string

  /** Switchport configuration */
  switchportMode: 'access' | 'trunk'
  accessVlan: number
  trunkNativeVlan: number
  trunkAllowedVlans: 'all' | number[]

  /** Switchport Port Security */
  portSecurityEnabled: boolean
  portSecurityMax: number
  portSecuritySticky: boolean
  portSecurityViolation: 'protect' | 'restrict' | 'shutdown'
  portSecurityMacAddresses: string[]
  portSecurityViolationCount: number

  /** NAT Zone */
  natZone?: 'inside' | 'outside'


  /** Virtual Interface Properties */
  type: 'physical' | 'subinterface' | 'svi'
  parentPortId?: string // For subinterfaces
  encapsulationDot1Q?: number // For subinterfaces
  vlanId?: number // For SVIs

  /** ID of the physical chassis port this interface binds to (null for SVIs, parent port for subinterfaces) */
  connectedPortId: string | null
}

/** Create a new unconfigured NetworkInterface */
export function createInterface(
  id: string,
  deviceId: string,
  name: string,
  type: InterfaceType,
  connectedPortId: string | null = null
): NetworkInterface {
  return {
    id,
    deviceId,
    name,
    type,
    macAddress: generateMacAddress(deviceId, name),
    ipAddress: null,
    subnetMask: null,
    ipv6Addresses: [],
    ipv6LinkLocal: IPMath.generateIpv6LinkLocal(generateMacAddress(deviceId, name)),
    adminStatus: 'down',
    operStatus: 'down',
    speed: type === 'GigabitEthernet' ? 1000 : type === 'FastEthernet' ? 100 : 1000,
    duplex: 'auto',
    mtu: 1500,
    description: '',
    switchportMode: 'access',
    accessVlan: 1,
    trunkNativeVlan: 1,
    trunkAllowedVlans: 'all',
    portSecurityEnabled: false,
    portSecurityMax: 1,
    portSecuritySticky: false,
    portSecurityViolation: 'shutdown',
    portSecurityMacAddresses: [],
    portSecurityViolationCount: 0,
    type: 'physical',
    connectedPortId,
  }
}

/** Helper to generate a deterministic MAC address for an interface */
function generateMacAddress(deviceId: string, interfaceName: string): string {
  // Very simple deterministic mock MAC for simulation purposes
  const hash = Array.from(deviceId + interfaceName).reduce((a, b) => a + b.charCodeAt(0), 0)
  const hex = (hash % 0xFFFFFF).toString(16).padStart(6, '0')
  return `00:1A:2B:${hex.substring(0,2)}:${hex.substring(2,4)}:${hex.substring(4,6)}`.toUpperCase()
}
